/* ============================================================
   ObserveMD — Firebase Shared Config
   Import this module wherever Firebase services are needed.
   Exports: app, auth, db (Firestore), analytics
   ============================================================ */

import { initializeApp }         from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, browserLocalPersistence, setPersistence }
                                  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore }           from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { getAnalytics, isSupported }
                                  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-analytics.js";

export const firebaseConfig = {
  apiKey:            "AIzaSyDzGHoIe7hMutBTDLXcCwJ-3ADprK3M1NU",
  authDomain:        "observemd.firebaseapp.com",
  projectId:         "observemd",
  storageBucket:     "observemd.firebasestorage.app",
  messagingSenderId: "125474110417",
  appId:             "1:125474110417:web:7b4366e2ec0eadcc313ef0",
  measurementId:     "G-V5DQGKC0XR",
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// Persist auth across browser sessions (survives tab close / refresh)
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Analytics — only initialise when supported (blocked in some envs)
export let analytics = null;
isSupported().then(yes => {
  if (yes) analytics = getAnalytics(app);
}).catch(() => {});
