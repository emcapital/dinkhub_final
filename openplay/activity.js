// Public, read-only live view of one open play. Opened from the QR code: activity.html?id=<unique id>
import { db } from "./firebase.js";
import { ref, onValue, remove } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); };
const list = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : v ? Object.values(v) : []);
const id = new URLSearchParams(location.search).get("id") || "";

// ---- theme (shares the dashboard's saved choice) ----
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

// ---- share my stats: a picture for an Instagram post or story, to save or send ----
// The image is drawn on a canvas in the browser. Nothing is uploaded anywhere.
const FORMATS = { post: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } };
let lastRk = [], lastData = {};
const sh = { p: null, fmt: "post", busy: 0 };
const canShareFiles = () => { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File(["x"], "a.png", { type: "image/png" })] })); } catch (e) { return false; } };

function rr(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function fitFont(c, text, maxW, size, min, weight, fam) { while (size > min) { c.font = `${weight} ${size}px ${fam}`; if (c.measureText(text).width <= maxW) break; size -= 2; } c.font = `${weight} ${size}px ${fam}`; return size; }
function spaced(c, px) { try { c.letterSpacing = px + "px"; } catch (e) {} }

const MEDALS = [
  { c1: "#fff3b0", c2: "#ffc933", c3: "#d58a00", label: "CHAMPION", glow: "255,201,51" },
  { c1: "#ffffff", c2: "#d3dde6", c3: "#8da0b1", label: "RUNNER-UP", glow: "200,214,228" },
  { c1: "#ffd6ae", c2: "#e98d4c", c3: "#a9561e", label: "THIRD PLACE", glow: "233,141,76" },
];
function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } let a = h >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function star(c, x, y, r) { c.beginPath(); c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r); c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fill(); }
function rtop(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x, y + h); c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r); c.lineTo(x + w, y + h); c.closePath(); }
const initials = (n) => (String(n).trim().split(/\s+/).slice(0, 2).map((w) => (w[0] || "")).join("") || "?").toUpperCase();
function vgrad(c, y0, y1, m) { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, m.c1); g.addColorStop(0.45, m.c2); g.addColorStop(1, m.c3); return g; }

function drawCard(cv, fmt, p, total, meta) {
  const { w: W, h: H } = FORMATS[fmt], story = fmt === "story";
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  const OPT = "#d7ff3f", DISP = '"Bricolage Grotesque","Arial Black",Arial,sans-serif', BODY = '"DM Sans",Arial,sans-serif';
  const PAD = 90, CW = W - PAD * 2, oy = story ? 300 : 0;
  const wins = p.wins || 0, games = p.games || 0, losses = Math.max(0, games - wins), pct = games ? Math.round((wins / games) * 100) : 0;
  const medal = wins > 0 && p.rank >= 1 && p.rank <= 3 ? p.rank : 0, M = medal ? MEDALS[medal - 1] : null;
  const ACC = M ? M.c2 : OPT, rnd = seeded(p.name + "|" + p.rank);

  // ---- background ----
  let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#082019"); g.addColorStop(0.55, "#0e3a31"); g.addColorStop(1, "#14493f");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const gx = M ? W / 2 : W * 0.88, gy = M ? 640 + oy : H * 0.1;
  g = c.createRadialGradient(gx, gy, 0, gx, gy, M ? 900 : 760); g.addColorStop(0, M ? `rgba(${M.glow},.30)` : "rgba(215,255,63,.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  if (M) { // light rays fanning out from behind the podium
    c.save(); c.translate(W / 2, 760 + oy); const n = 18;
    for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = a0 + Math.PI / n * 0.9; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 1900, a0, a1); c.closePath();
      const rg = c.createRadialGradient(0, 0, 0, 0, 0, 1300); rg.addColorStop(0, `rgba(${M.glow},.16)`); rg.addColorStop(1, `rgba(${M.glow},0)`); c.fillStyle = rg; c.fill(); }
    c.restore();
  }
  // faint pickleball court
  c.save(); c.globalAlpha = 0.07; c.strokeStyle = OPT; c.lineWidth = 6;
  const ch = H * 1.02, cw = ch / 2.2, cx = W / 2 - cw / 2, cy = H / 2 - ch / 2, kt = ch * (7 / 44);
  c.strokeRect(cx, cy, cw, ch); c.beginPath(); c.moveTo(cx, cy + ch / 2); c.lineTo(cx + cw, cy + ch / 2);
  c.moveTo(cx, cy + ch / 2 - kt); c.lineTo(cx + cw, cy + ch / 2 - kt); c.moveTo(cx, cy + ch / 2 + kt); c.lineTo(cx + cw, cy + ch / 2 + kt);
  c.moveTo(W / 2, cy); c.lineTo(W / 2, cy + ch / 2 - kt); c.moveTo(W / 2, cy + ch / 2 + kt); c.lineTo(W / 2, cy + ch); c.stroke(); c.restore();
  // sparkles + confetti (same every time for the same player)
  const nSp = M ? 46 : 14;
  for (let i = 0; i < nSp; i++) {
    const x = rnd() * W, y = rnd() * H, r = 5 + rnd() * (M ? 15 : 10), pick = rnd();
    c.globalAlpha = 0.25 + rnd() * 0.6;
    c.fillStyle = pick < 0.5 ? "#fff" : M ? M.c2 : OPT;
    if (pick < 0.75) star(c, x, y, r); else if (M) { c.save(); c.translate(x, y); c.rotate(rnd() * 3); c.fillRect(-r * 0.4, -r, r * 0.8, r * 2); c.restore(); }
  }
  c.globalAlpha = 1;

  // ---- header ----
  const hy = story ? 230 : 90;
  c.fillStyle = OPT; c.beginPath(); c.arc(PAD + 38, hy + 38, 38, 0, 7); c.fill();
  c.fillStyle = "#0b2a24"; c.font = `800 44px ${DISP}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("D", PAD + 38, hy + 41);
  c.textAlign = "left"; c.font = `800 50px ${DISP}`; c.fillStyle = "#fff"; c.fillText("Dink", PAD + 94, hy + 40);
  const dw = c.measureText("Dink").width; c.fillStyle = OPT; c.fillText("Hub", PAD + 94 + dw, hy + 40);
  c.textAlign = "right"; c.fillStyle = "rgba(255,255,255,.6)"; c.font = `600 28px ${BODY}`; spaced(c, 5); c.fillText("OPEN PLAY", W - PAD, hy + 40); spaced(c, 0);
  c.textBaseline = "alphabetic";

  const eyebrow = ((meta.club || "") ? meta.club : "My open play stats").toUpperCase().slice(0, 34);
  const statLabel = (t, x, y, col) => { c.fillStyle = col; c.font = `700 24px ${BODY}`; spaced(c, 4); c.fillText(t, x + 2, y); spaced(c, 0); };

  if (M) {
    // ================= PODIUM CARD =================
    c.textAlign = "center";
    c.fillStyle = M.c2; c.font = `700 30px ${BODY}`; spaced(c, 6); c.fillText(eyebrow, W / 2 + 3, 275 + oy); spaced(c, 0);
    // medal title with a metallic gradient
    c.font = `800 100px ${DISP}`; spaced(c, 4); const lw = c.measureText(M.label).width;
    const tg = c.createLinearGradient(0, 290 + oy, 0, 375 + oy); tg.addColorStop(0, M.c1); tg.addColorStop(0.5, M.c2); tg.addColorStop(1, M.c3);
    c.save(); c.shadowColor = `rgba(${M.glow},.55)`; c.shadowBlur = 40; c.fillStyle = tg; c.fillText(M.label, W / 2 + 2, 375 + oy); c.restore(); spaced(c, 0);
    c.fillStyle = "#fff"; fitFont(c, p.name, CW, 92, 44, 800, DISP); c.fillText(p.name, W / 2, 455 + oy);

    // podium: 2nd | 1st | 3rd
    const pbY = 975 + oy, gap = 16, bw = (CW - gap * 2) / 3, hs = { 1: 260, 2: 205, 3: 165 };
    const order = [2, 1, 3];
    // floor glow
    const fg = c.createRadialGradient(W / 2, pbY, 0, W / 2, pbY, CW / 1.6); fg.addColorStop(0, `rgba(${M.glow},.35)`); fg.addColorStop(1, `rgba(${M.glow},0)`);
    c.save(); c.translate(0, pbY); c.scale(1, 0.16); c.translate(0, -pbY); c.fillStyle = fg; c.fillRect(0, pbY - CW, W, CW * 2); c.restore();
    order.forEach((pos, i) => {
      const x = PAD + i * (bw + gap), h = hs[pos], y = pbY - h, mine = pos === medal;
      if (mine) {
        c.save(); c.shadowColor = `rgba(${M.glow},.7)`; c.shadowBlur = 70; rtop(c, x, y, bw, h, 26); c.fillStyle = vgrad(c, y, pbY, M); c.fill(); c.restore();
        const sh = c.createLinearGradient(x, y, x + bw, y); sh.addColorStop(0, "rgba(255,255,255,.35)"); sh.addColorStop(0.35, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(0,0,0,.18)");
        rtop(c, x, y, bw, h, 26); c.fillStyle = sh; c.fill();
      } else {
        rtop(c, x, y, bw, h, 26); c.fillStyle = "rgba(255,255,255,.07)"; c.fill(); c.strokeStyle = "rgba(255,255,255,.16)"; c.lineWidth = 2; c.stroke();
      }
      c.textAlign = "center"; c.fillStyle = mine ? "rgba(11,42,36,.88)" : "rgba(255,255,255,.28)"; const fs = Math.round(h * (mine ? 0.56 : 0.5));
      c.font = `800 ${fs}px ${DISP}`; c.fillText(String(pos), x + bw / 2, y + fs * 0.98);
      if (mine) { // the player stands on their step
        const ar = 62, ax = x + bw / 2, ay = y - 24 - ar;
        if (pos === 1) { // crown
          c.save(); c.translate(ax, ay - ar - 12); c.shadowColor = `rgba(${M.glow},.8)`; c.shadowBlur = 30; c.fillStyle = vgrad(c, -60, 0, M);
          c.beginPath(); c.moveTo(-58, 0); c.lineTo(-62, -48); c.lineTo(-30, -22); c.lineTo(0, -66); c.lineTo(30, -22); c.lineTo(62, -48); c.lineTo(58, 0); c.closePath(); c.fill(); c.restore();
        }
        c.save(); c.shadowColor = `rgba(${M.glow},.8)`; c.shadowBlur = 36; c.beginPath(); c.arc(ax, ay, ar, 0, 7); c.fillStyle = vgrad(c, ay - ar, ay + ar, M); c.fill(); c.restore();
        c.beginPath(); c.arc(ax, ay, ar - 9, 0, 7); c.fillStyle = "#0b2a24"; c.fill();
        c.fillStyle = M.c2; c.font = `800 ${initials(p.name).length > 1 ? 50 : 60}px ${DISP}`; c.textBaseline = "middle"; c.fillText(initials(p.name), ax, ay + 3); c.textBaseline = "alphabetic";
      }
    });
    c.fillStyle = `rgba(${M.glow},.6)`; c.fillRect(PAD - 20, pbY, CW + 40, 4);

    // stats strip
    const sy = pbY + 50, sh2 = 170;
    rr(c, PAD, sy, CW, sh2, 34); c.fillStyle = "rgba(255,255,255,.08)"; c.fill(); c.strokeStyle = `rgba(${M.glow},.35)`; c.lineWidth = 2; c.stroke();
    const cols = [["WINS", wins, true], ["LOSSES", losses, false], ["PLAYED", games, false], ["WIN RATE", pct + "%", true]], cwid = CW / 4;
    cols.forEach(([lab, val, hot], i) => {
      const mx = PAD + i * cwid + cwid / 2;
      c.textAlign = "center"; c.fillStyle = hot ? M.c1 : "#fff"; c.font = `800 ${String(val).length > 3 ? 62 : 76}px ${DISP}`; c.fillText(String(val), mx, sy + 100);
      statLabel(lab, mx, sy + 142, "rgba(255,255,255,.6)");
      if (i) { c.fillStyle = "rgba(255,255,255,.14)"; c.fillRect(PAD + i * cwid - 1, sy + 34, 2, sh2 - 68); }
    });
  } else {
    // ================= STANDARD CARD (ring) =================
    c.textAlign = "left";
    c.fillStyle = OPT; c.font = `700 32px ${BODY}`; spaced(c, 5); c.fillText(eyebrow, PAD, 325 + oy); spaced(c, 0);
    c.fillStyle = "#fff"; fitFont(c, p.name, CW, 170, 64, 800, DISP); c.fillText(p.name, PAD, 510 + oy);
    const label = "RANK #" + p.rank + (total ? " OF " + total : "");
    c.font = `700 32px ${BODY}`; spaced(c, 3); const tw = c.measureText(label).width; spaced(c, 0);
    const py = 560 + oy; rr(c, PAD, py, tw + 80, 76, 38); c.fillStyle = "rgba(255,255,255,.08)"; c.fill(); c.strokeStyle = "rgba(215,255,63,.55)"; c.lineWidth = 3; c.stroke();
    c.fillStyle = OPT; c.textBaseline = "middle"; spaced(c, 3); c.fillText(label, PAD + 40, py + 40); spaced(c, 0); c.textBaseline = "alphabetic";

    // win-rate ring
    const rx = PAD + 215, ry = 960 + oy, rad = 190;
    c.lineCap = "round"; c.lineWidth = 40; c.strokeStyle = "rgba(255,255,255,.1)"; c.beginPath(); c.arc(rx, ry, rad, 0, 7); c.stroke();
    if (pct > 0) { c.save(); c.shadowColor = "rgba(215,255,63,.6)"; c.shadowBlur = 40; c.strokeStyle = OPT; c.beginPath(); c.arc(rx, ry, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, pct / 100)); c.stroke(); c.restore(); }
    c.lineCap = "butt"; c.textAlign = "center"; c.fillStyle = "#fff"; c.font = `800 112px ${DISP}`; c.fillText(pct + "%", rx, ry + 30);
    statLabel("WIN RATE", rx, ry + 88, "rgba(255,255,255,.6)");
    // stacked numbers
    const sx = PAD + 480; c.textAlign = "left";
    [["WINS", wins, true], ["LOSSES", losses, false], ["PLAYED", games, false]].forEach(([lab, val, hot], i) => {
      const y = ry - 120 + i * 135;
      c.fillStyle = hot ? OPT : "#fff"; c.font = `800 118px ${DISP}`; c.fillText(String(val), sx, y + 60);
      const nw = c.measureText(String(val)).width; statLabel(lab, sx + nw + 22, y + 58, "rgba(255,255,255,.6)");
      if (i < 2) { c.fillStyle = "rgba(255,255,255,.12)"; c.fillRect(sx, y + 90, W - PAD - sx, 2); }
    });
  }

  // ---- footer ----
  const fy = H - (story ? 230 : 90);
  c.textAlign = "center"; c.textBaseline = "alphabetic";
  c.fillStyle = "rgba(255,255,255,.75)"; c.font = `600 30px ${BODY}`;
  c.fillText(new Date().toLocaleDateString([], { dateStyle: "medium" }), W / 2, fy - 38);
  c.fillStyle = "rgba(255,255,255,.45)"; c.font = `500 26px ${BODY}`; c.fillText("Developed by EM Development Solutions", W / 2, fy);
}

function ensureShareModal() {
  if ($("#shareModal")) return;
  const m = document.createElement("div");
  m.id = "shareModal";
  m.className = "fixed inset-0 z-50 hidden items-end justify-center bg-black/70 sm:items-center sm:p-4";
  m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", "Share your stats");
  m.innerHTML = `<div class="flex max-h-[100dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-3xl bg-court-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl sm:p-5">
      <div class="flex items-center justify-between gap-3">
        <h2 class="font-display text-xl font-bold">Share your stats</h2>
        <button type="button" id="shareClose" class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-court-700 p-1" role="tablist" aria-label="Image size">
        <button type="button" data-fmt="post" role="tab" class="rounded-lg px-3 py-2 text-sm font-semibold"><i class="fa-regular fa-image mr-1.5"></i>Post</button>
        <button type="button" data-fmt="story" role="tab" class="rounded-lg px-3 py-2 text-sm font-semibold"><i class="fa-solid fa-mobile-screen mr-1.5"></i>Story</button>
      </div>
      <div class="mt-4 flex min-h-[200px] items-center justify-center"><canvas id="shareCanvas" class="rounded-xl shadow-lg" style="max-height:52vh;max-width:100%" width="1080" height="1350"></canvas></div>
      <div class="mt-4 grid gap-2 ${canShareFiles() ? "grid-cols-2" : "grid-cols-1"}">
        <button type="button" id="shareSend" class="${canShareFiles() ? "" : "hidden "}h-12 items-center justify-center gap-2 rounded-xl bg-optic px-4 font-bold text-court-900 hover:bg-optic-dark"><i class="fa-solid fa-share-nodes mr-2"></i>Share</button>
        <button type="button" id="shareSave" class="h-12 rounded-xl border border-white/20 px-4 font-bold hover:bg-white/10"><i class="fa-solid fa-download mr-2"></i>Save image</button>
      </div>
      <p id="shareHint" class="mt-3 text-center text-xs text-white/55" aria-live="polite">${canShareFiles() ? "Tap Share and pick Instagram, then choose Post or Story." : "Save the image, then add it to Instagram from your gallery."}</p>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener("click", (e) => { if (e.target === m) closeShare(); });
  $("#shareClose").onclick = closeShare;
  m.querySelectorAll("[data-fmt]").forEach((b) => (b.onclick = () => { sh.fmt = b.dataset.fmt; paintShare(); }));
  $("#shareSave").onclick = async () => { const f = await shareFile(); if (f) { saveFile(f); hint("Saved. Open Instagram and pick it from your gallery."); } };
  $("#shareSend").onclick = async () => {
    const f = await shareFile(); if (!f) return;
    try { await navigator.share({ files: [f], title: "My DinkHub stats", text: sh.p.name + ": " + (sh.p.wins || 0) + " wins in " + (sh.p.games || 0) + " games on DinkHub" }); }
    catch (e) { if (e && e.name !== "AbortError") { saveFile(f); hint("Sharing isn't available here, so the image was saved instead."); } }
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !m.classList.contains("hidden")) closeShare(); });
}
const hint = (t) => { const h = $("#shareHint"); if (h) h.textContent = t; };
async function paintShare() {
  const my = ++sh.busy, cv = $("#shareCanvas");
  document.querySelectorAll("#shareModal [data-fmt]").forEach((b) => {
    const on = b.dataset.fmt === sh.fmt; b.setAttribute("aria-selected", String(on));
    b.className = "rounded-lg px-3 py-2 text-sm font-semibold " + (on ? "bg-optic text-court-900" : "text-white/70 hover:bg-white/10");
  });
  // make sure the web fonts are ready, otherwise the image would be drawn in a fallback font
  try { await Promise.all([document.fonts.load('800 100px "Bricolage Grotesque"'), document.fonts.load('700 30px "DM Sans"'), document.fonts.load('600 30px "DM Sans"'), document.fonts.load('500 30px "DM Sans"')]); } catch (e) {}
  if (my !== sh.busy || !sh.p) return;
  drawCard(cv, sh.fmt, sh.p, lastRk.length, lastData);
}
function shareFile() {
  return new Promise((res) => $("#shareCanvas").toBlob((b) => {
    if (!b) { hint("Couldn't create the image. Try again."); return res(null); }
    const nm = (sh.p.name || "player").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "player";
    res(new File([b], "dinkhub-" + nm + "-" + sh.fmt + ".png", { type: "image/png" }));
  }, "image/png"));
}
function saveFile(f) { const u = URL.createObjectURL(f), a = document.createElement("a"); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
function openShare(i, opener) {
  const r = lastRk[i]; if (!r) return;
  ensureShareModal(); sh.p = { name: r.name, rank: r.rank, wins: r.wins, games: r.games }; sh.opener = opener;
  const m = $("#shareModal"); m.classList.remove("hidden"); m.classList.add("flex"); document.body.style.overflow = "hidden";
  paintShare(); $("#shareClose").focus();
}
function closeShare() { const m = $("#shareModal"); if (!m) return; m.classList.add("hidden"); m.classList.remove("flex"); document.body.style.overflow = ""; sh.p = null; if (sh.opener && sh.opener.focus) sh.opener.focus(); }
document.addEventListener("click", (e) => { const b = e.target.closest("[data-share]"); if (b) openShare(+b.dataset.share, b); });

// ---- views ----
const SLOTS = [[19, 28], [19, 72], [81, 28], [81, 72]];
const COURT_SVG = `<svg viewBox="0 0 440 220" aria-hidden="true">
    <rect width="440" height="220" fill="#0f3a32"/>
    <rect x="14" y="14" width="412" height="192" fill="#1b5e51"/>
    <rect x="154.5" y="14" width="131" height="192" fill="#d7ff3f" fill-opacity=".07"/>
    <g stroke="#d7ff3f" stroke-opacity=".75" stroke-width="2" fill="none">
      <rect x="14" y="14" width="412" height="192"/>
      <line x1="154.5" y1="14" x2="154.5" y2="206"/><line x1="285.5" y1="14" x2="285.5" y2="206"/>
      <line x1="14" y1="110" x2="154.5" y2="110"/><line x1="285.5" y1="110" x2="426" y2="110"/>
    </g>
    <line x1="220" y1="6" x2="220" y2="214" stroke="#fff" stroke-opacity=".9" stroke-width="4" stroke-dasharray="3 3"/>
  </svg>`;

function unavailable(title, body) {
  $("#liveBadge").classList.add("hidden"); $("#liveBadge").classList.remove("flex");
  $("#expiryNote").textContent = "";
  $("#app").innerHTML = `<div class="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-full bg-optic/15 text-xl text-optic"><i class="fa-solid fa-link-slash"></i></span>
    <h2 class="mt-4 font-display text-2xl font-bold">${esc(title)}</h2>
    <p class="mt-2 text-sm text-white/60">${esc(body)}</p></div>`;
}

function render(d) {
  const courts = list(d.courts), queue = list(d.queue), breaks = list(d.breaks), log = list(d.log), rk = list(d.ranking);
  const st = d.stats || {}, finished = !!d.finished;
  lastRk = rk; lastData = d;
  const stat = (label, val) => `<div class="flex items-baseline gap-2 px-4 py-3 sm:gap-2.5 sm:px-5 sm:py-4"><dd class="num font-display text-2xl font-extrabold leading-none sm:text-3xl">${val}</dd><dt class="text-sm text-white/60">${label}</dt></div>`;

  const queueRow = (q, i) => `<li class="flex items-center gap-3 py-2">
      <span class="num w-5 shrink-0 text-center text-sm font-semibold text-white/45">${i + 1}</span>
      <div class="min-w-0 flex-1"><div class="truncate font-semibold">${esc(q.name)}</div>
        <div class="num truncate whitespace-nowrap text-[9px] leading-tight text-white/50 min-[400px]:text-[10px] sm:text-xs">${q.wins || 0} ${(q.wins || 0) === 1 ? "win" : "wins"}, ${q.games || 0} played, waiting <span data-since="${q.queuedAt || Date.now()}">${fmt(Date.now() - (q.queuedAt || Date.now()))}</span></div></div></li>`;

  let queueHtml;
  if (!queue.length) queueHtml = `<p class="rounded-xl border border-dashed border-white/20 p-5 text-center text-sm text-white/55">${finished ? "This open play has finished." : "Nobody is waiting right now."}</p>`;
  else {
    const nextN = Math.min(4, queue.length);
    const matchup = queue.length >= 4 ? `${esc(queue[0].name)} &amp; ${esc(queue[1].name)} vs ${esc(queue[2].name)} &amp; ${esc(queue[3].name)}` : `Need ${4 - queue.length} more ${4 - queue.length === 1 ? "player" : "players"} to start`;
    queueHtml = `<div class="rounded-xl border-l-4 border-optic bg-optic/10 px-3 pb-1 pt-3">
        <div class="text-sm font-bold text-optic">Next game</div>
        <div class="mt-0.5 text-sm text-white/70">${matchup}</div>
        <ul class="mt-1 divide-y divide-white/10">${queue.slice(0, nextN).map(queueRow).join("")}</ul></div>
      ${queue.length > 4 ? `<ul class="mt-2 divide-y divide-white/10 px-3">${queue.slice(4).map((q, i) => queueRow(q, i + 4)).join("")}</ul>` : ""}`;
  }

  const courtsHtml = courts.map((c) => {
    const pl = list(c.players);
    const slots = SLOTS.map(([x, y], k) => {
      const pos = `left:${x}%;top:${y}%`;
      return pl[k] ? `<div class="slot filled" style="${pos}"><span>${esc(pl[k])}</span></div>` : `<div class="slot open" style="${pos}">Open</div>`;
    }).join("");
    const head = pl.length
      ? `<span class="flex items-center gap-2 text-sm text-white/70"><span class="live h-2.5 w-2.5 rounded-full bg-optic"></span>In play <span class="num font-display text-2xl font-bold text-white" data-start="${c.startedAt || Date.now()}">${fmt(Date.now() - (c.startedAt || Date.now()))}</span></span>`
      : `<span class="text-sm text-white/55">${finished ? "Finished" : "Waiting for the next game"}</span>`;
    return `<article class="overflow-hidden rounded-2xl bg-court-800">
      <div class="flex items-center justify-between gap-3 px-4 pb-3 pt-4"><h3 class="font-display text-xl font-bold">${esc(c.name)}</h3>${head}</div>
      <div class="court">${COURT_SVG}${slots}</div><div class="h-3"></div></article>`;
  }).join("");

  const logHtml = log.length ? log.map((g) => {
    const side = (names, w) => `<span class="${g.winner === w ? "font-bold text-optic" : "text-white/80"}">${g.winner === w ? '<i class="fa-solid fa-trophy mr-1 text-xs"></i>' : ""}${list(names).map(esc).join(" &amp; ")}</span>`;
    return `<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
      <span>${side(g.a, "A")} <span class="mx-1 text-white/40">vs</span> ${side(g.b, "B")}</span>
      <span class="num text-xs text-white/50">${esc(g.court || "")}, ${new Date(g.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></li>`;
  }).join("") : `<li class="py-4 text-white/50">Finished games appear here.</li>`;

  const badge = (r) => !r.wins ? "bg-white/10" : r.rank === 1 ? "bg-optic text-court-900" : r.rank === 2 ? "bg-white/30" : r.rank === 3 ? "bg-amber-400/30 text-amber-200" : "bg-white/10";
  const lbRow = (r, i) => {
    const top = r.rank === 1 && r.wins > 0, pct = r.games ? Math.round((r.wins / r.games) * 100) : 0;
    return `<li class="rounded-xl px-3 py-2.5 ${top ? "bg-optic text-court-900" : "bg-court-700"}">
      <div class="flex items-center gap-2.5">
        <span class="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold ${top ? "bg-court-900 text-optic" : badge(r)}">${r.rank}</span>
        <span class="min-w-0 flex-1 truncate font-semibold">${esc(r.name)}${r.playing ? ` <span class="live ml-1 inline-block h-2 w-2 rounded-full align-middle ${top ? "bg-court-900" : "bg-optic"}" title="On court now"></span>` : ""}</span>
        <span class="num shrink-0 text-right text-xs leading-tight"><b class="text-sm">${r.wins} ${r.wins === 1 ? "win" : "wins"}</b><br><span class="${top ? "text-court-900/70" : "text-white/55"}">${r.games} played</span></span>
        <button type="button" data-share="${i}" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${top ? "bg-court-900/15 hover:bg-court-900/25" : "bg-white/10 hover:bg-white/20"}" aria-label="Share ${esc(r.name)}'s stats" title="Share stats"><i class="fa-solid fa-share-nodes"></i></button>
      </div>
      <div class="mt-2 h-1 overflow-hidden rounded-full ${top ? "bg-court-900/20" : "bg-white/10"}" title="${pct}% win rate"><div class="h-full rounded-full ${top ? "bg-court-900" : "bg-optic"}" style="width:${pct}%"></div></div></li>`;
  };

  $("#app").innerHTML = `
    ${finished ? `<div class="mb-5 flex items-center gap-3 rounded-2xl border border-optic/40 bg-optic/10 px-4 py-3 text-sm"><i class="fa-solid fa-flag-checkered text-optic"></i><span><b class="text-optic">Open play finished.</b> These are the final standings.</span></div>` : ""}
    <section class="overflow-hidden rounded-2xl border border-white/10 bg-court-800">
      <dl class="grid grid-cols-2 divide-x divide-white/10 sm:grid-cols-4 [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-white/10 sm:[&>*:nth-child(n+3)]:border-t-0">
        ${stat("Players", st.players || 0)}${stat("Waiting", st.waiting || 0)}${stat("On court", st.onCourt || 0)}${stat("Free courts", st.free || 0)}</dl>
    </section>
    <div class="mt-6 grid gap-6 sm:mt-8 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
      ${courts.length ? `<section class="min-w-0 lg:col-start-1 lg:row-start-1"><h2 class="sr-only">Courts</h2><div class="grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">${courtsHtml}</div></section>` : ""}
      <aside class="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
        <div class="rounded-2xl bg-court-800 p-4 sm:p-5">
          <div class="flex items-baseline justify-between"><h2 class="font-display text-2xl font-bold">Queue</h2><span class="num text-sm text-white/55">${queue.length ? queue.length + " waiting" : ""}</span></div>
          <div class="mt-4">${queueHtml}</div>
          ${breaks.length ? `<div class="mt-6"><h3 class="font-display text-base font-bold text-white/80">On break</h3><ul class="mt-2 divide-y divide-white/10">${breaks.map((n) => `<li class="py-2">${esc(n)}</li>`).join("")}</ul></div>` : ""}
        </div>
      </aside>
      <div class="min-w-0 lg:col-start-1 lg:row-start-2">
        <h2 class="font-display text-xl font-bold">Finished games</h2>
        <ul class="mt-3 divide-y divide-white/10 border-y border-white/10 text-sm">${logHtml}</ul>
      </div>
      <div class="min-w-0 lg:col-start-1 lg:row-start-3">
        <div class="rounded-2xl bg-court-800 p-4 sm:p-5">
          <div class="flex items-baseline justify-between"><h2 class="font-display text-xl font-bold"><i class="fa-solid fa-trophy mr-2 text-base text-optic"></i>Leaderboard</h2><span class="num text-sm text-white/55">${rk.length ? rk.length + " ranked" : ""}</span></div>
          <div class="mt-4">${rk.length ? `<ol class="grid gap-2 sm:grid-cols-2">${rk.map(lbRow).join("")}</ol>` : `<p class="rounded-xl border border-dashed border-white/20 p-5 text-center text-sm text-white/55">Rankings appear here after the first finished game.</p>`}</div>
          <p class="mt-3 text-xs leading-snug text-white/45">Tap <i class="fa-solid fa-share-nodes"></i> on your name to share your stats. Ranked by wins. On equal wins, fewer games played ranks higher.</p>
        </div>
      </div>
    </div>`;
  const lb = $("#liveBadge"); lb.classList.toggle("hidden", finished); lb.classList.toggle("flex", !finished);
  $("#expiryNote").textContent = d.expiresAt ? "This page is available until " + new Date(d.expiresAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + "." : "";
}

// ---- live data ----
let expiresAt = 0;
function expired() {
  unavailable("This open play is no longer available", "Share links last 7 days, or the host stopped sharing. Ask the host for a new QR code.");
  // anyone may delete an expired open play (the database rules allow it), so it is cleaned up even if the host never returns
  if (/^[a-f0-9]{32}$/.test(id)) remove(ref(db, "openplays/" + id)).catch(() => {});
}
if (!/^[a-f0-9]{32}$/.test(id)) unavailable("This link isn't valid", "Scan the QR code from the host again.");
else onValue(ref(db, "openplays/" + id), (snap) => {
  const d = snap.val();
  if (!d) return unavailable("This open play is no longer available", "Share links last 7 days, or the host stopped sharing. Ask the host for a new QR code.");
  expiresAt = d.expiresAt || 0;
  if (expiresAt && Date.now() > expiresAt) return expired();
  render(d); tick();
}, () => expired());

// live timers without re-rendering; also hides the page the moment the 7 days run out
function tick() {
  document.querySelectorAll("[data-start]").forEach((el) => (el.textContent = fmt(Date.now() - +el.dataset.start)));
  document.querySelectorAll("[data-since]").forEach((el) => (el.textContent = fmt(Date.now() - +el.dataset.since)));
  $("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (expiresAt && Date.now() > expiresAt) { expiresAt = 0; expired(); }
}
setInterval(tick, 1000); tick();