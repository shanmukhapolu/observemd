/* ============================================================
   ObserveMD — Shared App Logic
   Data layer: Firestore (per-user, no localStorage)
   Sidebar, charts, modal, analytics, PDF export
   ============================================================ */

/* ---------- Firestore SDK (CDN ESM shim via globalThis) ----------
   firebase-auth.js (type="module") sets window.OMD_DB.
   app.js is loaded as a classic script AFTER firebase-auth.js,
   so by the time page scripts call OMD.init() the DB is ready.
   ---------------------------------------------------------------- */

const OMD = (() => {

  /* ---- constants ---- */
  const REFLECTION_QUESTIONS = [
    "What did you observe today?",
    "What surprised you?",
    "What skill or trait stood out in the healthcare professional?",
    "What challenge did you notice?",
    "How did this experience influence your understanding of healthcare?",
    "What questions do you still have?",
  ];

  const SPECIALTIES = [
    "Emergency Medicine", "Pediatrics", "Cardiology", "Family Medicine",
    "Surgery", "Internal Medicine", "Neurology", "Oncology",
    "Orthopedics", "Radiology", "Dermatology", "Psychiatry",
    "Anesthesiology", "Obstetrics & Gynecology",
  ];

  const THEMES = {
    "Patient Communication": ["communicat","explain","listen","talk","conversation","rapport","bedside"],
    "Empathy":               ["empath","compassion","comfort","caring","kind","reassur","gentle"],
    "Professionalism":       ["professional","respect","ethic","punctual","demeanor","composed"],
    "Leadership":            ["lead","direct","decision","command","guide","charge","oversee"],
    "Teamwork":              ["team","collaborat","nurse","coordinat","together","staff","colleague"],
    "Clinical Decision Making": ["diagnos","decision","assess","treatment","evaluat","clinical","judgment","differential"],
  };

  /* ---- runtime state (populated by init()) ---- */
  let _db   = null;
  let _uid  = null;
  let _list = [];        // in-memory cache of observations (sorted desc by date)
  let _experiences = []; // in-memory cache of experiences (primary organization unit)

  /* ---- Firestore helpers ---- */
  // Dynamic import of Firestore functions from the CDN
  async function _fs() {
    return await import("https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js");
  }

  function _obsCol() {
    // Each observation lives at  /observations/<auto-id>  with a `uid` field
    // The Firestore rules enforce  request.auth.uid == resource.data.uid
    return null; // placeholder — real ref built inside async fns below
  }

  /* ---- init() — called by every page script before using OMD ---- */
  // Returns a promise that resolves once the user is confirmed + data loaded.
  async function init() {
    // Wait for firebase-auth.js to set OMD_USER
    await new Promise((resolve) => {
      const check = () => {
        if (window.OMD_USER && window.OMD_DB) return resolve();
        setTimeout(check, 40);
      };
      check();
    });
    _db  = window.OMD_DB;
    _uid = window.OMD_USER.uid;
    await _loadAll();
    await _migrateObservationsToExperiences();
  }

  async function _loadAll() {
    const { collection, query, where, orderBy, getDocs } = await _fs();
    const obsCol = collection(_db, "observations");
    const obsQ   = query(obsCol, where("uid", "==", _uid), orderBy("date", "desc"));
    const obsSnap = await getDocs(obsQ);
    _list = obsSnap.docs.map(d => normalizeObservation({ id: d.id, ...d.data() }));

    const expCol = collection(_db, "experiences");
    const expQ   = query(expCol, where("uid", "==", _uid), orderBy("updatedAt", "desc"));
    const expSnap = await getDocs(expQ);
    _experiences = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _hydrateExperienceStats();
  }

  function normalizeObservation(o) {
    o.sessionSummary = o.sessionSummary || o.notes || "";
    o.duration = Number(o.duration ?? o.hours ?? hoursBetween(o.startTime, o.endTime) ?? 0);
    o.hours = Number(o.hours ?? o.duration ?? 0);
    o.providerName = o.providerName || o.physicianName || "";
    o.organization = o.organization || o.location || "";
    o.location = o.location || o.organization || "";
    o.reflections = o.reflections || {};
    for (let i = 0; i < REFLECTION_QUESTIONS.length; i++) {
      o.reflections[i] = o.reflections[i] ?? o[`reflectionQuestion${i + 1}`] ?? "";
    }
    return o;
  }

  function _experienceKeyFromObservation(o) {
    return [o.providerName || o.physicianName || "", o.specialty || "", o.location || o.organization || ""]
      .map(v => String(v).trim().toLowerCase()).join("|");
  }

  function _experienceFromObservation(o) {
    const physicianName = (o.providerName || o.physicianName || "").trim();
    return {
      uid: _uid,
      title: physicianName ? `Shadowing ${physicianName}` : `Shadowing ${o.specialty || "Clinical Experience"}`,
      experienceType: physicianName ? "physician" : "institution",
      physicianName,
      specialty: o.specialty || "General Medicine",
      organization: o.location || o.organization || "",
      location: o.location || o.organization || "",
      startDate: o.date,
      endDate: o.date,
      verificationStatus: "unverified",
      createdAt: o.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async function _migrateObservationsToExperiences() {
    const needs = _list.filter(o => !o.experienceId);
    if (!needs.length && _experiences.length) return;
    const { collection, addDoc, doc, updateDoc, serverTimestamp } = await _fs();
    const byKey = new Map(_experiences.map(e => [[e.physicianName || "", e.specialty || "", e.organization || e.location || ""].map(v => String(v).trim().toLowerCase()).join("|"), e]));
    const groups = new Map();
    needs.forEach(o => {
      const key = _experienceKeyFromObservation(o) || o.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    });
    for (const [key, obs] of groups) {
      let exp = byKey.get(key);
      if (!exp) {
        const seed = _experienceFromObservation(obs[0]);
        const dates = obs.map(o => o.date).filter(Boolean).sort();
        seed.startDate = dates[0] || seed.startDate;
        seed.endDate = dates[dates.length - 1] || seed.endDate;
        const ref = await addDoc(collection(_db, "experiences"), seed);
        exp = { id: ref.id, ...seed };
        _experiences.push(exp);
        byKey.set(key, exp);
      }
      for (const o of obs) {
        o.experienceId = exp.id;
        await updateDoc(doc(_db, "observations", o.id), { experienceId: exp.id, sessionSummary: o.sessionSummary, duration: o.duration, hours: o.hours, updatedAt: serverTimestamp() });
      }
    }
    _hydrateExperienceStats();
  }

  function _hydrateExperienceStats() {
    _experiences = _experiences.map(e => {
      const obs = _list.filter(o => o.experienceId === e.id).sort((a,b)=>new Date(a.date)-new Date(b.date));
      const dates = obs.map(o => o.date).filter(Boolean);
      return { ...e,
        totalHours: round(obs.reduce((s,o)=>s+(Number(o.duration ?? o.hours) || 0),0)),
        totalObservations: obs.length,
        startDate: e.startDate || dates[0] || "",
        endDate: e.endDate || dates[dates.length-1] || e.startDate || "",
      };
    }).sort((a,b)=>new Date(b.updatedAt || b.endDate || 0)-new Date(a.updatedAt || a.endDate || 0));
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---- Public data API ---- */
  function getAll() { return _list; }
  function getExperiences() { _hydrateExperienceStats(); return _experiences; }
  function getExperience(id) { _hydrateExperienceStats(); return _experiences.find(e => e.id === id); }
  function getObservationsForExperience(id) { return _list.filter(o => o.experienceId === id).sort((a,b)=>new Date(a.date)-new Date(b.date)); }

  async function add(obs) {
    const { collection, addDoc, doc, updateDoc, serverTimestamp } = await _fs();
    obs.uid       = _uid;
    obs.createdAt = new Date().toISOString();
    obs = normalizeObservation(obs);
    const ref  = await addDoc(collection(_db, "observations"), obs);
    obs.id     = ref.id;
    _list.unshift(obs);
    _list.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (obs.experienceId) await updateDoc(doc(_db, "experiences", obs.experienceId), { updatedAt: serverTimestamp(), endDate: obs.date });
    _hydrateExperienceStats();
    return obs;
  }

  async function addExperience(exp) {
    const { collection, addDoc } = await _fs();
    const now = new Date().toISOString();
    exp.uid = _uid;
    exp.createdAt = now;
    exp.updatedAt = now;
    exp.verificationStatus = exp.verificationStatus || "unverified";
    exp.title = exp.title || (exp.physicianName ? `Shadowing ${exp.physicianName}` : `Shadowing ${exp.specialty || "Clinical Experience"}`);
    const ref = await addDoc(collection(_db, "experiences"), exp);
    const saved = { id: ref.id, ...exp, totalHours: 0, totalObservations: 0 };
    _experiences.unshift(saved);
    return saved;
  }

  async function remove(id) {
    const { doc, deleteDoc } = await _fs();
    await deleteDoc(doc(_db, "observations", id));
    _list = _list.filter(o => o.id !== id);
  }

  /* ---- Profile (stored in Firestore /users/<uid>) ---- */
  async function getProfile() {
    const { doc, getDoc } = await _fs();
    const snap = await getDoc(doc(_db, "users", _uid));
    return snap.exists() ? snap.data() : _defaultProfile();
  }

  function _defaultProfile() {
    return { name: "", email: window.OMD_USER?.email || "", school: "", goal: "Pre-Med", gradYear: "" };
  }

  async function saveProfile(p) {
    const { doc, setDoc } = await _fs();
    await setDoc(doc(_db, "users", _uid), p, { merge: true });
  }

  /* ---- Helpers ---- */
  function hoursBetween(start, end) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60;
    return Math.round((mins / 60) * 100) / 100;
  }
  function fmtDate(d, opts) {
    return new Date(d + "T00:00:00").toLocaleDateString("en-US",
      opts || { month: "short", day: "numeric", year: "numeric" });
  }
  function monthKey(d) { return new Date(d + "T00:00:00").toISOString().slice(0, 7); }
  function monthLabel(key) {
    const [y, m] = key.split("-");
    return new Date(y, m - 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  function wordCount(s) { return (s || "").trim().split(/\s+/).filter(Boolean).length; }
  function round(n, d = 1) { const f = 10 ** d; return Math.round(n * f) / f; }

  /* ---- Analytics (synchronous — operates on _list cache) ---- */
  function analytics() {
    const list = getAll();
    const totalHours = round(list.reduce((s, o) => s + (o.hours || 0), 0));
    const sessions = list.length;
    const specialtiesSet = new Set(list.map(o => o.specialty));
    const providersSet   = new Set(list.map(o => o.providerName));

    const byMonth = {};
    list.forEach(o => { byMonth[monthKey(o.date)] = (byMonth[monthKey(o.date)] || 0) + (o.hours || 0); });
    const monthsSorted = Object.keys(byMonth).sort();

    const sessMonth = {};
    list.forEach(o => { sessMonth[monthKey(o.date)] = (sessMonth[monthKey(o.date)] || 0) + 1; });

    const bySpec = {};
    list.forEach(o => { bySpec[o.specialty] = (bySpec[o.specialty] || 0) + (o.hours || 0); });
    const byPhysician = {}, byOrganization = {}, verifiedHours = { verified: 0, pending: 0, unverified: 0 }, obsPerExperience = {};
    _hydrateExperienceStats();
    _experiences.forEach(e => {
      const hrs = e.totalHours || 0;
      if (e.physicianName) byPhysician[e.physicianName] = (byPhysician[e.physicianName] || 0) + hrs;
      if (e.organization || e.location) byOrganization[e.organization || e.location] = (byOrganization[e.organization || e.location] || 0) + hrs;
      verifiedHours[e.verificationStatus || "unverified"] = (verifiedHours[e.verificationStatus || "unverified"] || 0) + hrs;
      obsPerExperience[e.title] = e.totalObservations || 0;
    });

    const byDay = [0,0,0,0,0,0,0];
    list.forEach(o => { byDay[new Date(o.date + "T00:00:00").getDay()] += (o.hours || 0); });

    const durations = list.map(o => o.hours || 0).filter(Boolean);
    const longest   = durations.length ? Math.max(...durations) : 0;
    const shortest  = durations.length ? Math.min(...durations) : 0;
    const avgSession = sessions ? round(totalHours / sessions) : 0;

    const days = [...new Set(list.map(o => o.date))].sort();
    let streak = 0, best = 0;
    for (let i = 0; i < days.length; i++) {
      if (i === 0) { streak = 1; }
      else {
        const diff = (new Date(days[i]) - new Date(days[i-1])) / 86400000;
        streak = diff === 1 ? streak + 1 : 1;
      }
      best = Math.max(best, streak);
    }

    let totalWords = 0, respCount = 0;
    const wordsByMonth = {};
    list.forEach(o => {
      let w = 0;
      Object.values(o.reflections || {}).forEach(a => {
        const c = wordCount(a); w += c; if (c) respCount++;
      });
      totalWords += w;
      wordsByMonth[monthKey(o.date)] = (wordsByMonth[monthKey(o.date)] || 0) + w;
    });
    const avgReflection = respCount ? Math.round(totalWords / respCount) : 0;

    const themeCounts = {};
    Object.keys(THEMES).forEach(t => themeCounts[t] = 0);
    list.forEach(o => {
      const text = Object.values(o.reflections || {}).join(" ").toLowerCase();
      Object.entries(THEMES).forEach(([t, kws]) => {
        kws.forEach(k => { const m = text.match(new RegExp(k, "g")); if (m) themeCounts[t] += m.length; });
      });
    });

    const allWords = list.flatMap(o => Object.values(o.reflections || {}).join(" ").toLowerCase().match(/[a-z]{3,}/g) || []);
    const uniqueWords = new Set(allWords).size;

    const topSpec  = Object.entries(bySpec).sort((a, b) => b[1] - a[1])[0];
    const lowSpec  = Object.entries(bySpec).sort((a, b) => a[1] - b[1])[0];
    const topMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const topDay   = byDay.indexOf(Math.max(...byDay));

    return {
      list, totalHours, sessions, specialtiesCount: specialtiesSet.size,
      providersCount: providersSet.size, respCount,
      byMonth, monthsSorted, sessMonth, bySpec, byPhysician, byOrganization, verifiedHours, obsPerExperience, byDay, dayNames,
      longest: round(longest), shortest: round(shortest), avgSession,
      bestStreak: best, totalWords, avgReflection, wordsByMonth, themeCounts, uniqueWords,
      topSpec, lowSpec, topMonth, topDay: dayNames[topDay],
    };
  }

  /* ---- Sidebar ---- */
  const NAV = [
    { id: "dashboard",    label: "Dashboard",       icon: "layout-dashboard", href: "dashboard.html" },
    { id: "experiences",  label: "Experiences",      icon: "stethoscope", href: "experiences.html" },
    { id: "reflections",  label: "Reflections",      icon: "book-open",       href: "reflections.html" },
    { id: "analytics",    label: "Analytics",        icon: "bar-chart-3",     href: "analytics.html" },
    { id: "portfolio",    label: "Portfolio",        icon: "download",        href: "#export" },
  ];

  function renderSidebar(active) {
    const items = NAV.map(n => `
      <a class="nav-item ${n.id === active ? "active" : ""}" href="${n.href}" data-nav="${n.id}">
        <i data-lucide="${n.icon}"></i>${n.label}
      </a>`).join("");

    const html = `
      <div class="mobile-bar">
        <div class="logo" style="margin:0;font-size:1.2rem;">
          <span class="logo-mark"><img src="assets/logo-white.png" alt="ObserveMD icon"></span><span class="logo-wordmark">Observe<span class="logo-md">MD</span></span>
        </div>
        <button class="menu-btn" id="menuBtn"><i data-lucide="menu"></i></button>
      </div>
      <aside class="sidebar" id="sidebar">
        <div class="logo">
          <span class="logo-mark"><img src="assets/logo-white.png" alt="ObserveMD icon"></span><span class="logo-wordmark">Observe<span class="logo-md">MD</span></span>
        </div>
        <nav class="nav">${items}</nav>
        <div class="spacer"></div>
        <a class="nav-item ${active === "settings" ? "active" : ""}" href="settings.html" data-nav="settings">
          <i data-lucide="settings"></i>Settings
        </a>
        <div class="sidebar-user">
          <div class="sb-avatar" id="sbUserAvatar">S</div>
          <div class="sb-user-meta">
            <div class="sb-user-name" id="sbUserName">Loading…</div>
            <div class="sb-user-email" id="sbUserEmail"></div>
          </div>
          <button class="sb-signout" id="sbSignOut" title="Sign out" aria-label="Sign out">
            <i data-lucide="log-out"></i>
          </button>
        </div>
      </aside>`;

    document.body.insertAdjacentHTML("afterbegin", html);

    document.querySelector('[data-nav="portfolio"]').addEventListener("click", (e) => {
      e.preventDefault();
      exportPortfolio();
    });
    const mb = document.getElementById("menuBtn");
    if (mb) mb.addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  }

  /* ---- Toast ---- */
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.innerHTML = `<i data-lucide="check-circle"></i><span>${msg}</span>`;
    if (window.lucide) lucide.createIcons();
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ---- Observation modal ---- */
  function openObservationModal(onSaved, experience = null) {
    let overlay = document.getElementById("obsModal");
    if (!overlay) {
      const fields = REFLECTION_QUESTIONS.map((q, i) => `
        <div class="field full">
          <label>${i + 1}. ${q} <span style="color:var(--rose)">*</span></label>
          <textarea name="r${i}" required placeholder="Write your reflection..."></textarea>
        </div>`).join("");
      const specOpts = SPECIALTIES.map(s => `<option>${s}</option>`).join("");

      overlay = document.createElement("div");
      overlay.id = "obsModal";
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-head">
            <div>
              <h2>New Observation</h2>
              <p>Log the session details and complete all six reflection questions.</p>
            </div>
            <button class="icon-btn" data-close><i data-lucide="x"></i></button>
          </div>
          <form id="obsForm">
            <div class="form-divider">Observation Information</div>
            <div class="form-grid">
              <div class="field"><label>Date *</label><input type="date" name="date" required></div>
              <div class="field experience-only"><label>Specialty *</label><select name="specialty" required>${specOpts}</select></div>
              <div class="field experience-only"><label>Provider Name *</label><input name="providerName" required placeholder="Dr. Jane Smith"></div>
              <div class="field experience-only"><label>Provider Title</label><input name="providerTitle" placeholder="Attending Physician"></div>
              <div class="field full experience-only"><label>Location *</label><input name="location" required placeholder="St. Mary's Medical Center"></div>
              <div class="field"><label>Start Time *</label><input type="time" name="startTime" required></div>
              <div class="field"><label>End Time *</label><input type="time" name="endTime" required></div>
              <div class="field full"><label>Observation Notes *</label><textarea name="notes" required placeholder="Summarize what happened during the session..."></textarea></div>
            </div>
            <div class="form-divider">Reflection Questions</div>
            ${fields}
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" data-close>Cancel</button>
              <button type="submit" class="btn"><i data-lucide="save"></i>Save Observation</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(overlay);

      overlay.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => overlay.classList.remove("open")));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });

      overlay.querySelector("#obsForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving…";
        const f = new FormData(e.target);
        const reflections = {};
        REFLECTION_QUESTIONS.forEach((q, i) => reflections[i] = (f.get("r" + i) || "").trim());
        const activeExperience = overlay._experience || null;
        const obs = {
          date:          f.get("date"),
          experienceId:   activeExperience?.id || f.get("experienceId") || "",
          specialty:     activeExperience?.specialty || f.get("specialty"),
          providerName:  activeExperience?.physicianName || (f.get("providerName") || "").trim(),
          providerTitle: (f.get("providerTitle") || "").trim(),
          location:      activeExperience?.organization || activeExperience?.location || (f.get("location") || "").trim(),
          startTime:     f.get("startTime"),
          endTime:       f.get("endTime"),
          hours:         hoursBetween(f.get("startTime"), f.get("endTime")),
          notes:         f.get("notes").trim(),
          sessionSummary:f.get("notes").trim(),
          reflections,
        };
        await add(obs);
        overlay.classList.remove("open");
        e.target.reset();
        toast("Observation saved");
        if (onSaved) onSaved();
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="save"></i>Save Observation';
        if (window.lucide) lucide.createIcons();
      });
      if (window.lucide) lucide.createIcons();
    }
    overlay.querySelector('[name="date"]').value = new Date().toISOString().slice(0, 10);
    overlay._experience = experience;
    overlay.querySelectorAll(".experience-only").forEach(el => { el.style.display = experience ? "none" : ""; el.querySelectorAll("input,select").forEach(i => i.required = !experience && i.name !== "providerTitle"); });
    const head = overlay.querySelector(".modal-head h2");
    if (head) head.textContent = experience ? `Add Observation to ${experience.title}` : "New Observation";
    overlay.classList.add("open");
  }



  function uniqueValues(field) {
    const vals = new Set();
    _experiences.forEach(e => { if (e[field]) vals.add(e[field]); });
    _list.forEach(o => {
      if (field === "physicianName" && o.providerName) vals.add(o.providerName);
      if (field === "specialty" && o.specialty) vals.add(o.specialty);
      if (field === "organization" && (o.location || o.organization)) vals.add(o.location || o.organization);
    });
    return [...vals].sort();
  }

  function combo(name, label, values, placeholder, required = true) {
    return `<div class="field"><label>${label}${required ? " *" : ""}</label><input name="${name}" list="${name}List" ${required ? "required" : ""} placeholder="${placeholder}"><datalist id="${name}List">${values.map(v=>`<option value="${v}"></option>`).join("")}</datalist></div>`;
  }

  function openExperienceModal(onSaved) {
    let overlay = document.getElementById("expModal");
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.id = "expModal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-head"><div><h2>New Experience</h2><p>Create the shadowing context once, then add sessions underneath it.</p></div><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
        <form id="expForm">
          <div class="form-grid">
            <div class="field"><label>Experience Type *</label><select name="experienceType" required><option value="physician">Physician</option><option value="department">Department</option><option value="institution">Institution</option></select></div>
            ${combo("physicianName", "Physician Name", uniqueValues("physicianName"), "Dr. Jane Smith", false)}
            ${combo("specialty", "Specialty", [...new Set([...SPECIALTIES, ...uniqueValues("specialty")])].sort(), "Emergency Medicine")}
            ${combo("organization", "Organization / Location", uniqueValues("organization"), "St. Mary's Medical Center")}
            <div class="field"><label>Start Date</label><input type="date" name="startDate"></div>
            <div class="field"><label>End Date</label><input type="date" name="endDate"></div>
          </div>
          <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn"><i data-lucide="save"></i>Save Experience</button></div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    const type = overlay.querySelector('[name="experienceType"]');
    const phys = overlay.querySelector('[name="physicianName"]').closest('.field');
    function sync(){ phys.style.display = type.value === 'physician' ? '' : 'none'; overlay.querySelector('[name="physicianName"]').required = type.value === 'physician'; }
    type.addEventListener('change', sync); sync();
    overlay.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => overlay.classList.remove("open")));
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.classList.remove("open"); });
    overlay.querySelector('#expForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const exp = await addExperience({
        experienceType: f.get('experienceType'),
        physicianName: (f.get('physicianName') || '').trim(),
        specialty: (f.get('specialty') || '').trim(),
        organization: (f.get('organization') || '').trim(),
        location: (f.get('organization') || '').trim(),
        startDate: f.get('startDate') || '',
        endDate: f.get('endDate') || '',
        verificationStatus: 'unverified',
      });
      overlay.classList.remove('open'); toast('Experience saved'); if (onSaved) onSaved(exp);
    });
    if (window.lucide) lucide.createIcons();
    overlay.classList.add('open');
  }

  /* ---- Charts (SVG) ---- */
  const PAL = ["#7c3aed","#06b6d4","#22c55e","#f59e0b","#f43f5e","#3b82f6","#ec4899","#14b8a6","#a855f7","#eab308","#10b981","#ef4444","#8b5cf6","#0ea5e9"];

  function lineChart(el, labels, values, opts = {}) {
    const w = el.clientWidth || 600, h = opts.height || 280;
    const pad = { t: 20, r: 16, b: 34, l: 40 };
    const max = Math.max(...values, 1) * 1.15;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const x = i => pad.l + (values.length <= 1 ? iw / 2 : (i / (values.length - 1)) * iw);
    const y = v => pad.t + ih - (v / max) * ih;
    const pts = values.map((v, i) => [x(i), y(v)]);
    const linePath = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
    const areaPath = linePath + ` L${x(values.length-1)} ${pad.t+ih} L${x(0)} ${pad.t+ih} Z`;
    const gridY = [0,.25,.5,.75,1].map(f => {
      const yy = pad.t + ih - f * ih;
      return `<line x1="${pad.l}" y1="${yy}" x2="${w-pad.r}" y2="${yy}" stroke="#222633" stroke-width="1"/>
              <text x="${pad.l-8}" y="${yy+4}" text-anchor="end" fill="#64748b" font-size="11">${Math.round(max*f)}</text>`;
    }).join("");
    const xlabs = labels.map((l, i) => i % Math.ceil(labels.length/8||1) === 0
      ? `<text x="${x(i)}" y="${h-12}" text-anchor="middle" fill="#64748b" font-size="11">${l}</text>` : "").join("");
    const dots = pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#0a0b0f" stroke="#7c3aed" stroke-width="2"/>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7c3aed" stop-opacity=".35"/>
        <stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/>
      </linearGradient></defs>
      ${gridY}<path d="${areaPath}" fill="url(#lg)"/>
      <path d="${linePath}" fill="none" stroke="#7c3aed" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${xlabs}</svg>`;
  }

  function barChart(el, labels, values, opts = {}) {
    const w = el.clientWidth || 600, h = opts.height || 280;
    const pad = { t: 20, r: 16, b: 34, l: 40 };
    const max = Math.max(...values, 1) * 1.15;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const bw = iw / values.length * 0.6, gap = iw / values.length;
    const gridY = [0,.25,.5,.75,1].map(f => {
      const yy = pad.t + ih - f * ih;
      return `<line x1="${pad.l}" y1="${yy}" x2="${w-pad.r}" y2="${yy}" stroke="#222633"/>
              <text x="${pad.l-8}" y="${yy+4}" text-anchor="end" fill="#64748b" font-size="11">${Math.round(max*f)}</text>`;
    }).join("");
    const bars = values.map((v, i) => {
      const bh = (v/max)*ih, bx = pad.l+i*gap+(gap-bw)/2, by = pad.t+ih-bh;
      const lab = i % Math.ceil(labels.length/10||1) === 0
        ? `<text x="${bx+bw/2}" y="${h-12}" text-anchor="middle" fill="#64748b" font-size="11">${labels[i]}</text>` : "";
      return `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${opts.color||"#7c3aed"}"/>${lab}`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${gridY}${bars}</svg>`;
  }

  function donut(el, entries, opts = {}) {
    const size = opts.size || 200, r = size/2, ir = r*0.62;
    const total = entries.reduce((s,e)=>s+e[1],0) || 1;
    let a0 = -Math.PI/2;
    const arcs = entries.map((e,i)=>{
      const frac = e[1]/total, a1 = a0+frac*Math.PI*2;
      const large = a1-a0>Math.PI?1:0;
      const p=(ang,rad)=>[r+Math.cos(ang)*rad, r+Math.sin(ang)*rad];
      const[x0,y0]=p(a0,r),[x1,y1]=p(a1,r),[ix1,iy1]=p(a1,ir),[ix0,iy0]=p(a0,ir);
      a0=a1;
      return `<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${ix1} ${iy1} A${ir} ${ir} 0 ${large} 0 ${ix0} ${iy0} Z" fill="${PAL[i%PAL.length]}"/>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}
      <text x="${r}" y="${r-4}" text-anchor="middle" fill="#f8fafc" font-size="22" font-weight="700" font-family="Space Grotesk">${opts.center||total}</text>
      <text x="${r}" y="${r+16}" text-anchor="middle" fill="#94a3b8" font-size="11">${opts.label||""}</text></svg>`;
  }

  function colorFor(i) { return PAL[i % PAL.length]; }

  /* ---- PDF Export ---- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // Render the full "ObserveMD" wordmark on a canvas so both "Observe" and "MD"
  // are in Space Grotesk, perfectly baseline-aligned, with MD in the brand gradient.
  // Returns { dataUrl, pxW, pxH } at logical (non-scaled) pixel dimensions.
  function _wordmarkImg(fontSize) {
    const scale = 3;
    const fs = fontSize * scale;
    const fontStr = `bold ${fs}px "Space Grotesk","Helvetica Neue",Helvetica,Arial,sans-serif`;
    const tmp = document.createElement("canvas");
    const tCtx = tmp.getContext("2d");
    tCtx.font = fontStr;
    const obsW = tCtx.measureText("Observe").width;
    const mdW  = tCtx.measureText("MD").width;
    const totalW = obsW + mdW + 2;
    const h = Math.ceil(fs * 1.35);
    const c = document.createElement("canvas");
    c.width  = Math.ceil(totalW) + 4;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.font = fontStr;
    ctx.textBaseline = "alphabetic";
    const baseline = Math.ceil(fs * 1.0); // baseline position within canvas
    // "Observe" — dark ink colour for white PDF background
    ctx.fillStyle = "#1e2030";
    ctx.fillText("Observe", 2, baseline);
    // "MD" — brand gradient purple→cyan
    const grad = ctx.createLinearGradient(obsW + 2, 0, obsW + 2 + mdW, 0);
    grad.addColorStop(0, "#8b5cf6");
    grad.addColorStop(1, "#06b6d4");
    ctx.fillStyle = grad;
    ctx.fillText("MD", obsW + 2, baseline);
    return { dataUrl: c.toDataURL("image/png"), pxW: c.width / scale, pxH: h / scale, baseline: baseline / scale };
  }

  // Load a URL as a base64 data URL (for the logo PNG)
  function _fetchImgDataUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function exportPortfolio() {
    toast("Generating portfolio PDF…");
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    } catch {
      alert("Could not load the PDF library. Check your connection and try again.");
      return;
    }
    const { jsPDF } = window.jspdf;
    const a    = analytics();
    const prof = await getProfile();
    const doc  = new jsPDF({ unit: "pt", format: "letter" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 56;
    let y = 0;

    // Light theme palette — white background, dark text, purple accent, gradient only in brand elements
    const purple   = [139, 92, 246];   // #8b5cf6 — accent only (headings, underlines)
    const ink      = [30, 32, 48];     // near-black for headings / name
    const body     = [70, 78, 100];    // body text
    const muted    = [140, 148, 168];  // captions, labels
    const border   = [220, 224, 236];  // card/rule borders
    const white    = [255, 255, 255];
    const pageBg   = [250, 250, 252];  // very slight off-white page

    // Pre-render wordmark images at the sizes used in the PDF
    const wmLarge  = _wordmarkImg(24);  // cover header
    const wmSmall  = _wordmarkImg(8);   // page footer
    const wmMedium = _wordmarkImg(10);  // cover footer line

    // Load purple logo PNG for the PDF (suits white/light background)
    let logoDataUrl = null;
    try { logoDataUrl = await _fetchImgDataUrl("assets/logo-purple.png"); } catch { /* skip */ }

    // Place the logo icon + wordmark image at (xPos, baselineY)
    function drawWordmark(xPos, baselineY, wm) {
      const iconSize = wm.pxH * 1.1;
      if (logoDataUrl) {
        doc.addImage(logoDataUrl, "PNG", xPos, baselineY - iconSize * 0.85, iconSize, iconSize);
        xPos += iconSize + 5;
      }
      // Place canvas image so its baseline aligns with baselineY
      const imgTop = baselineY - wm.baseline;
      doc.addImage(wm.dataUrl, "PNG", xPos, imgTop, wm.pxW, wm.pxH);
      return xPos + wm.pxW; // return right edge x
    }

    // Gradient bar helper — smooth purple→cyan strip
    function gradBar(yTop, barH) {
      const steps = 32;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const r = Math.round(139 + (6  - 139) * t);
        const g = Math.round(92  + (182 - 92)  * t);
        const b = Math.round(246 + (212 - 246) * t);
        doc.setFillColor(r, g, b);
        doc.rect((W / steps) * i, yTop, W / steps + 1, barH, "F");
      }
    }

    /* ---- helper fns ---- */
    function footer(label) {
      // Hairline separator
      doc.setDrawColor(...border); doc.setLineWidth(0.5);
      doc.line(M, H - 30, W - M, H - 30);
      const footY = H - 16;
      // Logo icon + wordmark
      const rightEdge = drawWordmark(M, footY, wmSmall);
      // Separator dot + name
      doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...muted);
      doc.text("  •  " + (prof.name || ""), rightEdge, footY, { baseline:"bottom" });
      doc.text(label, W - M, footY, { align: "right", baseline:"bottom" });
    }

    function newPage(title) {
      doc.addPage(); y = M;
      // White page background
      doc.setFillColor(...pageBg); doc.rect(0, 0, W, H, "F");
      // Thin gradient accent bar at top
      gradBar(0, 5);
      // Logo top-right on every interior page
      if (logoDataUrl) {
        const iconS = 18;
        doc.addImage(logoDataUrl, "PNG", W - M - iconS, 10, iconS, iconS);
      }
      // Section title
      doc.setFont("helvetica","bold"); doc.setFontSize(17);
      doc.setTextColor(...ink); doc.text(title, M, y + 4); y += 16;
      // Purple underline
      doc.setDrawColor(...purple); doc.setLineWidth(2);
      doc.line(M, y, M + 40, y); y += 26;
    }

    function ensure(space, title) { if (y + space > H - 60) { footer(title); newPage(title + " (cont.)"); } }

    function heading(t) {
      ensure(42, t);
      doc.setFont("helvetica","bold"); doc.setFontSize(10.5);
      doc.setTextColor(...purple); doc.text(t, M, y); y += 17;
    }

    function para(t, size = 10, gap = 5) {
      doc.setFont("helvetica","normal"); doc.setFontSize(size);
      doc.setTextColor(...body);
      const lines = doc.splitTextToSize(t, W - M * 2);
      lines.forEach(ln => { ensure(size + gap, "Portfolio"); doc.text(ln, M, y); y += size + gap; });
    }

    /* ---- Cover page ---- */
    doc.setFillColor(...white); doc.rect(0, 0, W, H, "F");

    // Gradient top bar — full width, 14 pt tall
    gradBar(0, 14);

    // ObserveMD wordmark (large) below the bar
    const logoY = 58;
    const wmRightEdge = drawWordmark(M, logoY, wmLarge);

    // Subtitle tag
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
    doc.setTextColor(...muted);
    doc.text("HEALTHCARE OBSERVATION PORTFOLIO", M, logoY + 16);

    // Divider
    doc.setDrawColor(...border); doc.setLineWidth(0.75);
    doc.line(M, logoY + 28, W - M, logoY + 28);

    // Student name + meta
    const nameY = 160;
    doc.setFont("helvetica","bold"); doc.setFontSize(30);
    doc.setTextColor(...ink); doc.text(prof.name || "Student", M, nameY);
    doc.setFont("helvetica","normal"); doc.setFontSize(10.5); doc.setTextColor(...muted);
    const metaLine = [prof.school, prof.goal, prof.gradYear ? "Class of " + prof.gradYear : ""].filter(Boolean).join("  •  ");
    if (metaLine) doc.text(metaLine, M, nameY + 20);

    // Stat cards — light card style
    const coverStats = [
      ["Total Hours",   a.totalHours + " hrs"],
      ["Experiences",   String(getExperiences().length)],
      ["Specialties",   String(a.specialtiesCount)],
      ["Reflections",   String(a.respCount)],
    ];
    let cx = M, cy = 236;
    coverStats.forEach(c => {
      doc.setFillColor(245, 245, 250); doc.setDrawColor(...border);
      doc.roundedRect(cx, cy, 110, 70, 7, 7, "FD");
      doc.setTextColor(...purple); doc.setFont("helvetica","bold"); doc.setFontSize(20);
      doc.text(c[1], cx + 12, cy + 32);
      doc.setTextColor(...muted); doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
      doc.text(c[0].toUpperCase(), cx + 12, cy + 50);
      cx += 120;
    });

    // Generated date
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...muted);
    doc.text("Generated " + new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}), M, H - 44);

    // Footer wordmark on cover
    drawWordmark(M, H - 26, wmMedium);

    /* ---- Professional Summary ---- */
    newPage("Professional Summary");
    doc.setTextColor(...body);
    para(`${prof.name || "This student"} is a ${prof.goal || "pre-health"} student at ${prof.school || "their institution"} pursuing a future in healthcare. Through the ObserveMD platform, ${(prof.name||"they").split(" ")[0]} has documented ${a.totalHours} hours across ${a.sessions} structured observation sessions spanning ${a.specialtiesCount} medical specialties and ${a.providersCount} healthcare providers.`, 11, 7);
    y += 6;
    para(`The most explored specialty is ${a.topSpec ? a.topSpec[0] : "n/a"}, and reflective writing across these sessions totals ${a.totalWords.toLocaleString()} words with an average of ${a.avgReflection} words per response. This portfolio demonstrates sustained commitment, breadth of clinical exposure, and a consistent practice of structured reflection.`, 11, 7);

    y += 10; heading("Key Metrics");
    [
      `Average session length: ${a.avgSession} hours`,
      `Longest session: ${a.longest} hours  •  Shortest session: ${a.shortest} hours`,
      `Longest observation streak: ${a.bestStreak} consecutive day(s)`,
      `Most active day of week: ${a.topDay}`,
      `Unique concepts referenced in reflections: ${a.uniqueWords}`,
    ].forEach(t => para("•  " + t, 10, 6));

    /* ---- Analytics Summary ---- */
    newPage("Analytics Summary");
    heading("Hours by Specialty");
    const specSorted = Object.entries(a.bySpec).sort((x, z) => z[1] - x[1]);
    const maxSpec = Math.max(...specSorted.map(s => s[1]), 1);
    specSorted.forEach(([s, hrs]) => {
      ensure(22, "Analytics");
      doc.setFontSize(9); doc.setTextColor(...body);
      doc.text(s, M, y + 8);
      const bw = (hrs / maxSpec) * 200;
      doc.setFillColor(...purple); doc.roundedRect(M + 180, y, Math.max(bw, 2), 9, 2, 2, "F");
      doc.setTextColor(...muted); doc.text(round(hrs) + " h", M + 190 + bw, y + 8);
      y += 20;
    });
    y += 8; heading("Recurring Reflection Themes");
    Object.entries(a.themeCounts).sort((x,z)=>z[1]-x[1]).forEach(([t,c])=>
      para(`•  ${t}: referenced ${c} time(s)`, 10, 6));

    /* ---- Growth Report ---- */
    newPage("Growth Report");
    para("Reflection depth over time, measured by total words written per month. A rising trend indicates growing reflective complexity and engagement.", 10, 6);
    y += 6; heading("Reflection Words per Month");
    const wm = Object.entries(a.wordsByMonth).sort();
    const maxW = Math.max(...wm.map(m=>m[1]), 1);
    wm.forEach(([k,v]) => {
      ensure(20, "Growth");
      doc.setFontSize(9); doc.setTextColor(...body); doc.text(monthLabel(k), M, y+8);
      const bww = (v/maxW)*220;
      // Use purple for the growth bars — gradient only lives in the wordmark/bar
      doc.setFillColor(...purple); doc.roundedRect(M+80, y, Math.max(bww,2), 9, 2, 2, "F");
      doc.setTextColor(...muted); doc.text(v + " w", M+90+bww, y+8);
      y += 18;
    });
    const early = a.list.slice(-1)[0], recent2 = a.list[0];
    if (early && recent2 && early !== recent2) {
      y += 8; heading("Early vs. Recent Reflection");
      const ew = Object.values(early.reflections||{}).reduce((s,t)=>s+wordCount(t),0);
      const rw = Object.values(recent2.reflections||{}).reduce((s,t)=>s+wordCount(t),0);
      para(`Earliest session (${fmtDate(early.date)}): ${ew} words of reflection.`, 10, 6);
      para(`Most recent session (${fmtDate(recent2.date)}): ${rw} words of reflection.`, 10, 6);
    }

    /* ---- Reflection Highlights ---- */
    newPage("Reflection Highlights");
    para("Selected responses demonstrating meaningful insight and reflective growth.", 10, 8);
    const highlights = [...a.list].sort((x,z)=>{
      const wx=Object.values(x.reflections||{}).join(" ").length;
      const wz=Object.values(z.reflections||{}).join(" ").length;
      return wz-wx;
    }).slice(0,4);
    highlights.forEach(o => {
      heading(`${o.specialty} — ${fmtDate(o.date)}`);
      para("Q: How did this experience influence your understanding of healthcare?", 9, 5);
      doc.setTextColor(...body);
      para(`"${o.reflections[4]||o.reflections[0]||""}"`, 10, 6);
      y += 6;
    });

    /* ---- Complete Experience Log ---- */
    newPage("Complete Experience Log");
    getExperiences().forEach((e, idx) => {
      ensure(62, "Experience Log");
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...ink);
      doc.text(`${idx+1}. ${e.title}`, M, y);
      doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...muted);
      doc.text(`${e.totalHours || 0} hrs  •  ${e.totalObservations || 0} observations`, W-M, y, {align:"right"});
      y += 15;
      doc.setTextColor(...body); doc.setFontSize(9);
      const dateRange = [e.startDate, e.endDate].filter(Boolean).map(d => fmtDate(d)).join(" – ") || "No dates";
      doc.text(`${e.specialty || "—"}  —  ${e.organization || e.location || "—"}`, M, y); y += 13;
      doc.text(`${dateRange}  •  Verification: ${e.verificationStatus || "unverified"}`, M, y);
      y += 20;
    });

    /* ---- Reflection Archive ---- */
    newPage("Reflection Archive");
    a.list.forEach(o => {
      ensure(60, "Reflection Archive");
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...ink);
      doc.text(`${o.specialty} — ${fmtDate(o.date)}`, M, y); y += 16;
      REFLECTION_QUESTIONS.forEach((q, qi) => {
        ensure(40, "Reflection Archive");
        doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...muted);
        const ql = doc.splitTextToSize(`Q${qi+1}. ${q}`, W-M*2);
        ql.forEach(l => { doc.text(l, M, y); y += 12; });
        doc.setFont("helvetica","normal"); doc.setTextColor(...body);
        para(o.reflections[qi]||"—", 9, 5);
        y += 4;
      });
      y += 10;
    });

    // Footers on all interior pages
    const pages = doc.internal.getNumberOfPages();
    for (let i = 2; i <= pages; i++) { doc.setPage(i); footer(`Page ${i} of ${pages}`); }

    doc.save(`ObserveMD_Portfolio_${(prof.name||"Student").replace(/\s+/g,"_")}.pdf`);
    toast("Portfolio downloaded");
  }

  /* ---- seedIfEmpty kept as no-op (no sample data) ---- */
  function seedIfEmpty() {}

  return {
    init,
    REFLECTION_QUESTIONS, SPECIALTIES, THEMES,
    getAll, getExperiences, getExperience, getObservationsForExperience, add, addExperience, remove, getProfile, saveProfile, seedIfEmpty,
    hoursBetween, fmtDate, monthKey, monthLabel, wordCount, round,
    analytics, renderSidebar, toast, openObservationModal, openExperienceModal,
    lineChart, barChart, donut, colorFor, exportPortfolio,
  };
})();
