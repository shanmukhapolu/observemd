/* ============================================================
   ObserveMD — Shared Firebase Auth Guard + Firestore bridge
   - Uses browserLocalPersistence so the user stays signed in
     unless they explicitly sign out or clear site data.
   - Exposes window.OMD_USER (the Firebase user) and
     window.OMD_DB   (the Firestore instance)
     so app.js can use them for per-user data operations.
   ============================================================ */

import { auth, db }               from "./firebase.js";
import { onAuthStateChanged, signOut }
                                   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

/* ---- Auth-gate overlay ---- */
const gate = document.createElement("div");
gate.id = "authGate";
gate.style.cssText = [
  "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;",
  "background:var(--bg,#0a0b0f);transition:opacity .25s;",
].join("");
gate.innerHTML = `
  <div style="text-align:center">
    <div style="
      width:44px;height:44px;border-radius:50%;margin:0 auto 16px;
      border:3px solid rgba(124,58,237,.25);border-top-color:#7c3aed;
      animation:spin .8s linear infinite;"></div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  </div>`;
document.documentElement.appendChild(gate);

function removeGate() {
  gate.style.opacity = "0";
  setTimeout(() => gate.remove(), 280);
}

/* ---- Populate sidebar user info ---- */
function fillUser(user) {
  const display = user.displayName || (user.email ? user.email.split("@")[0] : "Student");
  const nameEl  = document.getElementById("sbUserName");
  const mailEl  = document.getElementById("sbUserEmail");
  const avEl    = document.getElementById("sbUserAvatar");
  if (nameEl) nameEl.textContent = display;
  if (mailEl) mailEl.textContent = user.email || "";
  if (avEl)   avEl.textContent = (display.trim()[0] || "S").toUpperCase();
}

function wireSignOut() {
  const btn = document.getElementById("sbSignOut");
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "login.html";
    } catch (err) {
      alert(err.message);
    }
  });
}

/* Sidebar is injected by app.js asynchronously — retry until elements exist */
function applyUserToSidebar(user, attempt = 0) {
  if (document.getElementById("sbUserName") || attempt > 60) {
    fillUser(user);
    wireSignOut();
  } else {
    setTimeout(() => applyUserToSidebar(user, attempt + 1), 50);
  }
}

/* ---- Auth state listener ---- */
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Make user + DB available to app.js synchronously
    window.OMD_USER = user;
    window.OMD_DB   = db;
    applyUserToSidebar(user);
    removeGate();
  } else {
    window.location.replace("login.html");
  }
});
