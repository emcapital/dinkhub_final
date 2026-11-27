(() => {
  const KEY = "dinkhub_openplay_v1";
  const $ = (s) => document.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- State ----
  let state = {
    players: {},       // id -> {id, name, games, joinedAt, queuedAt, status: 'queue'|'playing'|'break'}
    queue: [],         // ordered player ids
    courts: [],        // {id, name, players: [4 ids] | null, startedAt}
    log: [],           // {t, a:[names], b:[names], winner:'A'|'B'|null, court}
    winnersStay: false,
    fixedPartner: false, // false = rotating partners, true = fixed pairs (queue order: 1&2, 3&4, ...)
    autoFill: false,    // when true, empty courts fill automatically from the queue
    courtCount: 3,
    setupDone: false,   // false until the courts question has been answered for this session
  };
  const load = () => {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.players) state = Object.assign(state, s); } catch (e) {}
    syncCourts();
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  function syncCourts() {
    while (state.courts.length < state.courtCount) state.courts.push({ id: uid(), name: "Court " + (state.courts.length + 1), players: null, startedAt: null });
    // shrinking only removes empty courts from the end
    while (state.courts.length > state.courtCount && !state.courts[state.courts.length - 1].players) state.courts.pop();
    state.courtCount = state.courts.length;
  }

  // ---- Helpers ----
  const P = (id) => state.players[id];
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); };
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg;
    t.classList.remove("opacity-0", "translate-y-10");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("opacity-0", "translate-y-10"), 2200);
  }
  function enqueue(id) { const p = P(id); p.status = "queue"; p.queuedAt = Date.now(); state.queue.push(id); }

  // ---- Team pairing: avoid putting recent teammates together ----
  // Each player remembers their last 3 partners (most recent first). Pairing the same two again costs a lot,
  // and the most recent partner costs the most, so the best split of any four players is the one with the lowest cost.
  const RECENT_KEEP = 3, PAIR_COST = [100, 40, 20];
  function pairCost(x, y) {
    const ix = ((P(x) && P(x).recent) || []).indexOf(y), iy = ((P(y) && P(y).recent) || []).indexOf(x);
    const k = Math.min(ix < 0 ? 99 : ix, iy < 0 ? 99 : iy);
    return k === 99 ? 0 : PAIR_COST[k] || 10;
  }
  // takes four ids, returns them ordered [A1, A2, B1, B2] with the least repeated partnerships
  function arrangeTeams(ids) {
    if (state.fixedPartner) return ids.slice(); // fixed pairs: keep them as they sit in the queue
    const [a, b, c, d] = ids;
    const options = [[a, b, c, d], [a, c, b, d], [a, d, b, c]]; // first option = queue order wins ties
    let best = options[0], bestCost = Infinity;
    options.forEach((o) => { const cost = pairCost(o[0], o[1]) + pairCost(o[2], o[3]); if (cost < bestCost) { bestCost = cost; best = o; } });
    return best;
  }
  function rememberPartners(x, y) {
    [[x, y], [y, x]].forEach(([me, other]) => {
      const p = P(me); if (!p) return;
      p.recent = [other, ...(p.recent || []).filter((id) => id !== other)].slice(0, RECENT_KEEP);
    });
  }

  // ---- Actions ----
  function addPlayers(raw) {
    const names = raw.split(/[\n,]+/).map((n) => n.trim()).filter(Boolean);
    let added = 0, dupes = 0;
    names.forEach((n) => {
      if (Object.values(state.players).some((p) => p.name.toLowerCase() === n.toLowerCase())) { dupes++; return; }
      const id = uid();
      state.players[id] = { id, name: n, games: 0, wins: 0, recent: [], joinedAt: Date.now(), queuedAt: Date.now(), status: "queue" };
      state.queue.push(id); added++;
    });
    autoFillCourts();
    save(); render();
    toast(added ? `${added} added to queue${dupes ? ` · ${dupes} duplicate skipped` : ""}` : dupes ? "Already in the list" : "Enter a name first");
  }
  function removePlayer(id) {
    const p = P(id); if (!p) return;
    state.queue = state.queue.filter((x) => x !== id);
    state.courts.forEach((c) => { if (c.players && c.players.includes(id)) subOut(c, id, true); });
    delete state.players[id]; save(); render();
  }
  function toBreak(id) {
    const p = P(id);
    if (p.status === "queue") { state.queue = state.queue.filter((x) => x !== id); p.status = "break"; }
    save(); render();
  }
  function fromBreak(id) { enqueue(id); autoFillCourts(); save(); render(); }
  function moveInQueue(id, dir) {
    const i = state.queue.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= state.queue.length) return;
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]]; save(); render();
  }
  function skipToFront(id) { state.queue = [id, ...state.queue.filter((x) => x !== id)]; save(); render(); }
  function fillCourt(c) {
    if (c.players) return false;
    if (state.queue.length < 4) return false;
    c.players = arrangeTeams(state.queue.splice(0, 4));
    c.players.forEach((id) => (P(id).status = "playing"));
    c.startedAt = Date.now(); return true;
  }
  function autoFillCourts() {
    if (!state.autoFill) return 0;
    let n = 0; state.courts.forEach((c) => { if (fillCourt(c)) n++; });
    return n;
  }
  function toggleAuto() {
    state.autoFill = !state.autoFill;
    const n = autoFillCourts();
    save(); render();
    toast(state.autoFill ? (n ? `Auto-fill on · ${n} court${n > 1 ? "s" : ""} started, games start automatically` : "Auto-fill on · games start automatically") : "Auto-fill off · start games manually");
  }
  function subOut(c, id, silent) {
    const idx = c.players.indexOf(id);
    const next = state.queue.shift();
    if (next) {
      c.players[idx] = next; P(next).status = "playing";
      if (!silent && P(id)) enqueue(id);
    } else {
      // no sub available: pull player off, court empties
      c.players.splice(idx, 1);
      c.players.forEach((x) => enqueue(x));
      if (!silent && P(id)) enqueue(id);
      c.players = null; c.startedAt = null;
    }
    if (!silent) { save(); render(); }
  }
  function finishGame(c, winner) {
    const [a1, a2, b1, b2] = c.players;
    const A = [a1, a2], B = [b1, b2];
    state.log.unshift({ t: Date.now(), a: A.map((i) => P(i).name), b: B.map((i) => P(i).name), winner, court: c.name });
    state.log = state.log.slice(0, 30);
    [...A, ...B].forEach((i) => P(i).games++);
    if (winner) (winner === "A" ? A : B).forEach((i) => (P(i).wins = (P(i).wins || 0) + 1));
    // remember who just played together so they are not paired again right away
    rememberPartners(a1, a2); rememberPartners(b1, b2);
    const stay = state.winnersStay && winner ? (winner === "A" ? A : B) : [];
    const go = [...A, ...B].filter((i) => !stay.includes(i));
    if (stay.length && state.queue.length >= 2) {
      // losers rotate out; winners stay and face the next two (teams arranged to avoid repeat partners)
      go.forEach(enqueue);
      c.players = arrangeTeams([...stay, state.queue.shift(), state.queue.shift()]);
      c.players.forEach((i) => (P(i).status = "playing"));
      c.startedAt = Date.now();
    } else {
      // winners join the back of the queue first, then the losers right behind them
      const winSide = winner === "A" ? A : winner === "B" ? B : [], loseSide = winner === "A" ? B : winner === "B" ? A : [...A, ...B];
      [...winSide, ...loseSide].forEach(enqueue);
      c.players = null; c.startedAt = null;
    }
    // auto-fill the court with the next 4 in the queue
    const refilled = !c.players && state.autoFill && fillCourt(c);
    save(); render(); closeModal();
    if (refilled) toast(`${c.name}: next game started`);
  }

  // ---- Modals ----
  let modalLocked = false;
  function openModal(html, locked, wide) { modalLocked = !!locked; const mb = $("#modalBody"); mb.style.maxWidth = wide ? (typeof wide === "string" ? wide : "42rem") : ""; mb.scrollTop = 0; mb.style.overflowY = ""; mb.innerHTML = html; $("#modal").classList.remove("hidden"); $("#modal").classList.add("flex"); }
  function closeModal() {
    modalLocked = false; $("#modal").classList.add("hidden"); $("#modal").classList.remove("flex");
    if (!state.setupDone) setTimeout(courtsSetupModal, 0); // a new session always starts by asking for the courts
  }
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" && !modalLocked) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modalLocked) closeModal(); });

  function setCourtCount(n) {
    n = Math.max(1, Math.min(12, n));
    if (n < state.courtCount && state.courts.slice(n).some((c) => c.players)) return false;
    state.courtCount = n; state.courts = state.courts.slice(0, n); syncCourts(); autoFillCourts(); save(); render(); return true;
  }
  const stepperHtml = (n) => `<div class="mt-4 flex items-center justify-center gap-5">
      <button type="button" id="cMinus" class="h-12 w-12 rounded-xl bg-white/10 text-xl hover:bg-white/20" aria-label="Fewer courts">−</button>
      <span id="cVal" class="num w-14 text-center font-display text-5xl font-extrabold" aria-live="polite">${n}</span>
      <button type="button" id="cPlus" class="h-12 w-12 rounded-xl bg-white/10 text-xl hover:bg-white/20" aria-label="More courts">+</button></div>`;
  function courtsSetupModal() {
    if (state.setupDone || !$("#modal").classList.contains("hidden")) return;
    let n = state.courtCount;
    openModal(`
      <h3 class="font-display text-2xl font-bold">How many courts are there?</h3>
      <p class="mt-1 text-sm text-white/60">Players are placed on these courts as they come up in the queue. You can change this any time from Settings (the gear icon).</p>
      ${stepperHtml(n)}
      <button id="mStart" class="mt-6 w-full rounded-xl bg-optic px-3 py-3 font-bold text-court-900 hover:bg-optic-dark">Start open play</button>`, true);
    const upd = () => ($("#cVal").textContent = n);
    $("#cMinus").onclick = () => { n = Math.max(1, n - 1); upd(); };
    $("#cPlus").onclick = () => { n = Math.min(12, n + 1); upd(); };
    $("#mStart").onclick = () => { setCourtCount(n); state.setupDone = true; save(); closeModal(); autoTour(); };
    $("#mStart").focus();
  }

  // ---- Confirm modal (break, rejoin, remove) ----
  function confirmModal({ title, body, label, icon, danger, onYes }) {
    openModal(`
      <div class="flex items-start gap-3">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${danger ? "bg-red-500/15 text-red-300" : "bg-optic/15 text-optic"}"><i class="fa-solid ${icon}"></i></span>
        <div class="min-w-0"><h3 class="font-display text-xl font-bold leading-snug">${title}</h3>
          <p class="mt-1 text-sm text-white/60">${body}</p></div>
      </div>
      <div class="mt-6 flex gap-2">
        <button id="cfNo" class="flex-1 rounded-xl bg-white/5 px-3 py-2.5 text-sm font-semibold hover:bg-white/10">Cancel</button>
        <button id="cfYes" class="flex-1 rounded-xl px-3 py-2.5 font-bold ${danger ? "bg-red-500 text-white hover:bg-red-400" : "bg-optic text-court-900 hover:bg-optic-dark"}">${label}</button>
      </div>`);
    $("#cfNo").onclick = closeModal;
    $("#cfYes").onclick = () => { closeModal(); onYes(); };
    $("#cfYes").focus();
  }
  function confirmBreak(id) {
    const p = P(id); if (!p || p.status !== "queue") return;
    confirmModal({ title: `Send ${esc(p.name)} on break?`, body: `${esc(p.name)} leaves the queue and can rejoin at the back of the line.`, label: "Take a break", icon: "fa-mug-hot", onYes: () => toBreak(id) });
  }
  function confirmRejoin(id) {
    const p = P(id); if (!p || p.status !== "break") return;
    confirmModal({ title: `Rejoin the queue?`, body: `${esc(p.name)} goes to the back of the line.`, label: "Rejoin", icon: "fa-right-to-bracket", onYes: () => fromBreak(id) });
  }
  function confirmRemove(id) {
    const p = P(id); if (!p) return;
    confirmModal({ title: `Remove ${esc(p.name)}?`, body: `${esc(p.name)} is taken out of this open play, including their wins and games played.`, label: "Remove player", icon: "fa-user-xmark", danger: true, onYes: () => removePlayer(id) });
  }

  // ---- Choose who plays ----
  function pickModal(c) {
    if (c.players || state.queue.length < 4) return;
    const sel = [];
    openModal(`
      <h3 class="font-display text-2xl font-bold">${esc(c.name)}: choose players</h3>
      <p class="mt-1 text-sm text-white/60">Tap four players. The first two form the left side, the next two the right side. Tap again to unselect.</p>
      <div id="pkSummary" class="mt-4 grid grid-cols-2 gap-2 text-sm"></div>
      <ul id="pkList" class="mt-3 max-h-[38vh] space-y-2 overflow-y-auto pr-1"></ul>
      <div class="mt-4 flex gap-2">
        <button id="pkCancel" class="flex-1 rounded-xl bg-white/5 px-3 py-2.5 text-sm hover:bg-white/10">Cancel</button>
        <button id="pkGo" class="flex-1 rounded-xl bg-optic px-3 py-2.5 font-bold text-court-900 hover:bg-optic-dark disabled:cursor-not-allowed disabled:opacity-35">Start game</button>
      </div>`);
    const side = (a) => (a.length ? a.map((i) => esc(P(i).name)).join(" &amp; ") : "—");
    const draw = () => {
      const list = $("#pkList"), st = list.scrollTop;
      list.innerHTML = state.queue.map((id, i) => {
        const k = sel.indexOf(id), on = k >= 0;
        return `<li><button data-pk="${id}" aria-pressed="${on}" class="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? "border-optic bg-optic/10" : "border-white/10 bg-court-700 hover:border-white/30"}">
          <span class="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${on ? "bg-optic text-court-900" : "bg-white/10 text-white/60"}">${on ? (k < 2 ? "L" : "R") + ((k % 2) + 1) : i + 1}</span>
          <span class="min-w-0 flex-1 truncate font-semibold">${esc(P(id).name)}</span>
          <span class="num shrink-0 text-xs text-white/50">${P(id).wins || 0} W · ${P(id).games} G</span></button></li>`;
      }).join("");
      list.scrollTop = st;
      $("#pkSummary").innerHTML = [["Left side", sel.slice(0, 2)], ["Right side", sel.slice(2, 4)]].map(([t, a]) =>
        `<div class="rounded-xl bg-court-900 p-3"><div class="text-xs text-white/50">${t}</div><div class="mt-0.5 truncate font-semibold">${side(a)}</div></div>`).join("");
      $("#pkGo").disabled = sel.length !== 4;
      $("#pkGo").textContent = sel.length === 4 ? "Start game" : `Pick ${4 - sel.length} more`;
    };
    $("#pkList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pk]"); if (!b) return;
      const id = b.dataset.pk, k = sel.indexOf(id);
      if (k >= 0) sel.splice(k, 1); else if (sel.length < 4) sel.push(id);
      draw();
    });
    $("#pkCancel").onclick = closeModal;
    $("#pkGo").onclick = () => {
      if (sel.length !== 4 || c.players) return;
      c.players = sel.slice();
      state.queue = state.queue.filter((id) => !sel.includes(id));
      sel.forEach((id) => (P(id).status = "playing"));
      c.startedAt = Date.now();
      save(); render(); closeModal(); toast(`${c.name}: game started`);
    };
    draw();
  }
  function swapPicker(c, id) {
    if (!state.queue.length) { subOut(c, id); return; } // nobody waiting: original behaviour
    const out = esc(P(id).name);
    openModal(`
      <h3 class="font-display text-2xl font-bold">Swap out ${out}</h3>
      <p class="mt-1 text-sm text-white/60">Choose who comes on. ${out} goes to the back of the queue.</p>
      <ul id="swList" class="mt-4 max-h-[46vh] space-y-2 overflow-y-auto pr-1">${state.queue.map((q, i) => `<li>
        <button data-sw="${q}" class="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-court-700 px-3 py-2.5 text-left transition-colors hover:border-optic focus-visible:border-optic">
          <span class="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/60">${i + 1}</span>
          <span class="min-w-0 flex-1 truncate font-semibold">${esc(P(q).name)}</span>
          <span class="num shrink-0 text-xs text-white/50">${i === 0 ? "Next in line · " : ""}${P(q).wins || 0} W · ${P(q).games} G</span></button></li>`).join("")}</ul>
      <button id="swCancel" class="mt-4 w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm hover:bg-white/10">Cancel</button>`);
    $("#swList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sw]"); if (!b) return;
      const inId = b.dataset.sw, idx = c.players ? c.players.indexOf(id) : -1;
      if (idx < 0 || !state.queue.includes(inId)) return closeModal();
      state.queue = state.queue.filter((x) => x !== inId);
      c.players[idx] = inId; P(inId).status = "playing"; enqueue(id);
      save(); render(); closeModal();
    });
    $("#swCancel").onclick = closeModal;
  }

  function endGameModal(c) {
    const [a1, a2, b1, b2] = c.players.map((i) => esc(P(i).name));
    const team = (key, side, x, y) => `<button data-win="${key}" class="rounded-xl border border-white/15 bg-court-700 p-4 text-left hover:border-optic focus-visible:border-optic">
      <div class="text-sm text-white/60">${side}</div><div class="mt-1 font-display text-lg font-bold leading-snug">${x}<br>${y}</div></button>`;
    openModal(`
      <h3 class="font-display text-2xl font-bold">${esc(c.name)}: who won?</h3>
      <p class="mt-1 text-sm text-white/60">${state.winnersStay ? state.fixedPartner ? "Winners stay on court together and face the next two players in line. Losers go to the back of the queue." : "Winners stay on court, split up, and each pairs with one of the next two players in line. Losers go to the back of the queue." : "Winners go to the back of the queue first, then the losers right behind them."}${state.autoFill ? " The next four in line start automatically." : ""}</p>
      <div class="mt-5 grid grid-cols-2 gap-3">${team("A", "Left side", a1, a2)}${team("B", "Right side", b1, b2)}</div>
      <div class="mt-3 flex gap-2">
        <button data-win="" class="flex-1 rounded-xl bg-white/5 px-3 py-2.5 text-sm hover:bg-white/10">End without a winner</button>
        <button id="mCancel" class="flex-1 rounded-xl bg-white/5 px-3 py-2.5 text-sm hover:bg-white/10">Keep playing</button>
      </div>`);
    document.querySelectorAll("[data-win]").forEach((b) => (b.onclick = () => finishGame(c, b.dataset.win || null)));
    $("#mCancel").onclick = closeModal;
  }
  function settingsModal() {
    openModal(`
      <h3 class="font-display text-2xl font-bold">Settings</h3>
      <label class="mt-5 block text-sm text-white/70">Number of courts</label>
      <div class="mt-2 flex items-center gap-4">
        <button id="cMinus" class="h-11 w-11 rounded-xl bg-white/10 text-lg hover:bg-white/20" aria-label="Fewer courts">−</button>
        <span id="cVal" class="num w-8 text-center font-display text-3xl font-bold">${state.courtCount}</span>
        <button id="cPlus" class="h-11 w-11 rounded-xl bg-white/10 text-lg hover:bg-white/20" aria-label="More courts">+</button>
      </div>
      <p id="cNote" class="mt-2 text-sm text-white/50">Only empty courts can be removed.</p>
      <hr class="my-5 border-white/10" />
      <button id="btnReset" class="w-full rounded-xl border border-red-400/40 px-3 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/10">Reset session and clear all players</button>
      <button id="mClose" class="mt-2 w-full rounded-xl bg-optic px-3 py-2.5 font-bold text-court-900">Done</button>`);
    const setCount = (n) => {
      if (!setCourtCount(n)) { $("#cNote").textContent = "Finish the games on the higher-numbered courts first."; return; }
      $("#cVal").textContent = state.courtCount; $("#cNote").textContent = "Only empty courts can be removed.";
    };
    $("#cMinus").onclick = () => setCount(state.courtCount - 1);
    $("#cPlus").onclick = () => setCount(state.courtCount + 1);
    $("#mClose").onclick = closeModal;
    $("#btnReset").onclick = () => {
      if (!confirm("Clear all players, courts and history?")) return;
      state.players = {}; state.queue = []; state.log = []; state.courts.forEach((c) => { c.players = null; c.startedAt = null; });
      state.setupDone = false; save(); render(); closeModal();
    };
  }

  // Ranking: most wins first; on equal wins the player with fewer games ranks higher. Equal on both share a rank, and the next rank follows on directly (1, 2, 2, 3).
  function buildRanking(list) {
    const sorted = list.filter((p) => p.games > 0).map((p) => ({ name: p.name, wins: p.wins || 0, games: p.games, status: p.status }))
      .sort((x, y) => y.wins - x.wins || x.games - y.games || x.name.localeCompare(y.name));
    sorted.forEach((r, i) => { const p = sorted[i - 1]; r.rank = !p ? 1 : r.wins === p.wins && r.games === p.games ? p.rank : p.rank + 1; });
    return sorted;
  }
  function downloadCsv(snap) {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["Rank", "Player", "Wins", "Games played"], ...snap.ranking.map((r) => [r.rank, r.name, r.wins, r.games]), [], ["Court", "Team A", "Team B", "Winner", "Time"],
      ...snap.log.slice().reverse().map((g) => [g.court, g.a.join(" & "), g.b.join(" & "), g.winner ? "Team " + g.winner : "", new Date(g.t).toLocaleString()])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "open-play-" + new Date().toISOString().slice(0, 10) + ".csv"; a.click(); URL.revokeObjectURL(url);
  }
  function resultsModal(snap) {
    const rk = snap.ranking, winners = rk.filter((r) => r.wins > 0);
    // everyone who shares a top-3 rank stands on the podium (ties included, up to 8)
    const pod = winners.filter((r) => r.rank <= 3).slice(0, 8), rest = rk.filter((r) => !pod.includes(r));
    const n = rest.length, dense = n > 10, cols = n > 16 ? 3 : n > 5 ? 2 : 1;
    const gridCls = ["", "grid-cols-1", "grid-cols-1 sm:grid-cols-2", "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"][cols];
    const width = !n ? "34rem" : cols === 1 ? "52rem" : cols === 2 ? "64rem" : "76rem";
    const ini = (s) => s.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    // pillar heights scale with the window height so the whole screen fits without scrolling
    const TONE = { 1: { c: "#d7ff3f", h: "clamp(4.5rem,15vh,7rem)", d: 0.45 }, 2: { c: "#cbd5e1", h: "clamp(3.4rem,11vh,5.25rem)", d: 0.25 }, 3: { c: "#e0a458", h: "clamp(2.6rem,8vh,4rem)", d: 0.1 } };
    // one pillar per place (1st, 2nd, 3rd); players who tie share it and are stacked vertically above it
    const colG = (k, compact) => {
      const g = tierOf(k), t = TONE[k], first = k === 1, tied = g.length > 1;
      const who = (r, i) => {
        const av = compact ? "h-9 w-9 text-sm" : tied ? (first ? "h-11 w-11 text-base" : "h-10 w-10 text-sm") : first ? "rk-pulse h-[4.5rem] w-[4.5rem] text-2xl" : "h-12 w-12 text-lg";
        const d = t.d + 0.3 + i * 0.08;
        const crown = first ? `<i class="fa-solid fa-crown rk-fade mb-0.5 ${tied ? "text-sm" : "text-xl"}" style="color:${t.c};animation-delay:${d + 0.2}s"></i>` : "";
        return `<div class="flex w-full min-w-0 flex-col items-center ${tied ? (compact ? "mb-1.5" : "mb-3") : ""}">${crown}
          <div class="rk-fade ${av} relative flex items-center justify-center rounded-full font-display font-extrabold" style="background:${t.c};color:#0b2a24;animation-delay:${d}s;box-shadow:0 0 0 4px ${t.c}33${first && !tied ? `,0 0 32px ${t.c}66` : ""}">${esc(ini(r.name))}</div>
          <div class="rk-fade mt-1.5 w-full truncate text-center font-display ${first && !tied ? "text-lg" : "text-base"} font-bold leading-tight" style="animation-delay:${d + 0.05}s">${esc(r.name)}</div>
          <div class="rk-fade num text-center text-xs text-white/60" style="animation-delay:${d + 0.1}s"><b class="text-sm text-white">${r.wins} ${r.wins === 1 ? "win" : "wins"}</b> · ${r.games} played</div></div>`;
      };
      return `<div class="flex min-w-0 flex-col items-center">${g.map(who).join("")}
        <div class="mt-2 w-full overflow-hidden rounded-t-xl" style="height:${compact ? "clamp(1.75rem,5vh,2.75rem)" : t.h}"><div class="rk-rise flex h-full items-start justify-center pt-1 font-display ${compact ? "text-xl" : "text-3xl"} font-extrabold" style="background:linear-gradient(180deg,${t.c},${t.c}40);color:#0b2a24;animation-delay:${t.d}s">${k}</div></div></div>`;
    };
    const row = (r, i) => {
      const pct = r.games ? Math.round((r.wins / r.games) * 100) : 0;
      const delay = `animation-delay:${0.9 + Math.min(i * 0.04, 0.6)}s`;
      const bar = (h) => `<span class="mt-1 block ${h} overflow-hidden rounded-full bg-white/10" title="${pct}% win rate"><span class="block h-full rounded-full bg-optic" style="width:${pct}%"></span></span>`;
      return dense
        ? `<li class="rk-fade flex items-center gap-2 rounded-lg bg-court-700 px-2.5 py-1.5" style="${delay}">
            <span class="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-extrabold">${r.rank}</span>
            <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold leading-tight">${esc(r.name)}</span>${bar("h-[3px]")}</span>
            <span class="num shrink-0 text-xs text-white/60"><b class="text-white">${r.wins}</b>W · ${r.games}G</span></li>`
        : `<li class="rk-fade flex items-center gap-3 rounded-xl bg-court-700 px-3 py-2" style="${delay}">
            <span class="num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 font-display text-sm font-extrabold">${r.rank}</span>
            <span class="min-w-0 flex-1"><span class="block truncate font-semibold leading-tight">${esc(r.name)}</span>${bar("h-1")}</span>
            <span class="num shrink-0 text-right text-xs leading-tight text-white/60"><b class="text-sm text-white">${r.wins} ${r.wins === 1 ? "win" : "wins"}</b><br>${r.games} played</span></li>`;
    };
    const chip = (v, l) => `<span class="rounded-full bg-white/5 px-3 py-1 text-white/65"><b class="num text-white">${v}</b> ${l}</span>`;
    const colors = ["#d7ff3f", "#ffffff", "#e0a458", "#cbd5e1"];
    const confetti = pod.length ? Array.from({ length: 26 }, (_, i) =>
      `<i class="rk-conf" style="left:${(i * 37) % 100}%;background:${colors[i % 4]};--x:${((i * 53) % 80) - 40}px;--r:${((i * 97) % 720) - 360}deg;animation-delay:${(0.5 + ((i * 7) % 10) * 0.09).toFixed(2)}s"></i>`).join("") : "";
    const tierOf = (k) => pod.filter((r) => r.rank === k), tiers = [2, 1, 3].filter((k) => tierOf(k).length);
    // a tie for 2nd or 3rd: the champion stands alone on top, and 2nd / 3rd place are listed below with a medal on the left and the name beside it
    const tieBelow = tierOf(2).length > 1 || tierOf(3).length > 1;
    const medalRow = (r, i) => {
      const t = TONE[r.rank], d = 0.7 + i * 0.07;
      return `<li class="rk-fade flex items-center gap-2.5 rounded-xl px-2.5 py-1.5" style="background:${t.c}22;box-shadow:inset 0 0 0 1px ${t.c}66;animation-delay:${d}s">
        <span class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style="background:${t.c};color:#0b2a24" title="${r.rank === 2 ? "2nd place" : "3rd place"}"><i class="fa-solid fa-medal"></i><span class="num absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-court-900 text-[10px] font-extrabold" style="color:${t.c}">${r.rank}</span></span>
        <span class="min-w-0 flex-1 truncate font-display font-bold">${esc(r.name)}</span>
        <span class="num shrink-0 text-right text-xs leading-tight text-white/60"><b class="text-sm text-white">${r.wins} ${r.wins === 1 ? "win" : "wins"}</b><br>${r.games} played</span></li>`;
    };
    const podium = pod.length && tieBelow
      ? `<div class="mx-auto max-w-[14rem]">${colG(1, true)}</div>
         <ul class="mt-3 grid gap-1.5 sm:grid-cols-2">${[...tierOf(2), ...tierOf(3)].map(medalRow).join("")}</ul>`
      : pod.length
      ? `<div class="grid items-end gap-2 sm:gap-3" style="grid-template-columns:repeat(${tiers.length},minmax(0,1fr))">${tiers.map(colG).join("")}</div>`
      : `<p class="rounded-xl border border-dashed border-white/20 p-5 text-center text-sm text-white/55">No games had a winner, so there is no podium.</p>`;
    const list = n ? `<div class="min-w-0 lg:self-center">
        <div class="flex items-baseline justify-between"><span class="text-xs font-bold uppercase tracking-wider text-white/45">${pod.length ? "The rest of the field" : "Players"}</span><span class="num text-xs text-white/40">${n} ${n === 1 ? "player" : "players"}</span></div>
        <ol class="mt-2 grid gap-2 ${gridCls}">${rest.map(row).join("")}</ol>
        <p class="mt-3 text-xs text-white/40">Ranked by wins. On equal wins, fewer games played ranks higher.</p></div>` : "";
    openModal(`
      <div class="pointer-events-none absolute inset-x-0 top-0 h-60" style="background:radial-gradient(60% 55% at 50% 0%,rgba(215,255,63,.16),transparent 70%)" aria-hidden="true"></div>
      <div class="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden" aria-hidden="true">${confetti}</div>
      <div class="relative">
        <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div><div class="text-xs font-bold uppercase tracking-[.22em] text-optic">Final standings</div>
            <h3 class="mt-0.5 font-display text-2xl font-extrabold sm:text-3xl">Open play finished</h3></div>
          <div class="flex flex-wrap gap-2 text-sm">${chip(snap.players, snap.players === 1 ? "player" : "players")}${chip(snap.log.length, snap.log.length === 1 ? "game" : "games")}${chip(fmt(snap.duration), "played")}</div>
        </div>
        <div class="mt-5 grid gap-6 ${n ? "lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]" : "mx-auto max-w-md"}">
          <div class="min-w-0">${podium}</div>${list}
        </div>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <button id="mImg" class="rounded-xl border border-optic/50 bg-optic/10 px-3 py-2.5 text-sm font-semibold text-optic hover:bg-optic/20"><i class="fa-solid fa-image mr-2"></i>Save as image</button>
          <button id="mCsv" class="rounded-xl border border-white/15 px-3 py-2.5 text-sm font-semibold hover:bg-white/10"><i class="fa-solid fa-download mr-2"></i>Save results (CSV)</button>
          <button id="mDone" class="col-span-2 rounded-xl bg-optic px-3 py-2.5 font-bold text-court-900 hover:bg-optic-dark">Done</button>
        </div>
      </div>`, false, width);
    $("#mCsv").onclick = () => downloadCsv(snap);
    $("#mImg").onclick = () => shareModal(snap);
    $("#mDone").onclick = closeModal;
  }
  // ---- Share image: saves the top 3 as a PNG for Instagram / Facebook ----
  // Story = 9:16 (1080 x 1920), Post = 1:1 (1080 x 1080). Drawn on a canvas so it needs no extra library.
  const SHARE = {
    story: { w: 1080, h: 1920, s: 1.1, cw: 310, gap: 14, name: "Story", ratio: "9:16", note: "Instagram & Facebook Story" },
    post: { w: 1080, h: 1080, s: 0.84, cw: 262, gap: 12, name: "Post", ratio: "1:1", note: "Instagram & Facebook feed" },
  };
  async function drawShare(snap, key) {
    const F = SHARE[key], W = F.w, H = F.h, s = F.s, story = key === "story";
    try {
      await Promise.all([
        document.fonts.load('800 64px "Bricolage Grotesque"'), document.fonts.load('700 32px "Bricolage Grotesque"'),
        document.fonts.load('500 32px "DM Sans"'), document.fonts.load('700 32px "DM Sans"'),
      ]);
    } catch (e) {}
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const x = cv.getContext("2d");
    const DISPLAY = '"Bricolage Grotesque", "DM Sans", sans-serif', BODY = '"DM Sans", sans-serif', OPTIC = "#d7ff3f";
    const spaced = (v) => { if ("letterSpacing" in x) x.letterSpacing = v; };
    const fit = (str, maxW) => {
      if (x.measureText(str).width <= maxW) return str;
      let t = str; while (t.length > 1 && x.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      return t.trimEnd() + "…";
    };
    // o: px, wt, fam, c (colour), a (align), max (shrinks then truncates to fit), ls (letter spacing)
    const text = (str, tx, ty, o) => {
      let px = o.px; const wt = o.wt || 500, fam = o.fam || BODY, set = () => (x.font = `${wt} ${Math.round(px)}px ${fam}`);
      x.textAlign = o.a || "left"; x.textBaseline = "alphabetic"; x.fillStyle = o.c || "#fff"; spaced(o.ls || "0px"); set();
      if (o.max) { while (px > o.px * 0.72 && x.measureText(str).width > o.max) { px -= 2; set(); } str = fit(str, o.max); }
      x.fillText(str, tx, ty); spaced("0px");
    };
    const rr = (rx, ry, rw, rh, r) => { x.beginPath(); if (x.roundRect) x.roundRect(rx, ry, rw, rh, r); else x.rect(rx, ry, rw, rh); };
    const ini = (n) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const sparkle = (px, py, r, a) => {
      x.save(); x.globalAlpha = a; x.fillStyle = OPTIC; x.beginPath(); x.moveTo(px, py - r);
      x.quadraticCurveTo(px, py, px + r, py); x.quadraticCurveTo(px, py, px, py + r); x.quadraticCurveTo(px, py, px - r, py); x.quadraticCurveTo(px, py, px, py - r);
      x.fill(); x.restore();
    };

    const winners = snap.ranking.filter((r) => r.wins > 0 && r.rank <= 3); // ties share their place
    const pod = winners.slice(0, 8), extra = winners.length - pod.length;
    // a tie for 2nd or 3rd: the champion stands alone on a shorter pillar and 2nd / 3rd are listed below with a medal
    const tieBelow = pod.filter((r) => r.rank === 2).length > 1 || pod.filter((r) => r.rank === 3).length > 1;
    const baseY = tieBelow ? (story ? 1180 : 740) : story ? 1380 : 930, PH = [0, (tieBelow ? (story ? 200 : 150) : 360) * s, 270 * s, 200 * s], firstRad = 110 * s;
    const spotY = baseY - PH[1] - 150 * s - firstRad;

    // ---- background ----
    let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0f3a32"); g.addColorStop(1, "#0a241f");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // faint pickleball court lines running through the whole canvas (kitchen lines, centre lines, net)
    {
      const cx0 = 40, cw0 = W - 80, ch0 = cw0 * 2.2, cy0 = H / 2 - ch0 / 2, net = cy0 + ch0 / 2, kit = (ch0 / 2) * (7 / 22);
      x.save(); x.strokeStyle = "rgba(215,255,63,.07)"; x.lineWidth = 6; x.lineJoin = "round";
      x.strokeRect(cx0, cy0, cw0, ch0); x.beginPath();
      x.moveTo(cx0, net - kit); x.lineTo(cx0 + cw0, net - kit); x.moveTo(cx0, net + kit); x.lineTo(cx0 + cw0, net + kit);
      x.moveTo(W / 2, cy0); x.lineTo(W / 2, net - kit); x.moveTo(W / 2, net + kit); x.lineTo(W / 2, cy0 + ch0); x.stroke();
      x.setLineDash([14, 12]); x.lineWidth = 8; x.strokeStyle = "rgba(255,255,255,.08)"; x.beginPath(); x.moveTo(0, net); x.lineTo(W, net); x.stroke(); x.restore();
    }
    g = x.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.95); g.addColorStop(0, "rgba(215,255,63,.26)"); g.addColorStop(1, "rgba(215,255,63,0)");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (pod.length) { // spotlight on the winner
      g = x.createRadialGradient(W / 2, spotY, 0, W / 2, spotY, 600 * s); g.addColorStop(0, "rgba(215,255,63,.22)"); g.addColorStop(1, "rgba(215,255,63,0)");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
    g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, "rgba(215,255,63,0)"); g.addColorStop(0.5, OPTIC); g.addColorStop(1, "rgba(215,255,63,0)");
    x.fillStyle = g; x.fillRect(0, 0, W, story ? 10 : 8);
    if (pod.length) {
      const cc = [OPTIC, "#ffffff", "#e0a458", "#cbd5e1"];
      for (let i = 0; i < 52; i++) {
        const cx = ((i * 137) % 100) / 100 * W, cy = 30 + ((i * 53) % 100) / 100 * (story ? 1000 : 560), sz = (10 + (i % 4) * 4) * (story ? 1 : 0.8);
        x.save(); x.translate(cx, cy); x.rotate((((i * 97) % 360) * Math.PI) / 180); x.globalAlpha = 0.5; x.fillStyle = cc[i % 4];
        x.fillRect(-sz / 2, -sz / 4, sz, sz / 2); x.restore();
      }
    }

    // ---- header ----
    const dateStr = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    const mins = Math.max(1, Math.round(snap.duration / 60000));
    const topY = story ? 240 : 66;
    {
      const px = story ? 26 : 22; x.font = `700 ${px}px ${BODY}`; spaced("6px");
      const pw = x.measureText("FINAL STANDINGS").width + (story ? 64 : 52); spaced("0px");
      const ph = story ? 56 : 46; rr(W / 2 - pw / 2, topY - ph + 18, pw, ph, ph / 2);
      x.fillStyle = "rgba(215,255,63,.1)"; x.fill(); x.strokeStyle = "rgba(215,255,63,.5)"; x.lineWidth = 2; x.stroke();
      text("FINAL STANDINGS", W / 2 + 3, topY, { px, wt: 700, c: OPTIC, a: "center", ls: "6px" });
    }
    text("Open Play", W / 2, topY + (story ? 130 : 94), { px: story ? 116 : 74, wt: 800, fam: DISPLAY, a: "center" });
    if (story) text(dateStr, W / 2, topY + 186, { px: 32, wt: 500, c: "rgba(255,255,255,.7)", a: "center" });
    else text(`${dateStr} · ${snap.players} ${snap.players === 1 ? "player" : "players"} · ${snap.log.length} ${snap.log.length === 1 ? "game" : "games"} · ${mins} min`, W / 2, topY + 136, { px: 25, wt: 500, c: "rgba(255,255,255,.7)", a: "center", max: W - 140 });

    // ---- podium: top 3 only ----
    if (pod.length) {
      const TONE = { 1: OPTIC, 2: "#cbd5e1", 3: "#e0a458" }, LABEL = { 1: "CHAMPION", 2: "RUNNER-UP", 3: "THIRD PLACE" };
      // one pillar per place; players who tie share it and are stacked vertically above it
      const tierOf = (k) => pod.filter((r) => r.rank === k), tiers = (tieBelow ? [1] : [2, 1, 3]).filter((k) => tierOf(k).length);
      const cw = F.cw, gap = F.gap, total = tiers.length * cw + (tiers.length - 1) * gap, startX = (W - total) / 2, hdrBottom = story ? 450 : 222;
      // glowing platform under the pillars
      g = x.createLinearGradient(startX - 40, 0, startX + total + 40, 0); g.addColorStop(0, "rgba(215,255,63,0)"); g.addColorStop(0.5, "rgba(215,255,63,.75)"); g.addColorStop(1, "rgba(215,255,63,0)");
      x.fillStyle = g; rr(startX - 40, baseY, total + 80, 14 * s, 7); x.fill();
      tiers.forEach((k, i) => {
        const grp = tierOf(k), tied = grp.length > 1, c = TONE[k], first = k === 1;
        const cx = startX + i * (cw + gap) + cw / 2, ph = PH[k], top = baseY - ph, kw = 84 * s, kh = 52 * s;
        const crown = (ky) => {
          const kx = cx - kw / 2;
          x.fillStyle = c; x.beginPath(); x.moveTo(kx, ky + kh); x.lineTo(kx, ky + kh * 0.25); x.lineTo(kx + kw * 0.25, ky + kh * 0.6); x.lineTo(cx, ky);
          x.lineTo(kx + kw * 0.75, ky + kh * 0.6); x.lineTo(kx + kw, ky + kh * 0.25); x.lineTo(kx + kw, ky + kh); x.closePath(); x.fill();
        };
        // pillar with gloss
        const pg = x.createLinearGradient(0, top, 0, baseY); pg.addColorStop(0, c); pg.addColorStop(1, c + "33");
        x.fillStyle = pg; rr(cx - cw / 2, top, cw, ph, [24 * s, 24 * s, 0, 0]); x.fill();
        x.save(); rr(cx - cw / 2, top, cw, ph, [24 * s, 24 * s, 0, 0]); x.clip();
        const sh = x.createLinearGradient(cx - cw / 2, 0, cx + cw / 2, 0); sh.addColorStop(0, "rgba(255,255,255,.28)"); sh.addColorStop(0.45, "rgba(255,255,255,0)");
        x.fillStyle = sh; x.fillRect(cx - cw / 2, top, cw, ph); x.fillStyle = "rgba(255,255,255,.45)"; x.fillRect(cx - cw / 2, top, cw, 8 * s); x.restore();
        text(String(k), cx, top + 94 * s, { px: 84 * s, wt: 800, fam: DISPLAY, c: "#0b2a24", a: "center" });
        text(tied ? (k === 1 ? "CO-CHAMPION" : "TIED " + (k === 2 ? "2ND" : "3RD")) : LABEL[k], cx, top + 138 * s, { px: 20 * s, wt: 800, c: "rgba(11,42,36,.75)", a: "center", ls: "3px", max: cw - 14 });
        if (!tied) {
          const r = grp[0], rad = (first ? 110 : 84) * s;
          text(`${r.wins} ${r.wins === 1 ? "win" : "wins"} · ${r.games} played`, cx, top - 28 * s, { px: 30 * s, wt: 600, c: "rgba(255,255,255,.8)", a: "center", max: cw + gap - 8 });
          text(r.name, cx, top - 76 * s, { px: (first ? 54 : 44) * s, wt: 800, fam: DISPLAY, a: "center", max: cw + gap - 8 });
          const ay = top - 150 * s - rad;
          x.save(); if (first) { x.shadowColor = "rgba(215,255,63,.6)"; x.shadowBlur = 60 * s; }
          x.beginPath(); x.arc(cx, ay, rad, 0, Math.PI * 2); x.fillStyle = c; x.fill(); x.restore();
          x.beginPath(); x.arc(cx, ay, rad - 11 * s, 0, Math.PI * 2); x.strokeStyle = "rgba(11,42,36,.18)"; x.lineWidth = 3; x.stroke();
          x.beginPath(); x.arc(cx, ay, rad + 11 * s, 0, Math.PI * 2); x.strokeStyle = c + "55"; x.lineWidth = 6 * s; x.stroke();
          text(ini(r.name), cx, ay + rad * 0.3, { px: rad * 0.86, wt: 800, fam: DISPLAY, c: "#0b2a24", a: "center" });
          if (first) {
            crown(ay - rad - 24 * s - kh);
            sparkle(cx - rad - 78 * s, ay - 34 * s, 20 * s, 0.9); sparkle(cx + rad + 70 * s, ay - 70 * s, 28 * s, 0.95);
            sparkle(cx + rad + 52 * s, ay + 58 * s, 14 * s, 0.8); sparkle(cx - rad - 54 * s, ay + 78 * s, 12 * s, 0.7);
          }
        } else {
          // tied: names stacked vertically, each on its own card, scaled to leave room under the header
          const gapR = 8 * s, availG = top - hdrBottom - 22 * s - (first ? kh + 24 * s : 0);
          const rowH = Math.max(34 * s, Math.min(84 * s, (availG + gapR) / grp.length - gapR));
          const rowsTop = top - 22 * s - (grp.length * rowH + (grp.length - 1) * gapR), nw = cw - rowH - 14 * s;
          grp.forEach((r, j) => {
            const ry = rowsTop + j * (rowH + gapR), mid = ry + rowH / 2, ar = rowH / 2 - 9 * s, ax = cx - cw / 2 + rowH / 2;
            x.fillStyle = c + "22"; rr(cx - cw / 2, ry, cw, rowH, rowH * 0.32); x.fill(); x.strokeStyle = c + "88"; x.lineWidth = 2; x.stroke();
            x.beginPath(); x.arc(ax, mid, ar, 0, Math.PI * 2); x.fillStyle = c; x.fill();
            text(ini(r.name), ax, mid + ar * 0.3, { px: ar * 0.9, wt: 800, fam: DISPLAY, c: "#0b2a24", a: "center" });
            text(r.name, cx - cw / 2 + rowH + 2 * s, mid - rowH * 0.02, { px: rowH * 0.38, wt: 800, fam: DISPLAY, a: "left", max: nw });
            text(`${r.wins} ${r.wins === 1 ? "win" : "wins"} · ${r.games} played`, cx - cw / 2 + rowH + 2 * s, mid + rowH * 0.3, { px: rowH * 0.24, wt: 600, c: "rgba(255,255,255,.78)", a: "left", max: nw });
          });
          if (first) crown(rowsTop - 20 * s - kh);
        }
      });
      if (tieBelow) {
        // 2nd and 3rd place: medal on the left, name beside it (two columns when there are many)
        const list = [...tierOf(2), ...tierOf(3)], n = list.length;
        const cols = story ? (n > 5 ? 2 : 1) : (n > 2 ? 2 : 1), rowsN = Math.ceil(n / cols);
        const areaTop = baseY + (story ? 56 : 36), areaBot = story ? 1640 : 946, gapR = 10 * s;
        const rowH = Math.max(30 * s, Math.min(story ? 96 : 76, (areaBot - areaTop + gapR) / rowsN - gapR));
        const rowW = cols === 1 ? (story ? 700 : 600) : (W - 120 - 20) / 2, gridW = cols * rowW + (cols - 1) * 20, gx = (W - gridW) / 2;
        const TONE2 = { 2: "#cbd5e1", 3: "#e0a458" };
        list.forEach((r, i) => {
          const col = cols === 1 ? 0 : Math.floor(i / rowsN), row = cols === 1 ? i : i % rowsN;
          const rx = gx + col * (rowW + 20), ry = areaTop + row * (rowH + gapR), mid = ry + rowH / 2, c = TONE2[r.rank];
          x.fillStyle = c + "22"; rr(rx, ry, rowW, rowH, rowH * 0.3); x.fill(); x.strokeStyle = c + "88"; x.lineWidth = 2; x.stroke();
          // medal: ribbon, disc, rank number
          const mr = rowH * 0.3, mx = rx + rowH * 0.62, my = mid + rowH * 0.06;
          x.fillStyle = c + "99"; x.beginPath(); x.moveTo(mx - mr * 0.8, my - mr * 0.2); x.lineTo(mx - mr * 0.1, my - mr * 0.2); x.lineTo(mx - mr * 0.45, my - mr * 1.55); x.lineTo(mx - mr * 1.15, my - mr * 1.55); x.closePath(); x.fill();
          x.beginPath(); x.moveTo(mx + mr * 0.8, my - mr * 0.2); x.lineTo(mx + mr * 0.1, my - mr * 0.2); x.lineTo(mx + mr * 0.45, my - mr * 1.55); x.lineTo(mx + mr * 1.15, my - mr * 1.55); x.closePath(); x.fill();
          x.beginPath(); x.arc(mx, my, mr, 0, Math.PI * 2); x.fillStyle = c; x.fill();
          x.beginPath(); x.arc(mx, my, mr - 4 * s, 0, Math.PI * 2); x.strokeStyle = "rgba(11,42,36,.25)"; x.lineWidth = 2; x.stroke();
          text(String(r.rank), mx, my + mr * 0.36, { px: mr * 1.1, wt: 800, fam: DISPLAY, c: "#0b2a24", a: "center" });
          const tx = rx + rowH * 1.3, tw = rowW - rowH * 1.3 - 16 * s;
          text(r.name, tx, mid - rowH * 0.02, { px: rowH * 0.36, wt: 800, fam: DISPLAY, a: "left", max: tw });
          text(`${r.wins} ${r.wins === 1 ? "win" : "wins"} · ${r.games} played`, tx, mid + rowH * 0.3, { px: rowH * 0.23, wt: 600, c: "rgba(255,255,255,.78)", a: "left", max: tw });
        });
        if (extra > 0) text(`+${extra} more tied`, W / 2, areaTop + rowsN * (rowH + gapR) + (story ? 22 : 14), { px: story ? 24 : 18, wt: 600, c: "rgba(255,255,255,.6)", a: "center" });
      } else if (extra > 0) text(`+${extra} more tied`, W / 2, baseY + (story ? 58 : 32), { px: story ? 24 : 20, wt: 600, c: "rgba(255,255,255,.6)", a: "center" });
    } else {
      text("No games had a winner", W / 2, story ? 700 : 460, { px: story ? 44 : 32, wt: 600, c: "rgba(255,255,255,.6)", a: "center" });
    }

    // ---- story extras: congratulations + session stats ----
    if (story && !tieBelow) {
      text("CONGRATULATIONS!", W / 2, baseY + 96, { px: 30, wt: 800, fam: DISPLAY, c: OPTIC, a: "center", ls: "8px" });
      const chips = [[snap.players, snap.players === 1 ? "PLAYER" : "PLAYERS"], [snap.log.length, snap.log.length === 1 ? "GAME" : "GAMES"], [mins, "MINUTES"]];
      const cwid = 296, cg = 20, cx0 = (W - (3 * cwid + 2 * cg)) / 2, cy = baseY + 128;
      chips.forEach(([v, l], i) => {
        const rx = cx0 + i * (cwid + cg);
        x.fillStyle = "rgba(255,255,255,.06)"; rr(rx, cy, cwid, 96, 24); x.fill(); x.strokeStyle = "rgba(215,255,63,.28)"; x.lineWidth = 2; x.stroke();
        text(String(v), rx + cwid / 2, cy + 56, { px: 46, wt: 800, fam: DISPLAY, a: "center" });
        text(l, rx + cwid / 2, cy + 84, { px: 18, wt: 700, c: "rgba(255,255,255,.55)", a: "center", ls: "4px" });
      });
    }

    // ---- footer: brand + developer credit ----
    {
      const fy = story ? 1682 : 988, bpx = story ? 30 : 24;
      x.font = `800 ${bpx}px ${DISPLAY}`; spaced("8px"); const tw = x.measureText("DINKHUB").width; spaced("0px");
      const dot = story ? 14 : 12, sx = (W - (dot + 16 + tw)) / 2;
      x.beginPath(); x.arc(sx + dot / 2, fy - bpx * 0.34, dot / 2, 0, Math.PI * 2); x.fillStyle = OPTIC; x.fill();
      text("DINKHUB", sx + dot + 16, fy, { px: bpx, wt: 800, fam: DISPLAY, c: OPTIC, a: "left", ls: "8px" });
      const cy2 = story ? 1734 : H - 38, px2 = story ? 26 : 21;
      x.fillStyle = "rgba(255,255,255,.14)"; x.fillRect(W / 2 - 70, cy2 - px2 - (story ? 18 : 14), 140, 2);
      x.font = `500 ${px2}px ${BODY}`; const w1 = x.measureText("Developed by ").width;
      x.font = `700 ${px2}px ${BODY}`; const w2 = x.measureText("EM Development Solutions").width, ox = (W - w1 - w2) / 2;
      text("Developed by ", ox, cy2, { px: px2, wt: 500, c: "rgba(255,255,255,.55)" });
      text("EM Development Solutions", ox + w1, cy2, { px: px2, wt: 700, c: "rgba(255,255,255,.92)" });
    }
    return cv;
  }
  function shareModal(snap, key) {
    key = key || "story";
    let token = 0, blob = null, url = null;
    const FILE = () => `dinkhub-open-play-${key}-${new Date().toISOString().slice(0, 10)}.png`;
    const canShare = !!(navigator.canShare && navigator.share && (() => { try { return navigator.canShare({ files: [new File([""], "a.png", { type: "image/png" })] }); } catch (e) { return false; } })());
    openModal(`
      <div class="relative grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem] md:gap-6">
        <div class="relative flex h-[min(38dvh,24rem)] items-center justify-center overflow-hidden rounded-2xl bg-court-700 p-3 md:order-1 md:h-[min(72dvh,44rem)]">
          <img id="shImg" alt="Preview of the results image" class="max-h-full max-w-full rounded-xl object-contain" style="opacity:0;transform:scale(.94);transition:opacity .3s ease,transform .3s ease" />
          <span id="shBusy" class="absolute text-sm text-white/50" style="transition:opacity .25s ease">Making your image…</span>
        </div>
        <div class="flex flex-col md:order-2 md:justify-center">
          <div class="text-xs font-bold uppercase tracking-[.22em] text-optic">Share the results</div>
          <h3 class="mt-0.5 font-display text-2xl font-extrabold">Save as image</h3>
          <p class="mt-1 hidden text-sm text-white/55 md:block">Top 3 players, ready to post.</p>
          <div id="shTabs" class="mt-4 grid grid-cols-2 gap-2 md:grid-cols-1">${Object.entries(SHARE).map(([k, f]) =>
            `<button type="button" data-k="${k}" class="rounded-xl px-3 py-2.5 text-left transition-colors duration-300"><span class="block font-display font-bold">${f.name} <span class="num font-normal opacity-70">${f.ratio}</span></span><span class="block text-xs opacity-70">${f.note}</span></button>`).join("")}</div>
          <div class="mt-4 grid grid-cols-2 gap-2 md:grid-cols-1">
            <button id="shSave" type="button" disabled class="rounded-xl bg-optic px-3 py-2.5 font-bold text-court-900 hover:bg-optic-dark disabled:opacity-50 md:order-1"><i class="fa-solid fa-download mr-2"></i>Download PNG</button>
            ${canShare ? `<button id="shShare" type="button" disabled class="col-span-2 rounded-xl border border-optic/50 bg-optic/10 px-3 py-2.5 text-sm font-semibold text-optic hover:bg-optic/20 disabled:opacity-50 md:order-2 md:col-span-1"><i class="fa-solid fa-share-nodes mr-2"></i>Share to Instagram, Facebook…</button>` : ""}
            <button id="shBack" type="button" class="rounded-xl border border-white/15 px-3 py-2.5 text-sm font-semibold hover:bg-white/10 md:order-3"><i class="fa-solid fa-arrow-left mr-2"></i>Back</button>
          </div>
        </div>
      </div>`, true, "58rem");
    $("#modalBody").style.overflowY = "hidden"; // everything fits on screen, so no scrolling
    const img = $("#shImg"), busy = $("#shBusy");
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = () => document.querySelectorAll("#shTabs button").forEach((b) => {
      const on = b.dataset.k === key; b.setAttribute("aria-pressed", String(on));
      b.className = "rounded-xl px-3 py-2.5 text-left transition-colors duration-300 " + (on ? "bg-optic text-court-900" : "bg-white/5 text-white hover:bg-white/10");
    });
    const setReady = (v) => { $("#shSave").disabled = !v; const sh = $("#shShare"); if (sh) sh.disabled = !v; };
    const stale = (my) => my !== token || !document.body.contains(img);
    // switching size: fade the current image out, build the new one, then fade it in
    const make = async () => {
      const my = ++token; paint(); setReady(false);
      const first = !img.getAttribute("src");
      img.style.opacity = "0"; img.style.transform = "scale(.94)";
      busy.style.opacity = first ? "1" : "0";
      if (!reduce && !first) await new Promise((r) => setTimeout(r, 300));
      if (stale(my)) return;
      const cv = await drawShare(snap, key);
      const b = await new Promise((res) => cv.toBlob(res, "image/png"));
      if (stale(my) || !b) return;
      if (url) URL.revokeObjectURL(url);
      blob = b; url = URL.createObjectURL(b); img.src = url;
      try { await img.decode(); } catch (e) {}
      if (stale(my)) return;
      busy.style.opacity = "0"; img.style.opacity = "1"; img.style.transform = "scale(1)"; setReady(true);
    };
    document.querySelectorAll("#shTabs button").forEach((b) => (b.onclick = () => { if (b.dataset.k !== key) { key = b.dataset.k; make(); } }));
    $("#shBack").onclick = () => { token++; if (url) URL.revokeObjectURL(url); resultsModal(snap); };
    $("#shSave").onclick = () => {
      if (!blob) return;
      const a = document.createElement("a"); a.href = url; a.download = FILE(); document.body.appendChild(a); a.click(); a.remove(); toast("Image saved");
    };
    const sh = $("#shShare");
    if (sh) sh.onclick = async () => { if (!blob) return; try { await navigator.share({ files: [new File([blob], FILE(), { type: "image/png" })], title: "Open play results" }); } catch (e) {} };
    make();
  }
  function finishModal() {
    const all = Object.values(state.players);
    if (!all.length && !state.log.length) { toast("Nothing to finish yet"); return; }
    const live = state.courts.filter((c) => c.players).length;
    const started = all.length ? Math.min(...all.map((p) => p.joinedAt)) : Date.now();
    const lead = buildRanking(all)[0];
    const stat = (label, v) => `<div><div class="num font-display text-3xl font-extrabold leading-none">${v}</div><div class="mt-1 text-sm text-white/55">${label}</div></div>`;
    openModal(`
      <h3 class="font-display text-2xl font-bold">Complete open play?</h3>
      <p class="mt-1 text-sm text-white/60">You'll see the final ranking, then all players, courts and finished games are cleared.</p>
      <div class="mt-5 grid grid-cols-3 gap-3">${stat("Players", all.length)}${stat("Games", state.log.length)}${stat("Duration", fmt(Date.now() - started))}</div>
      ${lead ? `<p class="mt-4 text-sm text-white/70">Leading now: ${esc(lead.name)} with ${lead.wins} ${lead.wins === 1 ? "win" : "wins"}.</p>` : ""}
      ${live ? `<p class="mt-3 rounded-lg bg-optic/10 px-3 py-2 text-sm text-optic">${live} ${live === 1 ? "game is" : "games are"} still in play and will end without a result.</p>` : ""}
      <div class="mt-5 flex gap-2">
        <button id="mKeep" class="flex-1 rounded-xl bg-white/5 px-3 py-2.5 text-sm hover:bg-white/10">Keep playing</button>
        <button id="mFinish" class="flex-1 rounded-xl bg-optic px-3 py-2.5 font-bold text-court-900 hover:bg-optic-dark">Complete and rank</button>
      </div>`);
    $("#mKeep").onclick = closeModal;
    $("#mFinish").onclick = () => {
      const snap = { ranking: buildRanking(all), log: state.log.slice(), players: all.length, duration: Date.now() - started };
      state.players = {}; state.queue = []; state.log = [];
      state.courts.forEach((c) => { c.players = null; c.startedAt = null; });
      state.setupDone = false; save(); render(); resultsModal(snap);
    };
  }

  // ---- Render ----
  const SLOTS = [[19, 28], [19, 72], [81, 28], [81, 72]]; // % positions: team A left, team B right
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

  function queueRow(id, i) {
    const p = P(id);
    return `<li data-pid="${id}" data-zone="queue" class="flex items-center gap-2 py-2 sm:gap-3">
      <span class="num w-5 shrink-0 text-center text-sm font-semibold text-white/45">${i + 1}</span>
      <div class="min-w-0 flex-1"><div class="truncate font-semibold">${esc(p.name)}</div>
        <div class="num truncate whitespace-nowrap text-[9px] leading-tight text-white/50 min-[400px]:text-[10px] sm:text-xs">${p.wins || 0} ${(p.wins || 0) === 1 ? "win" : "wins"}, ${p.games} played, waiting <span data-since="${p.queuedAt}">${fmt(Date.now() - p.queuedAt)}</span></div></div>
      <div class="flex shrink-0 items-center gap-1.5">
        <button data-a="break" data-id="${id}" title="Take a break" aria-label="Send ${esc(p.name)} on break" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-white/70 transition-colors hover:border-white/40 hover:bg-white/10 hover:text-white [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"><i class="fa-solid fa-mug-hot"></i></button>
        <button data-a="del" data-id="${id}" title="Remove player" aria-label="Remove ${esc(p.name)}" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-white/60 transition-colors hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-300 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"><i class="fa-solid fa-xmark"></i></button>
      </div></li>`;
  }

  function renderNow() {
    const all = Object.values(state.players);
    const playing = all.filter((p) => p.status === "playing").length;
    const brk = all.filter((p) => p.status === "break");
    const free = state.courts.filter((c) => !c.players).length;

    const stat = (label, val) => `<div class="flex items-baseline gap-2 px-4 py-3 sm:gap-2.5 sm:px-5 sm:py-4"><dd class="num font-display text-2xl font-extrabold leading-none sm:text-3xl">${val}</dd><dt class="text-sm text-white/60">${label}</dt></div>`;
    $("#stats").innerHTML = stat("Players", all.length) + stat("Waiting", state.queue.length) + stat("On court", playing) + stat("Free courts", free);

    // auto-fill switch
    const af = state.autoFill, fb = $("#btnFillAll");
    fb.setAttribute("aria-checked", String(af));
    fb.className = "flex h-12 w-full shrink-0 items-center justify-between gap-3 rounded-xl border px-4 text-sm font-bold transition-colors sm:w-auto sm:justify-self-end " + (af ? "border-optic bg-optic/10 text-optic" : "border-white/15 text-white/70 hover:border-white/30 hover:text-white");
    $("#afTrack").className = "relative h-5 w-9 shrink-0 rounded-full transition-colors " + (af ? "bg-optic" : "bg-white/20");
    $("#afKnob").className = "absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-transform " + (af ? "bg-court-900" : "bg-white");
    $("#afKnob").style.transform = af ? "translateX(16px)" : "";

    // mode switch
    document.querySelectorAll('[data-a="mode"]').forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.v === "stay") === state.winnersStay)));
    $(".seg").dataset.mode = state.winnersStay ? "stay" : "rotate";

    // partner switch
    document.querySelectorAll('[data-a="partner"]').forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.v === "fixed") === state.fixedPartner)));
    $("#segPartner").dataset.mode = state.fixedPartner ? "fixed" : "rotating";

    // queue
    const q = state.queue, nextN = Math.min(4, q.length);
    $("#queueCount").textContent = q.length ? `${q.length} waiting` : "";
    if (!q.length) {
      $("#queueBody").innerHTML = `<p class="rounded-xl border border-dashed border-white/20 p-5 text-center text-sm text-white/55">Nobody is waiting. Add names above to start the queue.</p>`;
    } else {
      const nm = (k) => esc(P(q[k]).name);
      const matchup = q.length >= 4 ? `${nm(0)} &amp; ${nm(1)} vs ${nm(2)} &amp; ${nm(3)}` : `Need ${4 - q.length} more ${4 - q.length === 1 ? "player" : "players"} to start`;
      $("#queueBody").innerHTML = `
        <div class="rounded-xl border-l-4 border-optic bg-optic/10 px-3 pb-1 pt-3">
          <div class="text-sm font-bold text-optic">Next game</div>
          <div class="mt-0.5 text-sm text-white/70">${matchup}</div>
          <ul class="mt-1 divide-y divide-white/10">${q.slice(0, nextN).map((id, i) => queueRow(id, i)).join("")}</ul>
        </div>
        ${q.length > 4 ? `<ul class="mt-2 divide-y divide-white/10 px-3">${q.slice(4).map((id, i) => queueRow(id, i + 4)).join("")}</ul>` : ""}`;
    }

    // break
    $("#breakWrap").classList.toggle("hidden", !brk.length);
    $("#breakList").innerHTML = brk.map((p) => `<li data-pid="${p.id}" data-zone="break" class="flex items-center justify-between gap-2 py-2">
      <span class="min-w-0 truncate">${esc(p.name)}</span>
      <span class="flex shrink-0 items-center gap-1.5"><button data-a="back" data-id="${p.id}" class="inline-flex h-8 items-center rounded-lg border border-optic/50 px-3 text-xs font-bold text-optic transition-colors hover:bg-optic hover:text-court-900 [@media(pointer:coarse)]:h-10">Rejoin</button>
      <button data-a="del" data-id="${p.id}" title="Remove player" aria-label="Remove ${esc(p.name)}" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-white/60 transition-colors hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-300 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"><i class="fa-solid fa-xmark"></i></button></span></li>`).join("");

    // courts
    $("#courts").innerHTML = state.courts.map((c) => {
      const slots = SLOTS.map(([x, y], k) => {
        const id = c.players && c.players[k];
        const pos = `left:${x}%;top:${y}%`;
        return id
          ? `<div class="slot filled" data-pid="${id}" data-zone="court:${c.id}" style="${pos}"><span>${esc(P(id).name)}</span><button data-a="sub" data-c="${c.id}" data-id="${id}" title="Swap with a waiting player" aria-label="Swap ${esc(P(id).name)} out"><i class="fa-solid fa-arrow-right-arrow-left"></i></button></div>`
          : `<div class="slot open" style="${pos}">Open</div>`;
      }).join("");
      const head = c.players
        ? `<span class="flex items-center gap-2 text-sm text-white/70"><span class="live h-2.5 w-2.5 rounded-full bg-optic"></span>In play <span class="num font-display text-2xl font-bold text-white" data-start="${c.startedAt}">${fmt(Date.now() - c.startedAt)}</span></span>`
        : `<span class="text-sm text-white/55">${state.queue.length >= 4 ? "Ready for the next game" : `Waiting for ${4 - state.queue.length} more ${4 - state.queue.length === 1 ? "player" : "players"}`}</span>`;
      const btn = c.players
        ? `<button data-a="end" data-c="${c.id}" class="w-full rounded-xl bg-optic px-4 py-3 font-bold text-court-900 hover:bg-optic-dark"><i class="fa-solid fa-flag-checkered mr-2"></i>End game</button>`
        : `<div class="flex gap-2"><button data-a="fill" data-c="${c.id}" ${state.queue.length < 4 ? "disabled" : ""} class="flex-1 rounded-xl bg-optic px-3 py-3 text-sm font-bold text-court-900 hover:bg-optic-dark disabled:cursor-not-allowed disabled:opacity-35"><i class="fa-solid fa-play mr-2 max-[420px]:hidden"></i>Start next game</button><button data-a="pick" data-c="${c.id}" ${state.queue.length < 4 ? "disabled" : ""} class="flex-1 rounded-xl border border-optic/50 px-3 py-3 text-sm font-bold text-optic hover:bg-optic hover:text-court-900 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-optic"><i class="fa-solid fa-user-check mr-2 max-[420px]:hidden"></i>Choose players</button></div>`;
      return `<article class="overflow-hidden rounded-2xl bg-court-800">
        <div class="flex items-center justify-between gap-3 px-4 pb-3 pt-4"><h3 class="font-display text-xl font-bold">${esc(c.name)}</h3>${head}</div>
        <div class="court">${COURT_SVG}${slots}</div>
        <div class="p-3">${btn}</div></article>`;
    }).join("");

    // log
    $("#log").innerHTML = state.log.length ? state.log.map((g) => {
      const side = (names, w) => `<span class="${g.winner === w ? "font-bold text-optic" : "text-white/80"}">${g.winner === w ? '<i class="fa-solid fa-trophy mr-1 text-xs"></i>' : ""}${names.map(esc).join(" &amp; ")}</span>`;
      return `<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
        <span>${side(g.a, "A")} <span class="mx-1 text-white/40">vs</span> ${side(g.b, "B")}</span>
        <span class="num text-xs text-white/50">${esc(g.court)}, ${new Date(g.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></li>`;
    }).join("") : `<li class="py-4 text-white/50">Finished games appear here.</li>`;

    // leaderboard
    const rk = buildRanking(all);
    $("#lbCount").textContent = rk.length ? `${rk.length} ranked` : "";
    const badge = (r) => r.wins === 0 ? "bg-white/10" : r.rank === 1 ? "bg-optic text-court-900" : r.rank === 2 ? "bg-white/30" : r.rank === 3 ? "bg-amber-400/30 text-amber-200" : "bg-white/10";
    const lbRow = (r) => {
      const top = r.rank === 1 && r.wins > 0, pct = Math.round((r.wins / r.games) * 100);
      return `<li class="rounded-xl px-3 py-2.5 ${top ? "bg-optic text-court-900" : "bg-court-700"}">
        <div class="flex items-center gap-2.5">
          <span class="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold ${top ? "bg-court-900 text-optic" : badge(r)}">${r.rank}</span>
          <span class="min-w-0 flex-1 truncate font-semibold">${esc(r.name)}${r.status === "playing" ? ` <span class="live ml-1 inline-block h-2 w-2 rounded-full align-middle ${top ? "bg-court-900" : "bg-optic"}" title="On court now"></span>` : ""}</span>
          <span class="num shrink-0 text-right text-xs leading-tight"><b class="text-sm">${r.wins} ${r.wins === 1 ? "win" : "wins"}</b><br><span class="${top ? "text-court-900/70" : "text-white/55"}">${r.games} played</span></span>
        </div>
        <div class="mt-2 h-1 overflow-hidden rounded-full ${top ? "bg-court-900/20" : "bg-white/10"}" title="${pct}% win rate"><div class="h-full rounded-full ${top ? "bg-court-900" : "bg-optic"}" style="width:${pct}%"></div></div></li>`;
    };
    $("#lbBody").innerHTML = rk.length
      ? `<ol class="grid gap-2 sm:grid-cols-2">${rk.map(lbRow).join("")}</ol>`
      : `<p class="rounded-xl border border-dashed border-white/20 p-5 text-center text-sm text-white/55">Rankings appear here after the first finished game.</p>`;

  }

  // ---- Queue animations: gentle fade in / fade out only ----
  const ANIM_SEL = "#queueBody [data-pid], #breakList [data-pid], #courts [data-pid]";
  const FADE_IN = 380, FADE_OUT = 240;
  let animReady = false; // no animation on the very first paint
  const motionOff = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function snapshotPositions() {
    const m = new Map();
    document.querySelectorAll(ANIM_SEL).forEach((el) => {
      const r = el.getBoundingClientRect();
      m.set(el.dataset.pid, { zone: el.dataset.zone, x: r.left, y: r.top, w: r.width, h: r.height, node: el.cloneNode(true) });
    });
    return m;
  }
  // a faded copy of the old element stays where it was and fades out
  function fadeOutGhost(prev) {
    const g = prev.node;
    g.removeAttribute("id");
    Object.assign(g.style, { position: "fixed", left: prev.x + "px", top: prev.y + "px", width: prev.w + "px", height: prev.h + "px", margin: "0", transform: "none", pointerEvents: "none", zIndex: "90" });
    document.body.appendChild(g);
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT, easing: "ease-out", fill: "forwards" }).onfinish = () => g.remove();
  }
  function animateChanges(before) {
    if (motionOff()) return;
    const seen = new Set();
    let n = 0;
    document.querySelectorAll(ANIM_SEL).forEach((el) => {
      const id = el.dataset.pid, prev = before.get(id);
      seen.add(id);
      if (prev && prev.zone === el.dataset.zone) return; // stayed put: nothing to animate
      if (prev) fadeOutGhost(prev);                       // moved elsewhere (queue <-> court <-> break)
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN, delay: Math.min(n++, 6) * 40, easing: "ease-out", fill: "backwards" });
    });
    before.forEach((prev, id) => { if (!seen.has(id)) fadeOutGhost(prev); }); // removed players
  }
  function render() {
    const before = animReady && !motionOff() ? snapshotPositions() : null;
    renderNow();
    if (before) animateChanges(before);
  }

  // ---- Guided tour ----
  const TOUR_KEY = "dinkhub_openplay_tour_v1";
  const TOUR = [
    { title: "Welcome to Open Play", body: "This quick tour shows how to run an open play session: add players, fill courts, rotate games and rank everyone at the end. It takes about a minute." },
    { sel: "#stats", title: "Session at a glance", body: "Live counts of everyone checked in, players waiting in the queue, players on court, and courts that are free right now." },
    { sel: "#addForm", title: "Add players", body: "Type one name or several separated by commas, then press Add. You can also paste a list with one name per line. New players join the back of the queue, and duplicate names are skipped." },
    { sel: ".seg", title: "Rotate all or Winners stay", body: "Rotate all sends all four players to the back of the queue after each game: the winners go in first, then the losers right behind them. Winners stay keeps the winners on court, splits them up, and pairs each with one of the next two in line, while the losers go to the back. In both modes, players are not paired with a recent teammate when another split is possible." },
    { sel: "#segPartner", title: "Rotating or fixed partner", body: "Rotating partner mixes teams so players are not paired with a recent teammate when another split is possible. Fixed partner keeps pairs together: the queue is read in twos (1 and 2 play 3 and 4), and winners and losers move around as the same pairs." },
    { sel: "#btnFillAll", title: "Auto-fill courts", body: "Switch this on and empty courts fill themselves from the queue, including right after a game ends. Leave it off and nothing is added automatically: you start each game yourself with Start next game or Choose players." },
    { sel: "#courts article", title: "Courts", body: "Each court shows who is playing on the left and right side, plus a running game timer. On an empty court, Start next game takes the next four in line, while Choose players lets you pick exactly who plays and which side. Tap the swap arrow beside a name to choose who replaces them. Tap End game when the match is over and pick the winning side." },
    { sel: "#sec-queue > div", title: "The queue", body: "Players are called in order. The highlighted Next game block shows the next four and who plays whom. Use the cup to send someone on break (they appear under On break with a Rejoin button), or the X to remove them." },
    { sel: "#sec-log", title: "Finished games", body: "Every completed game is listed here with the winners marked by a trophy. Use Clear if you want to wipe the list without ending the session." },
    { sel: "#sec-leaderboard > div", title: "Leaderboard", body: "A live ranking of everyone who has played, updated after every game. Players are ordered by wins, and on equal wins the one with fewer games played ranks higher. A glowing dot means the player is on court right now, and the thin bar shows win rate." },
    { sel: '[data-a="finish"]', title: "Complete Open Play", body: "When the session is over, this shows the final ranking by wins (fewer games played breaks ties) and lets you save the results as a CSV or as an image for Instagram and Facebook (Story 9:16 or Post 1:1). Then the players, courts and history are cleared for the next session." },
    { sel: "#btnSettings", title: "Settings", body: "Change the number of courts any time, or reset the whole session. Only empty courts can be removed." },
    { title: "You're ready", body: "Add your first players to get started. You can reopen this tour any time with the Tour button at the top." },
  ];
  let tourI = -1, tour = null;
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function autoTour() {
    try { if (localStorage.getItem(TOUR_KEY)) return; } catch (e) { return; }
    setTimeout(startTour, 350);
  }
  function startTour() {
    if (tour || !$("#modal").classList.contains("hidden")) return;
    const root = document.createElement("div");
    root.id = "tour";
    root.innerHTML = `<div class="tour-block"></div>
      <svg class="tour-dim" aria-hidden="true"><path fill-rule="evenodd"></path></svg>
      <div class="tour-ring"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
        <div class="tour-bar" aria-hidden="true"><i></i></div><div class="tour-inner"></div>
      </div>`;
    document.body.appendChild(root);
    tour = { root, path: root.querySelector("path"), ring: root.querySelector(".tour-ring"), card: root.querySelector(".tour-card"),
      inner: root.querySelector(".tour-inner"), bar: root.querySelector(".tour-bar i"), cur: null, cc: null, last: performance.now(), raf: 0, dx: 0 };
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      if (b.dataset.t === "next") tourGo(1); else if (b.dataset.t === "back") tourGo(-1); else endTour();
    });
    document.addEventListener("keydown", tourKey, true);
    tourI = 0; tourShow();
    tour.raf = requestAnimationFrame(tourFrame);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("on")));
  }
  function endTour() {
    if (!tour) return;
    try { localStorage.setItem(TOUR_KEY, "1"); } catch (e) {}
    const t = tour; tour = null; tourI = -1;
    cancelAnimationFrame(t.raf);
    document.removeEventListener("keydown", tourKey, true);
    t.root.classList.remove("on");
    setTimeout(() => t.root.remove(), 360);
    window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
    const b = $("#btnTour"); if (b) b.focus({ preventScroll: true });
  }
  function tourGo(d) {
    const n = tourI + d;
    if (n >= TOUR.length) return endTour();
    if (n < 0) return;
    tour.dx = d * 14; tourI = n; tourShow();
  }
  function tourKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endTour(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); tourGo(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); tourGo(-1); }
  }
  function tourShow() {
    const s = TOUR[tourI], last = tourI === TOUR.length - 1, inner = tour.inner;
    inner.innerHTML = `
      <div class="flex items-center justify-between text-xs text-white/55"><span class="num">${tourI + 1} of ${TOUR.length}</span>${last ? "" : '<button data-t="skip" class="transition-colors hover:text-white">Skip tour</button>'}</div>
      <h3 id="tourTitle" class="mt-2 font-display text-xl font-bold">${esc(s.title)}</h3>
      <p class="mt-1.5 text-sm leading-relaxed text-white/75">${esc(s.body)}</p>
      <div class="mt-4 flex gap-2">
        ${tourI > 0 ? '<button data-t="back" class="flex-1 rounded-xl bg-white/5 px-3 py-2.5 text-sm font-semibold transition hover:bg-white/10 active:scale-[.97]">Back</button>' : ""}
        <button data-t="next" class="flex-1 rounded-xl bg-optic px-3 py-2.5 text-sm font-bold text-court-900 transition hover:bg-optic-dark active:scale-[.97]">${last ? "Get started" : tourI === 0 ? "Start tour" : "Next"}</button>
      </div>`;
    inner.style.setProperty("--dx", tour.dx + "px");
    inner.classList.remove("swap"); void inner.offsetWidth; inner.classList.add("swap");
    tour.bar.style.transform = `scaleX(${(tourI + 1) / TOUR.length})`;
    const el = s.sel && document.querySelector(s.sel);
    if (el) el.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    inner.querySelector('[data-t="next"]').focus({ preventScroll: true });
  }
  function roundedHole(x, y, w, h) {
    const r = Math.min(14, w / 2, h / 2);
    return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  }
  function placeCard(t, cw, ch, vw, vh) {
    const m = 12, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    if (!t.o) return { x: (vw - cw) / 2, y: (vh - ch) / 2 };
    const top = t.y, bottom = t.y + t.h, left = t.x, right = t.x + t.w;
    if (vw < 640) return { x: (vw - cw) / 2, y: (top + bottom) / 2 < vh / 2 ? vh - ch - m : m };
    if (vh - bottom >= ch + m * 2) return { x: clamp(left, m, vw - cw - m), y: bottom + m };
    if (top >= ch + m * 2) return { x: clamp(left, m, vw - cw - m), y: top - ch - m };
    if (vw - right >= cw + m * 2) return { x: right + m, y: clamp(top, m, vh - ch - m) };
    if (left >= cw + m * 2) return { x: left - cw - m, y: clamp(top, m, vh - ch - m) };
    return { x: (vw - cw) / 2, y: vh - ch - m };
  }
  // One rAF loop: reads first, writes second, and eases toward the target every frame (also follows smooth scrolling).
  function tourFrame(now) {
    const T = tour; if (!T) return;
    T.raf = requestAnimationFrame(tourFrame);
    const dt = Math.min(0.05, (now - T.last) / 1000); T.last = now;
    const vw = innerWidth, vh = innerHeight, s = TOUR[tourI], el = s.sel && document.querySelector(s.sel);
    let tg;
    if (el) {
      const r = el.getBoundingClientRect(), pad = 6;
      const x0 = Math.max(r.left - pad, 4), y0 = Math.max(r.top - pad, 4), x1 = Math.min(r.right + pad, vw - 4), y1 = Math.min(r.bottom + pad, vh - 4);
      tg = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), o: 1 };
    } else tg = { x: vw / 2, y: vh / 2, w: 0, h: 0, o: 0 };
    const cw = T.card.offsetWidth, ch = T.card.offsetHeight, cp = placeCard(tg, cw, ch, vw, vh);
    if (!T.cur) { T.cur = { ...tg }; T.cc = { ...cp }; }
    const rm = reduceMotion(), k = rm ? 1 : 1 - Math.exp(-dt * 14), k2 = rm ? 1 : 1 - Math.exp(-dt * 10);
    const c = T.cur, cc = T.cc;
    for (const key of ["x", "y", "w", "h", "o"]) c[key] += (tg[key] - c[key]) * k;
    cc.x += (cp.x - cc.x) * k2; cc.y += (cp.y - cc.y) * k2;
    T.path.setAttribute("d", `M0 0H${vw}V${vh}H0Z` + (c.w > 1 && c.h > 1 ? roundedHole(c.x, c.y, c.w, c.h) : ""));
    T.ring.style.width = c.w + "px"; T.ring.style.height = c.h + "px";
    T.ring.style.transform = `translate3d(${c.x}px,${c.y}px,0)`; T.ring.style.opacity = Math.max(0, Math.min(1, c.o));
    T.card.style.transform = `translate3d(${cc.x}px,${cc.y}px,0)`;
  }

  // ---- Events ----
  $("#addForm").addEventListener("submit", (e) => { e.preventDefault(); addPlayers($("#names").value); $("#names").value = ""; });
  $("#names").addEventListener("paste", (e) => {
    const t = (e.clipboardData || window.clipboardData).getData("text");
    if (/\n/.test(t)) { e.preventDefault(); const el = e.target; el.setRangeText(t.trim().replace(/\s*\n\s*/g, ", "), el.selectionStart, el.selectionEnd, "end"); }
  });
  $("#btnFillAll").onclick = toggleAuto;

  // ---- Light / dark theme: the new theme spreads across the page from the toggle button ----
  const THEME_KEY = "dinkhub_theme";
  const currentTheme = () => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  function paintTheme(th) {
    document.documentElement.setAttribute("data-theme", th);
    const light = th === "light", b = $("#btnTheme");
    if (b) { b.setAttribute("aria-pressed", String(light)); const l = light ? "Switch to dark mode" : "Switch to light mode"; b.setAttribute("aria-label", l); b.title = l; }
    const m = $("#metaTheme"); if (m) m.setAttribute("content", light ? "#f3f7ee" : "#0b2a24");
    try { localStorage.setItem(THEME_KEY, th); } catch (e) {}
  }
  function toggleTheme() {
    const next = currentTheme() === "light" ? "dark" : "light", root = document.documentElement, btn = $("#btnTheme");
    const r = btn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { paintTheme(next); return; }
    root.classList.add("theme-switching");
    const done = () => root.classList.remove("theme-switching");
    const grow = (el, pseudo) => el.animate({ clipPath: [`circle(0px at ${cx}px ${cy}px)`, `circle(${radius}px at ${cx}px ${cy}px)`] }, { duration: 750, easing: "cubic-bezier(.4,0,.2,1)", pseudoElement: pseudo });
    if (document.startViewTransition) {
      const vt = document.startViewTransition(() => paintTheme(next));
      vt.ready.then(() => grow(root, "::view-transition-new(root)")).catch(() => {});
      vt.finished.then(done, done);
    } else {
      // browsers without View Transitions: a circle of the new colour spreads out, then the theme is applied
      const cover = document.createElement("div");
      cover.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:${next === "light" ? "#f3f7ee" : "#0b2a24"}`;
      document.body.appendChild(cover);
      grow(cover).finished.then(() => { paintTheme(next); cover.remove(); done(); }, () => { paintTheme(next); cover.remove(); done(); });
    }
  }
  paintTheme(currentTheme());
  $("#btnTheme").onclick = toggleTheme;
  $("#btnSettings").onclick = settingsModal;
  $("#btnTour").onclick = startTour;
  $("#btnClearLog").onclick = () => { state.log = []; save(); render(); };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a, id = b.dataset.id, c = state.courts.find((x) => x.id === b.dataset.c);
    if (a === "mode") { state.winnersStay = b.dataset.v === "stay"; save(); render(); toast(state.winnersStay ? "Winners stay on court" : "Everyone rotates"); }
    else if (a === "partner") { state.fixedPartner = b.dataset.v === "fixed"; save(); render(); toast(state.fixedPartner ? "Fixed partners" : "Rotating partners"); }
    else if (a === "finish") finishModal();
    else if (a === "break") confirmBreak(id);
    else if (a === "back") confirmRejoin(id);
    else if (a === "del") confirmRemove(id);
    else if (a === "fill") { fillCourt(c); save(); render(); }
    else if (a === "end") endGameModal(c);
    else if (a === "sub") swapPicker(c, id);
    else if (a === "pick") pickModal(c);
  });

  // live timers without a full re-render
  const tick = () => {
    document.querySelectorAll("[data-start]").forEach((el) => (el.textContent = fmt(Date.now() - +el.dataset.start)));
    document.querySelectorAll("[data-since]").forEach((el) => (el.textContent = fmt(Date.now() - +el.dataset.since)));
    $("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  setInterval(tick, 1000); tick();

  load();
  if (!state.setupDone && (Object.keys(state.players).length || state.log.length)) state.setupDone = true; // sessions saved before this step
  render(); animReady = true; courtsSetupModal();
  if (state.setupDone) autoTour();
})();