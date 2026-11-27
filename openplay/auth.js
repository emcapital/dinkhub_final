// Sign in / create account for open play hosts.
// A new account gets accounts/<uid> = { name, club, email, role: "openplay", status: "active", createdAt }
// in Realtime Database, which is what the database rules check before letting someone share an open play.
import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { ref, get, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

window.__authReady = true;
const ADMIN_UID = "1fO3GhgPfldy1SXUThFKBs2Snmj1";
const $ = (s) => document.querySelector(s);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// where to go after signing in (only pages in this folder, so the link can't send people elsewhere)
const nextParam = new URLSearchParams(location.search).get("next") || "";
const NEXT = /^[\w-]+\.html(\?[\w=&%-]*)?$/.test(nextParam) ? nextParam : "dashboard.html";

// ---- theme ----
function paintTheme(th) {
  document.documentElement.setAttribute("data-theme", th);
  const light = th === "light", b = $("#btnTheme");
  b.setAttribute("aria-pressed", String(light));
  const l = light ? "Switch to dark mode" : "Switch to light mode"; b.setAttribute("aria-label", l); b.title = l;
  $("#metaTheme").setAttribute("content", light ? "#f3f7ee" : "#0b2a24");
  try { localStorage.setItem("dinkhub_theme", th); } catch (e) {}
}
paintTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
$("#btnTheme").onclick = () => paintTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");

// ---- modes: signin, signup, finish (signed in but the club details are missing) ----
const COPY = {
  signin: { title: "Welcome back", sub: "Sign in to run your open play and share it with a QR code.", btn: "Sign in", alt: 'New here? <button type="button" class="link" data-go="signup">Create an account</button>' },
  signup: { title: "Create your account", sub: "Tell us your club. Players will see it when they follow your games.", btn: "Create account", alt: 'Already have an account? <button type="button" class="link" data-go="signin">Sign in</button>' },
  finish: { title: "Almost there", sub: "Add your club name to finish setting up your account.", btn: "Finish setup", alt: '<button type="button" class="link" data-go="out">Use a different account</button>' },
};
let mode = new URLSearchParams(location.search).get("mode") === "signup" ? "signup" : "signin";
let pendingUser = null; // used in "finish" mode

function setMode(m, animate) {
  const prev = mode; mode = m;
  const up = m === "signup", fin = m === "finish";
  $("#tabs").dataset.mode = up ? "signup" : "signin";
  $("#tabs").classList.toggle("gone", fin);
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
  $("#signupFields").classList.toggle("shut", !(up || fin));
  $("#credFields").classList.toggle("shut", fin);
  $("#confirmWrap").classList.toggle("shut", !up);
  $("#meterWrap").classList.toggle("shut", !up);
  $("#forgotRow").style.display = m === "signin" ? "" : "none";
  $("#password").setAttribute("autocomplete", up ? "new-password" : "current-password");
  // fields hidden by the current mode can't be tabbed into
  document.querySelectorAll("#signupFields input").forEach((i) => (i.tabIndex = up || fin ? 0 : -1));
  document.querySelectorAll("#credFields input, #credFields button").forEach((i) => (i.tabIndex = fin ? -1 : 0));
  document.querySelectorAll("#confirmWrap input").forEach((i) => (i.tabIndex = up ? 0 : -1));

  const c = COPY[m];
  $("#title").textContent = c.title; $("#subtitle").textContent = c.sub;
  $("#submitLabel").textContent = c.btn; $("#alt").innerHTML = c.alt;
  if (animate && prev !== m) {
    const h = $("#heading");
    h.style.setProperty("--sx", m === "signin" ? "-14px" : "14px");
    h.classList.remove("swap"); void h.offsetWidth; h.classList.add("swap");
  }
  hideMsg(); validate();
}
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode, true)));
$("#alt").addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]"); if (!go) return;
  if (go.dataset.go === "out") { pendingUser = null; signOut(auth).catch(() => {}); setMode("signin", true); }
  else setMode(go.dataset.go, true);
});

// ---- small touches: show password, strength meter, check marks ----
$("#btnEye").onclick = () => {
  const p = $("#password"), show = p.type === "password";
  p.type = $("#password2").type = show ? "text" : "password";
  $("#btnEye").innerHTML = `<svg><use href="#${show ? "i-eye-off" : "i-eye"}"/></svg>`;
  $("#btnEye").setAttribute("aria-label", show ? "Hide password" : "Show password");
};
function strength(pw) {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  else if (/\d|[^A-Za-z0-9]/.test(pw) && s < 4) s += pw.length >= 8 ? 1 : 0;
  return pw ? Math.max(1, Math.min(4, s)) : 0;
}
function validate() {
  const pw = $("#password").value;
  $("#fName").classList.toggle("valid", $("#name").value.trim().length > 0);
  $("#fClub").classList.toggle("valid", $("#club").value.trim().length > 1);
  $("#fEmail").classList.toggle("valid", EMAIL_RE.test($("#email").value.trim()));
  $("#fConfirm").classList.toggle("valid", pw.length >= 6 && pw === $("#password2").value);
  const s = strength(pw), bars = document.querySelectorAll(".meter i");
  bars.forEach((b, i) => { const on = i < s; if (on !== b.classList.contains("on")) b.classList.toggle("on", on); b.classList.toggle("weak", s <= 1); });
  $("#meterTxt").textContent = !pw ? "Use at least 6 characters." : pw.length < 6 ? "Too short" : ["", "Weak", "Okay", "Good", "Strong"][s];
}
["name", "club", "email", "password", "password2"].forEach((id) => $("#" + id).addEventListener("input", () => { validate(); if (!$("#msg").classList.contains("good")) hideMsg(); }));

// ---- messages ----
function showMsg(text, good) {
  $("#msgText").textContent = text;
  $("#msg").className = "msg on " + (good ? "good" : "err");
  if (!good) { const c = $("#card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake"); }
}
function hideMsg() { $("#msg").className = "msg"; }
$("#card").addEventListener("animationend", (e) => { if (e.animationName === "shake") e.currentTarget.classList.remove("shake"); });
function busy(on) {
  $("#btnSubmit").disabled = on;
  $("#btnSubmit").classList.toggle("busy", on);
  $("#submitLabel").textContent = on ? "Please wait…" : COPY[mode].btn;
}
function fail(text, focusId) { showMsg(text); if (focusId) $("#" + focusId).focus(); }

const ERRORS = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-password": "Enter your password.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "No account uses that email. Create one instead.",
  "auth/email-already-in-use": "An account already uses that email. Sign in instead.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
  "auth/network-request-failed": "No internet connection. Check it and try again.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/operation-not-allowed": "Email sign-in isn't turned on for this app yet.",
};
const errText = (e) => ERRORS[e && e.code] || (e && e.message) || "Something went wrong. Try again.";
const appErr = (msg) => Object.assign(new Error(msg), { code: "x/app" });

// ---- account record in Realtime Database ----
// Returns the account ({ name, club, ... }), or null when it doesn't exist yet.
async function loadAccount(user) {
  if (user.uid === ADMIN_UID) return { name: user.displayName || "Admin", club: "" };
  let acc = null;
  try { acc = (await get(ref(db, "accounts/" + user.uid))).val(); }
  catch (e) {
    if (!/permission|denied/i.test(String(e && (e.code || e.message)))) throw e; // offline etc.
    return null; // the rules hide a missing or inactive record; creating it tells them apart
  }
  if (!acc) return null;
  if (acc.status !== "active") throw appErr("This account is not active. Contact the admin.");
  if (acc.role !== "openplay") throw appErr("This email belongs to a tournament account, not an open play account. Use a different email.");
  return acc;
}
async function createAccount(user, name, club) {
  const rec = { name: name.trim().slice(0, 60), club: club.trim().slice(0, 80), email: user.email, role: "openplay", status: "active", createdAt: serverTimestamp() };
  try { await set(ref(db, "accounts/" + user.uid), rec); }
  catch (e) {
    if (/permission|denied/i.test(String(e && (e.code || e.message)))) throw appErr("This account is not active. Contact the admin.");
    throw e;
  }
  return rec;
}

// ---- overlays ----
const hideLoader = () => $("#loader").classList.add("hide");
function celebrate(acc) {
  $("#successTitle").textContent = acc && acc.name ? "Welcome, " + acc.name.split(" ")[0] + "!" : "You're in!";
  $("#successSub").textContent = acc && acc.club ? "Opening " + acc.club + "'s open play…" : "Opening your open play…";
  const burst = $("#burst"), colors = ["#d7ff3f", "#ffffff", "#38bd94", "#f59e0b", "#d7ff3f"];
  burst.querySelectorAll(".confetti").forEach((c) => c.remove());
  for (let i = 0; i < 18; i++) {
    const c = document.createElement("span"), a = (i / 18) * Math.PI * 2, r = 70 + Math.random() * 60;
    c.className = "confetti"; c.style.background = colors[i % colors.length];
    c.style.setProperty("--x", Math.cos(a) * r + "px"); c.style.setProperty("--y", Math.sin(a) * r + "px");
    c.style.setProperty("--r", Math.random() * 540 - 270 + "deg");
    burst.appendChild(c);
  }
  const s = $("#success"); s.classList.remove("hide", "go"); void s.offsetWidth; s.classList.add("go");
  setTimeout(() => location.replace(NEXT), 1500);
}

// ---- after Firebase Auth says who the user is ----
let working = false;
async function afterAuth(user, signup) {
  try {
    let acc = await loadAccount(user);
    if (!acc && signup) acc = await createAccount(user, signup.name, signup.club);
    if (!acc) { // signed in, but the club details were never saved: ask for them
      pendingUser = user;
      hideLoader(); busy(false); working = false;
      if (user.displayName && !$("#name").value) $("#name").value = user.displayName;
      setMode("finish", true); validate();
      setTimeout(() => $(!$("#name").value ? "#name" : "#club").focus(), 350);
      return;
    }
    hideLoader(); celebrate(acc);
  } catch (e) {
    pendingUser = null;
    if (e.code === "x/app") await signOut(auth).catch(() => {});
    hideLoader(); busy(false); working = false;
    if (mode === "finish") setMode("signin");
    showMsg(errText(e));
  }
}

$("#form").onsubmit = async (ev) => {
  ev.preventDefault();
  if (working) return;
  hideMsg();
  const email = $("#email").value.trim(), pw = $("#password").value;
  const name = $("#name").value.trim(), club = $("#club").value.trim();

  if (mode === "signup" || mode === "finish") {
    if (!name) return fail("Enter your name.", "name");
    if (club.length < 2) return fail("Enter your club's name.", "club");
  }
  if (mode !== "finish") {
    if (!EMAIL_RE.test(email)) return fail("Enter a valid email address.", "email");
    if (!pw) return fail("Enter your password.", "password");
  }
  if (mode === "signup") {
    if (pw.length < 6) return fail("Use a password with at least 6 characters.", "password");
    if (pw !== $("#password2").value) return fail("The passwords don't match.", "password2");
  }

  working = true; busy(true);
  try {
    if (mode === "finish") {
      if (!pendingUser) { working = false; busy(false); setMode("signin", true); return; }
      const acc = await createAccount(pendingUser, name, club);
      await updateProfile(pendingUser, { displayName: name }).catch(() => {});
      celebrate(acc);
    } else if (mode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      await updateProfile(cred.user, { displayName: name }).catch(() => {});
      await afterAuth(cred.user, { name, club });
    } else {
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      await afterAuth(cred.user);
    }
  } catch (e) {
    showMsg(errText(e));
    busy(false); working = false;
  }
};

$("#btnForgot").onclick = async () => {
  const email = $("#email").value.trim();
  if (!EMAIL_RE.test(email)) return fail("Type your email above first, then tap Forgot password.", "email");
  try { await sendPasswordResetEmail(auth, email); showMsg("If an account uses that email, a reset link is on its way. Check your inbox.", true); }
  catch (e) { showMsg(errText(e)); }
};

// ---- start: already signed in? go straight on ----
setMode(mode);
const stop = onAuthStateChanged(auth, (user) => {
  stop();
  if (user) { working = true; afterAuth(user); }
  else {
    hideLoader();
    // focus the first field on computers only (on phones it would pop the keyboard over the page)
    if (matchMedia("(pointer: fine)").matches) setTimeout(() => $("#" + (mode === "signup" ? "name" : "email")).focus({ preventScroll: true }), 900);
  }
});