// Dashboard side of sharing: keeps the dashboard behind a sign-in, writes the open play to
// Realtime Database and cleans up expired ones. Any active account with role "openplay" can share;
// each shared open play records its owner, and only the owner (or the admin) can change or remove it.
// dashboard.js talks to this through window.DinkShare.
import { db, auth } from "./firebase.js";
import { ref, set, remove, get, query, orderByChild, equalTo, endAt } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const ADMIN_UID = "1fO3GhgPfldy1SXUThFKBs2Snmj1";
const ID_RE = /^[a-f0-9]{32}$/;
const toAuth = () => location.replace("auth.html?next=" + encodeURIComponent(location.pathname.split("/").pop() || "dashboard.html"));

// Resolves with the signed-in user once their account is confirmed; otherwise sends them to auth.html.
let current = null, club = "";
const ready = new Promise((resolve) => {
  onAuthStateChanged(auth, async (u) => {
    if (!u) { current = null; toAuth(); return; }
    if (u.uid !== ADMIN_UID) {
      let ok = true;
      try { const acc = (await get(ref(db, "accounts/" + u.uid))).val(); ok = !!acc && acc.status === "active" && acc.role === "openplay"; club = (acc && acc.club) || ""; }
      catch (e) { ok = !/permission|denied/i.test(String(e && (e.code || e.message))); } // offline: keep them in; refused: the account is missing or inactive
      if (!ok) { await signOut(auth).catch(() => {}); return; } // signOut triggers toAuth above
    }
    current = u;
    document.documentElement.classList.remove("auth-pending");
    const sub = document.getElementById("clubName"); if (sub && club) { sub.textContent = club; sub.title = club; }
    window.dispatchEvent(new CustomEvent("dinkshare:user", { detail: { email: u.email, name: u.displayName || "", club } }));
    resolve(u);
  });
});

async function needUser() {
  const u = current || (await ready);
  if (!u) throw new Error("Please sign in to share an open play.");
  return u;
}
const node = (id) => { if (!ID_RE.test(id)) throw new Error("Bad share id"); return ref(db, "openplays/" + id); };

// Deletes this user's open plays whose 7 days are over.
async function purgeExpired() {
  try {
    const u = await needUser();
    const q = u.uid === ADMIN_UID
      ? query(ref(db, "openplays"), orderByChild("expiresAt"), endAt(Date.now()))
      : query(ref(db, "openplays"), orderByChild("owner"), equalTo(u.uid));
    const snap = await get(q), now = Date.now(), jobs = [];
    snap.forEach((child) => { const e = child.child("expiresAt").val(); if (!e || e < now) jobs.push(remove(child.ref)); });
    await Promise.all(jobs);
  } catch (e) { /* offline or nothing to delete */ }
}

window.DinkShare = {
  publish: async (id, data) => { const u = await needUser(); await set(node(id), Object.assign({}, data, { owner: u.uid })); },
  remove: async (id) => { await needUser(); await remove(node(id)); },
  purgeExpired,
  user: () => (current ? { email: current.email, name: current.displayName || "", club } : null),
  signOut: () => signOut(auth),
};
purgeExpired();