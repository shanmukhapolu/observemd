/* ============================================================
   ObserveMD — Shared App Logic
   Data layer (localStorage), sidebar, charts, modal, analytics, PDF
   ============================================================ */

const OMD = (() => {
  const STORE_KEY = "observemd:observations:v1";
  const PROFILE_KEY = "observemd:profile:v1";

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
    "Patient Communication": ["communicat", "explain", "listen", "talk", "conversation", "rapport", "bedside"],
    "Empathy": ["empath", "compassion", "comfort", "caring", "kind", "reassur", "gentle"],
    "Professionalism": ["professional", "respect", "ethic", "punctual", "demeanor", "composed"],
    "Leadership": ["lead", "direct", "decision", "command", "guide", "charge", "oversee"],
    "Teamwork": ["team", "collaborat", "nurse", "coordinat", "together", "staff", "colleague"],
    "Clinical Decision Making": ["diagnos", "decision", "assess", "treatment", "evaluat", "clinical", "judgment", "differential"],
  };

  /* ---------------- Storage ---------------- */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  }
  function persist(list) { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }

  function getAll() {
    return load().sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  function add(obs) {
    const list = load();
    obs.id = uid();
    obs.createdAt = new Date().toISOString();
    list.push(obs);
    persist(list);
    return obs;
  }
  function remove(id) { persist(load().filter(o => o.id !== id)); }

  function getProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || defaultProfile(); }
    catch { return defaultProfile(); }
  }
  function defaultProfile() {
    return { name: "Alex Morgan", email: "alex.morgan@student.edu", school: "Riverside High School", goal: "Pre-Med", gradYear: "2027" };
  }
  function saveProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

  /* ---------------- Helpers ---------------- */
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

  /* ---------------- Seed data ---------------- */
  function seedIfEmpty() {
    if (load().length) return;
    const providers = [
      ["Dr. Priya Patel", "Attending Physician", "Emergency Medicine", "St. Mary's Medical Center"],
      ["Dr. James Lee", "Pediatrician", "Pediatrics", "Children's Hospital"],
      ["Dr. Sarah Wilson", "Cardiologist", "Cardiology", "Heart & Vascular Institute"],
      ["Dr. Marcus Chen", "General Surgeon", "Surgery", "St. Mary's Medical Center"],
      ["Dr. Elena Ruiz", "Neurologist", "Neurology", "University Neuro Clinic"],
      ["Dr. David Okafor", "Family Physician", "Family Medicine", "Riverside Family Practice"],
      ["Dr. Hannah Kim", "Oncologist", "Oncology", "Regional Cancer Center"],
      ["Dr. Tom Becker", "Orthopedic Surgeon", "Orthopedics", "Sports Medicine Center"],
    ];
    const notesBank = [
      "Shadowed during a busy shift. Watched the team triage multiple incoming patients and prioritize care under pressure.",
      "Observed several routine check-ups and one urgent consult. Saw how the provider adjusts communication for each family.",
      "Sat in on rounds and a procedure prep. Took notes on how decisions were explained to the patient.",
      "Followed the provider through morning consults. Noticed the careful balance of efficiency and compassion.",
      "Observed a diagnostic workup from intake to plan. The reasoning behind each test was walked through clearly.",
    ];
    const refBank = [
      [
        "I watched the team manage three patients arriving almost at once, moving between rooms while keeping each plan straight.",
        "How calm everyone stayed even when the waiting room was overflowing. The pace never turned into panic.",
        "The attending's ability to make fast decisions while still explaining them clearly to the resident and the patient.",
        "Communicating bad news to a worried family while other urgent cases were waiting for attention.",
        "It showed me medicine is as much about coordination and communication as it is about clinical knowledge.",
        "How do physicians decompress after an emotionally heavy shift without carrying it into the next patient?",
      ],
      [
        "I observed well-child visits where the doctor turned each exam into a game so the kids stayed comfortable.",
        "How much of pediatrics is actually reassuring the parents rather than the child.",
        "The patience and warmth used to build trust with a nervous toddler within just a couple of minutes.",
        "A language barrier with one family meant relying on an interpreter, which slowed the rhythm of the visit.",
        "I now see empathy as a clinical skill, not just a personality trait — it changes how information lands.",
        "How do pediatricians decide when a parent's worry warrants further testing versus reassurance?",
      ],
      [
        "I followed an echocardiogram and a consult where the cardiologist mapped out a treatment plan step by step.",
        "How visual the work is — so much was read directly off imaging and rhythm strips in real time.",
        "The precision in interpreting subtle changes on the monitor that I would have completely missed.",
        "Explaining a serious diagnosis to a patient who was clearly frightened took real care and time.",
        "It deepened my appreciation for how specialists translate data into decisions patients can understand.",
        "What does the long-term relationship between a cardiologist and a chronic patient actually look like?",
      ],
      [
        "I observed a pre-op briefing and part of a procedure, watching the whole team confirm each step aloud.",
        "The level of choreography in the OR — everyone knew their role without much being said.",
        "The surgeon's steady focus and the way they narrated decisions for the students present.",
        "An unexpected finding mid-procedure required the plan to be adjusted quickly and calmly.",
        "I understand now how much teamwork and preparation sit behind a single operation.",
        "How do surgeons train themselves to stay composed when something unexpected happens?",
      ],
      [
        "I sat in on neuro consults and a reflex examination, watching the diagnostic reasoning unfold.",
        "How detailed the physical exam is — tiny observations led to big conclusions.",
        "The methodical questioning that gradually narrowed down a complex set of symptoms.",
        "Delivering an uncertain prognosis honestly while still leaving the patient with hope.",
        "It reframed diagnosis for me as detective work guided by both science and empathy.",
        "How do neurologists keep up with such a fast-evolving field while staying present with patients?",
      ],
    ];

    const today = new Date();
    const samples = [];
    // create ~16 sessions spread over ~8 months
    for (let i = 0; i < 16; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (i * 15 + (i % 3) * 4));
      const p = providers[i % providers.length];
      const startH = 8 + (i % 5);
      const dur = 2 + (i % 4); // 2..5 hrs
      const start = String(startH).padStart(2, "0") + ":00";
      const end = String(startH + dur).padStart(2, "0") + ":00";
      const r = refBank[i % refBank.length];
      const reflections = {};
      REFLECTION_QUESTIONS.forEach((q, qi) => reflections[qi] = r[qi]);
      samples.push({
        id: uid(),
        createdAt: d.toISOString(),
        date: d.toISOString().slice(0, 10),
        providerName: p[0], providerTitle: p[1], specialty: p[2], location: p[3],
        startTime: start, endTime: end,
        hours: hoursBetween(start, end),
        notes: notesBank[i % notesBank.length],
        reflections,
      });
    }
    persist(samples);
  }

  /* ---------------- Analytics ---------------- */
  function analytics() {
    const list = getAll();
    const totalHours = round(list.reduce((s, o) => s + (o.hours || 0), 0));
    const sessions = list.length;
    const specialtiesSet = new Set(list.map(o => o.specialty));
    const providersSet = new Set(list.map(o => o.providerName));

    // hours per month
    const byMonth = {};
    list.forEach(o => { byMonth[monthKey(o.date)] = (byMonth[monthKey(o.date)] || 0) + (o.hours || 0); });
    const monthsSorted = Object.keys(byMonth).sort();

    // sessions per month
    const sessMonth = {};
    list.forEach(o => { sessMonth[monthKey(o.date)] = (sessMonth[monthKey(o.date)] || 0) + 1; });

    // hours per specialty
    const bySpec = {};
    list.forEach(o => { bySpec[o.specialty] = (bySpec[o.specialty] || 0) + (o.hours || 0); });

    // hours per weekday
    const byDay = [0, 0, 0, 0, 0, 0, 0];
    list.forEach(o => { byDay[new Date(o.date + "T00:00:00").getDay()] += (o.hours || 0); });

    const durations = list.map(o => o.hours || 0).filter(Boolean);
    const longest = durations.length ? Math.max(...durations) : 0;
    const shortest = durations.length ? Math.min(...durations) : 0;
    const avgSession = sessions ? round(totalHours / sessions) : 0;

    // streak (consecutive distinct observation days)
    const days = [...new Set(list.map(o => o.date))].sort();
    let streak = 0, best = 0;
    for (let i = 0; i < days.length; i++) {
      if (i === 0) { streak = 1; }
      else {
        const diff = (new Date(days[i]) - new Date(days[i - 1])) / 86400000;
        streak = diff === 1 ? streak + 1 : 1;
      }
      best = Math.max(best, streak);
    }

    // reflections
    let totalWords = 0, respCount = 0;
    const wordsByMonth = {};
    list.forEach(o => {
      let w = 0;
      Object.values(o.reflections || {}).forEach(a => { const c = wordCount(a); w += c; if (c) respCount++; });
      totalWords += w;
      wordsByMonth[monthKey(o.date)] = (wordsByMonth[monthKey(o.date)] || 0) + w;
    });
    const avgReflection = respCount ? Math.round(totalWords / respCount) : 0;

    // themes
    const themeCounts = {};
    Object.keys(THEMES).forEach(t => themeCounts[t] = 0);
    list.forEach(o => {
      const text = Object.values(o.reflections || {}).join(" ").toLowerCase();
      Object.entries(THEMES).forEach(([t, kws]) => {
        kws.forEach(k => { const m = text.match(new RegExp(k, "g")); if (m) themeCounts[t] += m.length; });
      });
    });

    // vocabulary
    const allWords = list.flatMap(o => Object.values(o.reflections || {}).join(" ").toLowerCase().match(/[a-z]{3,}/g) || []);
    const uniqueWords = new Set(allWords).size;

    const topSpec = Object.entries(bySpec).sort((a, b) => b[1] - a[1])[0];
    const lowSpec = Object.entries(bySpec).sort((a, b) => a[1] - b[1])[0];
    const topMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const topDay = byDay.indexOf(Math.max(...byDay));

    return {
      list, totalHours, sessions, specialtiesCount: specialtiesSet.size,
      providersCount: providersSet.size, respCount,
      byMonth, monthsSorted, sessMonth, bySpec, byDay, dayNames,
      longest: round(longest), shortest: round(shortest), avgSession,
      bestStreak: best, totalWords, avgReflection, wordsByMonth, themeCounts, uniqueWords,
      topSpec, lowSpec, topMonth, topDay: dayNames[topDay],
    };
  }

  /* ---------------- Sidebar ---------------- */
  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: "layout-dashboard", href: "dashboard.html" },
    { id: "observations", label: "Observations", icon: "eye", href: "observations.html" },
    { id: "reflections", label: "Reflections", icon: "book-open", href: "reflections.html" },
    { id: "analytics", label: "Analytics", icon: "bar-chart-3", href: "analytics.html" },
    { id: "export", label: "Export Portfolio", icon: "download", href: "#export" },
  ];

  function renderSidebar(active) {
    const items = NAV.map(n => `
      <a class="nav-item ${n.id === active ? "active" : ""}" href="${n.href}" data-nav="${n.id}">
        <i data-lucide="${n.icon}"></i>${n.label}
      </a>`).join("");

    const html = `
      <div class="mobile-bar">
        <div class="logo" style="margin:0;font-size:1.2rem;">
          <span class="logo-mark"><i data-lucide="stethoscope"></i></span>Observe<span>MD</span>
        </div>
        <button class="menu-btn" id="menuBtn"><i data-lucide="menu"></i></button>
      </div>
      <aside class="sidebar" id="sidebar">
        <div class="logo">
          <span class="logo-mark"><i data-lucide="stethoscope"></i></span>Observe<span>MD</span>
        </div>
        <nav class="nav">${items}</nav>
        <div class="spacer"></div>
        <a class="nav-item ${active === "settings" ? "active" : ""}" href="settings.html" data-nav="settings">
          <i data-lucide="settings"></i>Settings
        </a>
      </aside>`;

    document.body.insertAdjacentHTML("afterbegin", html);

    // export action
    document.querySelector('[data-nav="export"]').addEventListener("click", (e) => {
      e.preventDefault();
      exportPortfolio();
    });
    const mb = document.getElementById("menuBtn");
    if (mb) mb.addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  }

  /* ---------------- Toast ---------------- */
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.innerHTML = `<i data-lucide="check-circle"></i><span>${msg}</span>`;
    if (window.lucide) lucide.createIcons();
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ---------------- Observation modal ---------------- */
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

      overlay.querySelector("#obsForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const reflections = {};
        REFLECTION_QUESTIONS.forEach((q, i) => reflections[i] = (f.get("r" + i) || "").trim());
        const obs = {
          date: f.get("date"),
          specialty: f.get("specialty"),
          providerName: f.get("providerName").trim(),
          providerTitle: f.get("providerTitle").trim(),
          location: f.get("location").trim(),
          startTime: f.get("startTime"),
          endTime: f.get("endTime"),
          hours: hoursBetween(f.get("startTime"), f.get("endTime")),
          notes: f.get("notes").trim(),
          reflections,
        };
        add(obs);
        overlay.classList.remove("open");
        e.target.reset();
        toast("Observation saved");
        if (onSaved) onSaved();
      });
      if (window.lucide) lucide.createIcons();
    }
    // default date today
    overlay.querySelector('[name="date"]').value = new Date().toISOString().slice(0, 10);
    overlay.classList.add("open");
  }

  /* ---------------- Charts (SVG) ---------------- */
  const PAL = ["#7c3aed", "#06b6d4", "#22c55e", "#f59e0b", "#f43f5e", "#3b82f6", "#ec4899", "#14b8a6", "#a855f7", "#eab308", "#10b981", "#ef4444", "#8b5cf6", "#0ea5e9"];

  function lineChart(el, labels, values, opts = {}) {
    const w = el.clientWidth || 600, h = opts.height || 280;
    const pad = { t: 20, r: 16, b: 34, l: 40 };
    const max = Math.max(...values, 1) * 1.15;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const x = i => pad.l + (values.length <= 1 ? iw / 2 : (i / (values.length - 1)) * iw);
    const y = v => pad.t + ih - (v / max) * ih;
    const pts = values.map((v, i) => [x(i), y(v)]);
    const linePath = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
    const areaPath = linePath + ` L${x(values.length - 1)} ${pad.t + ih} L${x(0)} ${pad.t + ih} Z`;
    const gridY = [0, .25, .5, .75, 1].map(f => {
      const yy = pad.t + ih - f * ih; const val = Math.round(max * f);
      return `<line x1="${pad.l}" y1="${yy}" x2="${w - pad.r}" y2="${yy}" stroke="#222633" stroke-width="1"/>
              <text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" fill="#64748b" font-size="11">${val}</text>`;
    }).join("");
    const xlabs = labels.map((l, i) => i % Math.ceil(labels.length / 8 || 1) === 0
      ? `<text x="${x(i)}" y="${h - 12}" text-anchor="middle" fill="#64748b" font-size="11">${l}</text>` : "").join("");
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
    const bw = iw / values.length * 0.6;
    const gap = iw / values.length;
    const gridY = [0, .25, .5, .75, 1].map(f => {
      const yy = pad.t + ih - f * ih;
      return `<line x1="${pad.l}" y1="${yy}" x2="${w - pad.r}" y2="${yy}" stroke="#222633"/>
              <text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" fill="#64748b" font-size="11">${Math.round(max * f)}</text>`;
    }).join("");
    const bars = values.map((v, i) => {
      const bh = (v / max) * ih;
      const bx = pad.l + i * gap + (gap - bw) / 2;
      const by = pad.t + ih - bh;
      const lab = i % Math.ceil(labels.length / 10 || 1) === 0
        ? `<text x="${bx + bw / 2}" y="${h - 12}" text-anchor="middle" fill="#64748b" font-size="11">${labels[i]}</text>` : "";
      return `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${opts.color || "#7c3aed"}"/>${lab}`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${gridY}${bars}</svg>`;
  }

  function donut(el, entries, opts = {}) {
    const size = opts.size || 200, r = size / 2, ir = r * 0.62;
    const total = entries.reduce((s, e) => s + e[1], 0) || 1;
    let a0 = -Math.PI / 2;
    const arcs = entries.map((e, i) => {
      const frac = e[1] / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (ang, rad) => [r + Math.cos(ang) * rad, r + Math.sin(ang) * rad];
      const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r);
      const [ix1, iy1] = p(a1, ir), [ix0, iy0] = p(a0, ir);
      a0 = a1;
      return `<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${ix1} ${iy1} A${ir} ${ir} 0 ${large} 0 ${ix0} ${iy0} Z" fill="${PAL[i % PAL.length]}"/>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}
      <text x="${r}" y="${r - 4}" text-anchor="middle" fill="#f8fafc" font-size="22" font-weight="700" font-family="Space Grotesk">${opts.center || total}</text>
      <text x="${r}" y="${r + 16}" text-anchor="middle" fill="#94a3b8" font-size="11">${opts.label || ""}</text></svg>`;
  }

  function colorFor(i) { return PAL[i % PAL.length]; }

  /* ---------------- PDF Export ---------------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function exportPortfolio() {
    toast("Generating portfolio PDF...");
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    } catch {
      alert("Could not load the PDF library. Check your connection and try again.");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const a = analytics();
    const prof = getProfile();
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 56;
    let y = 0;

    const purple = [124, 58, 237], cyan = [6, 182, 212], dark = [30, 35, 45], grey = [110, 120, 135];

    function footer(label) {
      doc.setFontSize(8); doc.setTextColor(...grey);
      doc.text("ObserveMD Portfolio  •  " + prof.name, M, H - 28);
      doc.text(label, W - M, H - 28, { align: "right" });
    }
    function newPage(title) {
      doc.addPage(); y = M;
      doc.setTextColor(...purple); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text(title, M, y); y += 10;
      doc.setDrawColor(...purple); doc.setLineWidth(2); doc.line(M, y, M + 60, y); y += 26;
      doc.setTextColor(40, 45, 55);
    }
    function ensure(space, title) { if (y + space > H - 50) { footer(title); newPage(title + " (cont.)"); } }
    function heading(t) {
      ensure(40, t); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.setTextColor(...purple); doc.text(t, M, y); y += 18; doc.setTextColor(40, 45, 55);
    }
    function para(t, size = 10, gap = 5) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(size);
      const lines = doc.splitTextToSize(t, W - M * 2);
      lines.forEach(ln => { ensure(size + gap, "Portfolio"); doc.text(ln, M, y); y += size + gap; });
    }

    /* ---- Cover ---- */
    doc.setFillColor(10, 11, 15); doc.rect(0, 0, W, H, "F");
    doc.setFillColor(...purple); doc.rect(0, 0, W, 8, "F");
    doc.setFillColor(...cyan); doc.rect(0, 8, W, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(34);
    doc.text("ObserveMD", M, 150);
    doc.setTextColor(...cyan); doc.setFontSize(13); doc.setFont("helvetica", "normal");
    doc.text("HEALTHCARE OBSERVATION PORTFOLIO", M, 174);

    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(26);
    doc.text(prof.name, M, 250);
    doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(180, 188, 205);
    doc.text(`${prof.school || ""}  •  ${prof.goal || ""}  •  Class of ${prof.gradYear || ""}`, M, 274);

    const cover = [
      ["Total Hours", a.totalHours + " hrs"],
      ["Observations", String(a.sessions)],
      ["Specialties", String(a.specialtiesCount)],
      ["Reflections", String(a.respCount)],
    ];
    let cx = M, cy = 340;
    cover.forEach(c => {
      doc.setDrawColor(60, 66, 80); doc.setFillColor(21, 24, 33);
      doc.roundedRect(cx, cy, 110, 80, 8, 8, "FD");
      doc.setTextColor(...cyan); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
      doc.text(c[1], cx + 14, cy + 40);
      doc.setTextColor(150, 158, 175); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(c[0], cx + 14, cy + 60);
      cx += 124;
    });
    doc.setTextColor(150, 158, 175); doc.setFontSize(10);
    doc.text("Generated " + new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), M, H - 60);

    /* ---- Professional Summary ---- */
    newPage("Professional Summary");
    para(`${prof.name} is a ${prof.goal || "pre-health"} student at ${prof.school || "their institution"} pursuing a future in healthcare. Through the ObserveMD platform, ${prof.name.split(" ")[0]} has documented ${a.totalHours} hours across ${a.sessions} structured observation sessions spanning ${a.specialtiesCount} medical specialties and ${a.providersCount} healthcare providers.`, 11, 7);
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
      ensure(20, "Analytics");
      doc.setFontSize(9); doc.setTextColor(60, 66, 80);
      doc.text(s, M, y + 8);
      const bw = (hrs / maxSpec) * 200;
      doc.setFillColor(...purple); doc.roundedRect(M + 180, y, Math.max(bw, 2), 9, 2, 2, "F");
      doc.setTextColor(...grey); doc.text(round(hrs) + " h", M + 190 + bw, y + 8);
      y += 18;
    });
    y += 8; heading("Recurring Reflection Themes");
    Object.entries(a.themeCounts).sort((x, z) => z[1] - x[1]).forEach(([t, c]) =>
      para(`•  ${t}: referenced ${c} time(s)`, 10, 6));

    /* ---- Growth Report ---- */
    newPage("Growth Report");
    para("Reflection depth over time, measured by total words written per month. A rising trend indicates growing reflective complexity and engagement.", 10, 6);
    y += 6; heading("Reflection Words per Month");
    const wm = Object.entries(a.wordsByMonth).sort();
    const maxW = Math.max(...wm.map(m => m[1]), 1);
    wm.forEach(([k, v]) => {
      ensure(20, "Growth");
      doc.setFontSize(9); doc.setTextColor(60, 66, 80); doc.text(monthLabel(k), M, y + 8);
      const bw = (v / maxW) * 220;
      doc.setFillColor(...cyan); doc.roundedRect(M + 80, y, Math.max(bw, 2), 9, 2, 2, "F");
      doc.setTextColor(...grey); doc.text(v + " w", M + 90 + bw, y + 8);
      y += 18;
    });
    const early = a.list.slice(-1)[0], recent = a.list[0];
    if (early && recent && early !== recent) {
      y += 8; heading("Early vs. Recent Reflection");
      const ew = Object.values(early.reflections || {}).reduce((s, t) => s + wordCount(t), 0);
      const rw = Object.values(recent.reflections || {}).reduce((s, t) => s + wordCount(t), 0);
      para(`Earliest session (${fmtDate(early.date)}): ${ew} words of reflection.`, 10, 6);
      para(`Most recent session (${fmtDate(recent.date)}): ${rw} words of reflection.`, 10, 6);
    }

    /* ---- Reflection Highlights ---- */
    newPage("Reflection Highlights");
    para("Selected responses demonstrating meaningful insight and reflective growth.", 10, 8);
    const highlights = [...a.list].sort((x, z) => {
      const wx = Object.values(x.reflections || {}).join(" ").length;
      const wz = Object.values(z.reflections || {}).join(" ").length;
      return wz - wx;
    }).slice(0, 4);
    highlights.forEach(o => {
      heading(`${o.specialty} — ${fmtDate(o.date)}`);
      para(`Q: How did this experience influence your understanding of healthcare?`, 9, 5);
      doc.setTextColor(60, 66, 80);
      para(`"${o.reflections[4] || o.reflections[0] || ""}"`, 10, 6);
      y += 6;
    });

    /* ---- Complete Observation Log ---- */
    newPage("Complete Observation Log");
    a.list.forEach((o, idx) => {
      ensure(70, "Observation Log");
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...purple);
      doc.text(`${idx + 1}. ${o.specialty}`, M, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...grey);
      doc.text(`${fmtDate(o.date)}  •  ${o.hours} hrs`, W - M, y, { align: "right" });
      y += 15;
      doc.setTextColor(60, 66, 80); doc.setFontSize(9);
      doc.text(`${o.providerName}, ${o.providerTitle}  —  ${o.location}  (${o.startTime}–${o.endTime})`, M, y);
      y += 14;
      para(o.notes || "", 9, 5);
      y += 8;
    });

    /* ---- Reflection Archive ---- */
    newPage("Reflection Archive");
    a.list.forEach((o, idx) => {
      ensure(60, "Reflection Archive");
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...purple);
      doc.text(`${o.specialty} — ${fmtDate(o.date)}`, M, y); y += 16;
      REFLECTION_QUESTIONS.forEach((q, qi) => {
        ensure(40, "Reflection Archive");
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(90, 96, 110);
        const ql = doc.splitTextToSize(`Q${qi + 1}. ${q}`, W - M * 2);
        ql.forEach(l => { doc.text(l, M, y); y += 12; });
        doc.setFont("helvetica", "normal"); doc.setTextColor(60, 66, 80);
        para(o.reflections[qi] || "—", 9, 5);
        y += 4;
      });
      y += 10;
    });

    // footers on all pages
    const pages = doc.internal.getNumberOfPages();
    for (let i = 2; i <= pages; i++) { doc.setPage(i); footer(`Page ${i} of ${pages}`); }

    doc.save(`ObserveMD_Portfolio_${prof.name.replace(/\s+/g, "_")}.pdf`);
    toast("Portfolio downloaded");
  }

  return {
    REFLECTION_QUESTIONS, SPECIALTIES, THEMES,
    getAll, add, remove, getProfile, saveProfile, seedIfEmpty,
    hoursBetween, fmtDate, monthKey, monthLabel, wordCount, round,
    analytics, renderSidebar, toast, openObservationModal,
    lineChart, barChart, donut, colorFor, exportPortfolio,
  };
})();

// boot
OMD.seedIfEmpty();
