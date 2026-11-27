// Firebase setup for the browser (loads from Google's CDN, so no bundler is needed).
// Used by share.js (dashboard) and activity.js (public page).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDi4suX8gg7TNMoNj2i85lJTyDKXK2HDh4",
  authDomain: "dinkhub-c0215.firebaseapp.com",
  databaseURL: "https://dinkhub-c0215-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "dinkhub-c0215",
  storageBucket: "dinkhub-c0215.firebasestorage.app",
  messagingSenderId: "830655765680",
  appId: "1:830655765680:web:86c788f82526e496882f75",
  measurementId: "G-KBR01V1TTP",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Analytics is optional: load it in the background and ignore failures (ad blockers, file://, etc.)
import("https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js")
  .then(async (m) => { if (await m.isSupported()) m.getAnalytics(app); })
  .catch(() => {});