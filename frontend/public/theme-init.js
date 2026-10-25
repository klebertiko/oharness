/* Sets the theme before first paint (experience.md: no flash). A blocking
   external script, not an inline one, so it satisfies the packaged app's
   `script-src 'self'`. Keep the key and colours in step with src/lib/theme.ts. */
(function () {
  var theme = "dark";
  try {
    if (window.localStorage.getItem("oharness-theme") === "light") theme = "light";
  } catch {
    /* storage blocked: Graphite */
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", theme === "light" ? "oklch(0.965 0.008 82)" : "oklch(0.170 0.006 72)");
})();
