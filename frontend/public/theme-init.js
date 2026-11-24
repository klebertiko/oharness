/* Sets the theme before first paint (experience.md: no flash). A blocking
   external script, not an inline one, so it satisfies the packaged app's
   `script-src 'self'`. Keep the key and colours in step with src/lib/theme.ts.
   System is the default and follows the OS. */
(function () {
  var theme = "system";
  var saved = null;
  try {
    saved = window.localStorage.getItem("oharness-theme");
    if (saved === "light" || saved === "dark" || saved === "system") theme = saved;
  } catch {
    /* storage blocked: follow the OS */
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme === "system" ? "light dark" : theme;
  var dark = "oklch(0.170 0.006 72)";
  var light = "oklch(0.965 0.008 82)";
  var content = theme === "light" ? light : dark;
  if (theme === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) content = light;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
})();
