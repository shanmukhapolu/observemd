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
  }

  async function _loadAll() {
    const { collection, query, where, orderBy, getDocs } = await _fs();
    const col = collection(_db, "observations");
    const q   = query(col, where("uid", "==", _uid), orderBy("date", "desc"));
    const snap = await getDocs(q);
    _list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---- Public data API ---- */
  function getAll() { return _list; }

  async function add(obs) {
    const { collection, addDoc } = await _fs();
    obs.uid       = _uid;
    obs.createdAt = new Date().toISOString();
    const ref  = await addDoc(collection(_db, "observations"), obs);
    obs.id     = ref.id;
    _list.unshift(obs);
    _list.sort((a, b) => new Date(b.date) - new Date(a.date));
    return obs;
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
      byMonth, monthsSorted, sessMonth, bySpec, byDay, dayNames,
      longest: round(longest), shortest: round(shortest), avgSession,
      bestStreak: best, totalWords, avgReflection, wordsByMonth, themeCounts, uniqueWords,
      topSpec, lowSpec, topMonth, topDay: dayNames[topDay],
    };
  }

  /* ---- Sidebar ---- */
  const NAV = [
    { id: "dashboard",    label: "Dashboard",       icon: "layout-dashboard", href: "dashboard.html" },
    { id: "observations", label: "Observations",     icon: "eye",             href: "observations.html" },
    { id: "reflections",  label: "Reflections",      icon: "book-open",       href: "reflections.html" },
    { id: "analytics",    label: "Analytics",        icon: "bar-chart-3",     href: "analytics.html" },
    { id: "export",       label: "Export Portfolio", icon: "download",        href: "#export" },
  ];

  function renderSidebar(active) {
    const items = NAV.map(n => `
      <a class="nav-item ${n.id === active ? "active" : ""}" href="${n.href}" data-nav="${n.id}">
        <i data-lucide="${n.icon}"></i>${n.label}
      </a>`).join("");

    const html = `
      <div class="mobile-bar">
        <div class="logo" style="margin:0;font-size:1.2rem;">
          <span class="logo-mark"><img src="assets/logo-white.png" alt="ObserveMD icon"></span><span class="logo-text">Observe</span><span class="logo-md">MD</span>
        </div>
        <button class="menu-btn" id="menuBtn"><i data-lucide="menu"></i></button>
      </div>
      <aside class="sidebar" id="sidebar">
        <div class="logo">
          <span class="logo-mark"><img src="assets/logo-white.png" alt="ObserveMD icon"></span><span class="logo-text">Observe</span><span class="logo-md">MD</span>
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

    document.querySelector('[data-nav="export"]').addEventListener("click", (e) => {
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
  function openObservationModal(onSaved) {
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
              <div class="field"><label>Specialty *</label><select name="specialty" required>${specOpts}</select></div>
              <div class="field"><label>Provider Name *</label><input name="providerName" required placeholder="Dr. Jane Smith"></div>
              <div class="field"><label>Provider Title *</label><input name="providerTitle" required placeholder="Attending Physician"></div>
              <div class="field full"><label>Location *</label><input name="location" required placeholder="St. Mary's Medical Center"></div>
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
        const obs = {
          date:          f.get("date"),
          specialty:     f.get("specialty"),
          providerName:  f.get("providerName").trim(),
          providerTitle: f.get("providerTitle").trim(),
          location:      f.get("location").trim(),
          startTime:     f.get("startTime"),
          endTime:       f.get("endTime"),
          hours:         hoursBetween(f.get("startTime"), f.get("endTime")),
          notes:         f.get("notes").trim(),
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
    overlay.classList.add("open");
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

    const purple = [124, 58, 237], cyan = [6, 182, 212], dark = [30, 35, 45], grey = [110, 120, 135];
    const bg = [10, 11, 15], card = [18, 21, 32], muted = [100, 116, 139];

    /* ---- helper fns ---- */
    function footer(label) {
      // Mini ObserveMD wordmark bottom-left — Observe white, M purple, D cyan
      doc.setFont("helvetica","bold"); doc.setFontSize(8);
      doc.setTextColor(220, 225, 235); doc.text("Observe", M, H - 28, {baseline:"bottom"});
      const pw = doc.getTextWidth("Observe");
      doc.setTextColor(...purple); doc.text("M", M + pw, H - 28, {baseline:"bottom"});
      const mfw = doc.getTextWidth("M");
      doc.setTextColor(...cyan);   doc.text("D", M + pw + mfw, H - 28, {baseline:"bottom"});
      const dw = doc.getTextWidth("D");
      doc.setTextColor(...muted);  doc.setFont("helvetica","normal");
      doc.text("  •  " + prof.name, M + pw + mfw + dw, H - 28, {baseline:"bottom"});
      doc.text(label, W - M, H - 28, { align: "right", baseline:"bottom" });
    }

    function newPage(title) {
      doc.addPage(); y = M;
      // Thin top accent bar
      doc.setFillColor(...purple); doc.rect(0, 0, W, 4, "F");
      doc.setFillColor(...cyan);   doc.rect(0, 4, W, 2, "F");
      // Section title
      doc.setTextColor(...purple); doc.setFont("helvetica","bold"); doc.setFontSize(18);
      doc.text(title, M, y + 6); y += 16;
      doc.setDrawColor(...purple); doc.setLineWidth(1.5);
      doc.line(M, y, M + 48, y); y += 28;
      doc.setTextColor(220, 225, 235);
    }

    function ensure(space, title) { if (y + space > H - 60) { footer(title); newPage(title + " (cont.)"); } }

    function heading(t) {
      ensure(42, t); doc.setFont("helvetica","bold"); doc.setFontSize(11);
      doc.setTextColor(...cyan); doc.text(t, M, y); y += 18;
      doc.setTextColor(200, 205, 215);
    }

    function para(t, size = 10, gap = 5) {
      doc.setFont("helvetica","normal"); doc.setFontSize(size);
      doc.setTextColor(190, 198, 215);
      const lines = doc.splitTextToSize(t, W - M * 2);
      lines.forEach(ln => { ensure(size + gap, "Portfolio"); doc.text(ln, M, y); y += size + gap; });
    }

    /* ---- Cover page ---- */
    doc.setFillColor(...bg); doc.rect(0, 0, W, H, "F");

    // Top gradient bar
    doc.setFillColor(...purple); doc.rect(0, 0, W, 10, "F");
    doc.setFillColor(...cyan);   doc.rect(0, 10, W, 4, "F");

    // ObserveMD wordmark top-left — Observe in white, MD in brand gradient cyan
    const logoY = 60;
    doc.setFont("helvetica","bold"); doc.setFontSize(28);
    doc.setTextColor(248, 250, 252); doc.text("Observe", M, logoY);
    const logoW = doc.getTextWidth("Observe");
    // MD: use the gradient end colour (cyan) to match the in-app gradient effect
    doc.setTextColor(124, 58, 237); doc.text("M", M + logoW, logoY);
    const mW = doc.getTextWidth("M");
    doc.setTextColor(6, 182, 212); doc.text("D", M + logoW + mW, logoY);

    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.setTextColor(...muted);
    doc.text("HEALTHCARE OBSERVATION PORTFOLIO", M, logoY + 18);

    // Divider line under wordmark
    doc.setDrawColor(40, 46, 66); doc.setLineWidth(1);
    doc.line(M, logoY + 30, W - M, logoY + 30);

    // Student name + meta
    const nameY = 160;
    doc.setFont("helvetica","bold"); doc.setFontSize(30);
    doc.setTextColor(240, 244, 255); doc.text(prof.name || "Student", M, nameY);
    doc.setFont("helvetica","normal"); doc.setFontSize(11); doc.setTextColor(...muted);
    const metaLine = [prof.school, prof.goal, prof.gradYear ? "Class of " + prof.gradYear : ""].filter(Boolean).join("  •  ");
    doc.text(metaLine, M, nameY + 22);

    // Stat cards on cover
    const cover = [
      ["Total Hours", a.totalHours + " hrs"],
      ["Observations", String(a.sessions)],
      ["Specialties", String(a.specialtiesCount)],
      ["Reflections", String(a.respCount)],
    ];
    let cx = M, cy = 240;
    cover.forEach(c => {
      doc.setFillColor(21, 24, 38); doc.setDrawColor(35, 40, 58);
      doc.roundedRect(cx, cy, 108, 74, 7, 7, "FD");
      doc.setTextColor(...cyan); doc.setFont("helvetica","bold"); doc.setFontSize(20);
      doc.text(c[1], cx + 12, cy + 36);
      doc.setTextColor(...muted); doc.setFont("helvetica","normal"); doc.setFontSize(8);
      doc.text(c[0], cx + 12, cy + 54);
      cx += 118;
    });

    // Generated date
    doc.setTextColor(...muted); doc.setFontSize(9);
    doc.text("Generated " + new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}), M, H - 60);

    // ObserveMD wordmark bottom-left of cover — Observe white, M purple, D cyan
    doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.setTextColor(220, 225, 235); doc.text("Observe", M, H - 40);
    const bw2 = doc.getTextWidth("Observe");
    doc.setTextColor(...purple); doc.text("M", M + bw2, H - 40);
    const bw3 = doc.getTextWidth("M");
    doc.setTextColor(...cyan); doc.text("D", M + bw2 + bw3, H - 40);

    /* ---- Professional Summary ---- */
    newPage("Professional Summary");
    doc.setTextColor(200, 208, 225);
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
      doc.setFontSize(9); doc.setTextColor(160, 170, 190);
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
      doc.setFontSize(9); doc.setTextColor(160,170,190); doc.text(monthLabel(k), M, y+8);
      const bww = (v/maxW)*220;
      doc.setFillColor(...cyan); doc.roundedRect(M+80, y, Math.max(bww,2), 9, 2, 2, "F");
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
      doc.setTextColor(160,170,195);
      para(`"${o.reflections[4]||o.reflections[0]||""}"`, 10, 6);
      y += 6;
    });

    /* ---- Complete Observation Log ---- */
    newPage("Complete Observation Log");
    a.list.forEach((o, idx) => {
      ensure(70, "Observation Log");
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...purple);
      doc.text(`${idx+1}. ${o.specialty}`, M, y);
      doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...muted);
      doc.text(`${fmtDate(o.date)}  •  ${o.hours} hrs`, W-M, y, {align:"right"});
      y += 15;
      doc.setTextColor(160,170,190); doc.setFontSize(9);
      doc.text(`${o.providerName}, ${o.providerTitle}  —  ${o.location}  (${o.startTime}–${o.endTime})`, M, y);
      y += 14;
      para(o.notes||"", 9, 5);
      y += 8;
    });

    /* ---- Reflection Archive ---- */
    newPage("Reflection Archive");
    a.list.forEach(o => {
      ensure(60, "Reflection Archive");
      doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...purple);
      doc.text(`${o.specialty} — ${fmtDate(o.date)}`, M, y); y += 16;
      REFLECTION_QUESTIONS.forEach((q, qi) => {
        ensure(40, "Reflection Archive");
        doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(90,100,120);
        const ql = doc.splitTextToSize(`Q${qi+1}. ${q}`, W-M*2);
        ql.forEach(l => { doc.text(l, M, y); y += 12; });
        doc.setFont("helvetica","normal"); doc.setTextColor(160,170,195);
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
    getAll, add, remove, getProfile, saveProfile, seedIfEmpty,
    hoursBetween, fmtDate, monthKey, monthLabel, wordCount, round,
    analytics, renderSidebar, toast, openObservationModal,
    lineChart, barChart, donut, colorFor, exportPortfolio,
  };
})();
