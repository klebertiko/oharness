/* Before first paint: language, saved sidebar width, and a deep link with no static file.
   A blocking external script, same as theme-init.js, so script-src 'self' still holds. */
(function () {
  var stored = null;
  var langs = [];
  var lang = "en";
  var i = 0;
  var tag = "";
  var raw = null;
  var mode = "open";
  var width = 280;
  var dock = false;
  var saved = null;
  var prev = null;
  var old = null;
  var vw;
  var flow;
  var path;
  var dynamic = false;

  try {
    stored = localStorage.getItem("oharness-locale");
    langs = navigator.languages || [navigator.language || ""];
    if (stored === "pt-BR" || stored === "en") lang = stored;
    else {
      for (i = 0; i < langs.length; i++) {
        tag = String(langs[i] || "");
        if (/^pt/i.test(tag)) {
          lang = "pt-BR";
          break;
        }
        if (/^en/i.test(tag)) {
          lang = "en";
          break;
        }
      }
    }
    document.documentElement.lang = lang;
  } catch {
    /* storage or navigator unavailable */
  }

  try {
    raw = localStorage.getItem("oh.shell.v9");
    if (raw) {
      saved = JSON.parse(raw);
      if (saved.sidebar === "rail" || saved.sidebar === "hidden" || saved.sidebar === "open") mode = saved.sidebar;
      if (typeof saved.sidebarWidth === "number") width = Math.min(400, Math.max(220, Math.round(saved.sidebarWidth)));
      dock = Boolean(saved.dockOpen);
    } else {
      prev = localStorage.getItem("oh.shell.v8");
      if (prev) {
        old = JSON.parse(prev);
        mode = old.leftOpen === false ? "hidden" : "open";
        dock = Boolean(old.rightOpen);
      }
    }
    vw = window.innerWidth || 1280;
    flow = width;
    if (vw < 768) flow = 0;
    else if (vw <= 1024) flow = mode === "hidden" ? 0 : 56;
    else if (mode === "hidden") flow = 0;
    else if (mode === "rail") flow = 56;
    document.documentElement.style.setProperty("--oh-side-w", flow + "px");
    void dock;
  } catch {
    /* keep the default frame */
  }

  try {
    path = (location.pathname || "/").replace(/\/index\.html$/, "").replace(/\/$/, "") || "/";
    window.__OH_PATH__ = path;
    dynamic = /^\/(?:s\/[^/]+|forja\/item\/[^/]+|studio\/[^/]+|settings\/[^/]+)$/.test(path);
    if (dynamic) history.replaceState({ oh: 1, path: "/" }, "", "/");
    window.addEventListener(
      "popstate",
      function (ev) {
        if (ev.state && ev.state.oh) {
          ev.stopImmediatePropagation();
          if (typeof ev.state.path === "string") window.__OH_PATH__ = ev.state.path;
          window.dispatchEvent(new Event("oh-nav"));
        }
      },
      true,
    );
  } catch {
    /* history unavailable */
  }
})();
