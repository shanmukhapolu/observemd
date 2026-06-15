/* ============================================================
   ObserveMD — Shared Firebase Auth Guard
   Protects app pages, shows the signed-in user, handles sign out.
   Include on every protected page:
     <script type="module" src="assets/firebase-auth.js"></script>
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDzGHoIe7hMutBTDLXcCwJ-3ADprK3M1NU",
  authDomain: "observemd.firebaseapp.com",
  projectId: "observemd",
  storageBucket: "observemd.firebasestorage.app",
  messagingSenderId: "125474110417",
  appId: "1:125474110417:web:7b4366e2ec0eadcc313ef0",
  measurementId: "G-V5DQGKC0XR"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* ---- Prevent flash of protected content until auth resolves ---- */
const gate = document.createElement("div");
gate.id = "authGate";
gate.innerHTML = `<div class="auth-gate-spinner"></div>`;
document.documentElement.appendChild(gate);

function removeGate() {
  gate.style.opacity = "0";
  setTimeout(() => gate.remove(), 250);
}

/* ---- Render the signed-in user into the sidebar ---- */
function fillUser(user) {
  const nameEl = document.getElementById("sbUserName");
  const mailEl = document.getElementById("sbUserEmail");
  const avEl   = document.getElementById("sbUserAvatar");

  const display = user.displayName || (user.email ? user.email.split("@")[0] : "Student");
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

/* The sidebar is injected by app.js. If it isn't ready yet, retry shortly. */
function applyUserToSidebar(user, attempt = 0) {
  if (document.getElementById("sbUserName") || attempt > 40) {
    fillUser(user);
    wireSignOut();
  } else {
    setTimeout(() => applyUserToSidebar(user, attempt + 1), 50);
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    applyUserToSidebar(user);
    removeGate();
  } else {
    // Not signed in — send to login.
    window.location.replace("login.html");
  }
});
