/* DinkHub PWA helpers (shared by every page).
   - Only the referee page is installable (it alone links the manifest and registers sw.js).
   - Admin and operator accounts must use a normal web browser. If the site was installed and is
     opened as an app, they get a blocking pop-up instead of the dashboard. */
(function () {
  var scriptSrc = (document.currentScript && document.currentScript.src) || location.href;
  var ROOT = new URL("./", scriptSrc).href;          // folder that holds pwa.js / index.html
  var LOGIN_URL = ROOT + "index.html";

  // True when the page is running inside an installed app window (not a browser tab).
  function isInstalled() {
    try {
      return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: window-controls-overlay)").matches ||
        window.matchMedia("(display-mode: minimal-ui)").matches ||
        window.navigator.standalone === true ||
        String(document.referrer).indexOf("android-app://") === 0
      );
    } catch (_) { return false; }
  }

  var shown = false;
  function browserOnlyModal(role) {
    if (shown) return;
    shown = true;
    var label = role === "operator" ? "Operator" : role === "admin" ? "Admin" : "Admin and operator";
    var css = document.createElement("style");
    css.textContent =
      "#dhBrowserOnly{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,20,17,.92);backdrop-filter:blur(6px);font-family:'DM Sans',system-ui,sans-serif;color:#fff}" +
      "#dhBrowserOnly .card{width:100%;max-width:420px;border:1px solid rgba(215,255,63,.25);border-radius:24px;background:#0f3a32;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.5);animation:dhPop .35s ease-out}" +
      "#dhBrowserOnly .ic{display:grid;place-items:center;width:52px;height:52px;border-radius:999px;background:rgba(215,255,63,.12);color:#d7ff3f;font-size:24px}" +
      "#dhBrowserOnly h2{margin:16px 0 0;font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:24px;font-weight:800;letter-spacing:-.01em}" +
      "#dhBrowserOnly p{margin:10px 0 0;font-size:14px;line-height:1.55;color:rgba(255,255,255,.72)}" +
      "#dhBrowserOnly .row{display:flex;flex-direction:column;gap:10px;margin-top:20px}" +
      "#dhBrowserOnly button{width:100%;white-space:nowrap;cursor:pointer;border-radius:12px;padding:12px 14px;font:600 14px 'DM Sans',system-ui,sans-serif;transition:transform .2s,background .2s}" +
      "#dhBrowserOnly button:active{transform:scale(.98)}" +
      "#dhBrowserOnly .hint{margin:10px 0 0;font-size:12px;color:#d7ff3f;display:none}" +
      "#dhBrowserOnly .pri{flex-basis:100%;border:0;background:#d7ff3f;color:#0b2a24}" +
      "#dhBrowserOnly .pri:hover{background:#b9e01f}" +
      "#dhBrowserOnly .sec{border:1px solid rgba(255,255,255,.18);background:transparent;color:#fff}" +
      "#dhBrowserOnly .sec:hover{background:rgba(255,255,255,.06)}" +
      "@keyframes dhPop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}" +
      "@media (prefers-reduced-motion:reduce){#dhBrowserOnly .card{animation:none}}";
    document.head.appendChild(css);

    var wrap = document.createElement("div");
    wrap.id = "dhBrowserOnly";
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "dhBoTitle");
    wrap.setAttribute("aria-describedby", "dhBoDesc");
    wrap.innerHTML =
      '<div class="card">' +
      '<div class="ic" aria-hidden="true">&#127760;</div>' +
      '<h2 id="dhBoTitle">Please log in via your web browser</h2>' +
      '<p id="dhBoDesc">' + label + ' accounts can\u2019t be used in the installed DinkHub app. ' +
      'Open DinkHub in your web browser (Chrome, Safari, Edge\u2026) and sign in there.</p>' +
      '<div class="row">' +
      '<button type="button" class="pri" id="dhBoOpen">Open in web browser</button>' +
      '<button type="button" class="sec" id="dhBoBack">Back to login</button>' +
      '</div><p class="hint" id="dhBoHint">Couldn\u2019t open automatically. Please open your web browser and sign in there.</p></div>';
    (document.body || document.documentElement).appendChild(wrap);

    // Block interaction/scroll with whatever is behind the pop-up; it can't be dismissed.
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") e.preventDefault(); }, true);

    // Open the login page in the normal browser instead of the installed app.
    var hint = wrap.querySelector("#dhBoHint");
    wrap.querySelector("#dhBoOpen").addEventListener("click", function () {
      hint.style.display = "none";
      var left = false;
      var onHide = function () { if (document.hidden) left = true; };
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", function () { left = true; }, { once: true });
      var u = new URL(LOGIN_URL);
      if (/android/i.test(navigator.userAgent)) {
        // Android: hand the link to Chrome so it doesn't reopen inside the installed app.
        location.href = "intent://" + u.host + u.pathname + u.search +
          "#Intent;scheme=" + u.protocol.replace(":", "") + ";package=com.android.chrome;" +
          "S.browser_fallback_url=" + encodeURIComponent(LOGIN_URL) + ";end";
      } else {
        window.open(LOGIN_URL, "_blank", "noopener");
      }
      // If we are still on screen a moment later, the device kept the link inside the app.
      setTimeout(function () {
        document.removeEventListener("visibilitychange", onHide);
        if (!left) hint.style.display = "block";
      }, 1500);
    });
    wrap.querySelector("#dhBoBack").addEventListener("click", function () {
      if (/\/index\.html$|\/$/.test(location.pathname) && location.href.indexOf(ROOT) === 0 && !/\/(admin|operator|referee)\//.test(location.pathname)) {
        wrap.remove(); shown = false; document.documentElement.style.overflow = "";
      } else location.replace(LOGIN_URL);
    });
    var first = wrap.querySelector("#dhBoOpen");
    if (first && first.focus) first.focus();
  }

  window.DinkPWA = { isInstalled: isInstalled, browserOnlyModal: browserOnlyModal, blocked: false, loginUrl: LOGIN_URL };

  // Admin / operator pages opt in with data-block-installed="admin|operator".
  var role = document.currentScript && document.currentScript.getAttribute("data-block-installed");
  if (role && isInstalled()) {
    window.DinkPWA.blocked = true;
    var go = function () { browserOnlyModal(role); };
    if (document.body) go(); else document.addEventListener("DOMContentLoaded", go);
  }
})();
