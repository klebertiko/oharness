// Apply the preference before styles paint; the rest waits for the document.
(() => {
  const storageKey = 'oharness-website-theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const english = root.lang === 'en-US';
  const assetBase = new URL('./assets/', document.currentScript.src);
  let preference = null;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Storage may be unavailable in private or embedded browsers. */ }

  function apply() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll('.theme-toggle').forEach(button => {
      const label = english
        ? (theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')
        : (theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.hidden = false;
    });
    document.querySelectorAll('[data-product-image]').forEach(image => {
      image.src = new URL(`${image.dataset.productImage}-${theme}.webp`, assetBase).href;
    });
    if (document.readyState !== 'loading') {
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.append(meta);
      }
      meta.content = getComputedStyle(root).getPropertyValue('--color-paper').trim();
    }
  }

  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('.language-switch').forEach(link => {
      link.addEventListener('click', () => {
        // Carry the section over only while it is on screen; a stale hash (e.g. #baixar left by the download CTA) would jump the new page away from where the reader is.
        const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
        const box = target && target.getBoundingClientRect();
        link.hash = box && box.bottom > 0 && box.top < window.innerHeight ? location.hash : '';
      });
    });
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.addEventListener('click', () => {
        preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(storageKey, preference); } catch { /* The toggle still works. */ }
        apply();
      });
    });
  });
  system.addEventListener('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = event.newValue === 'dark' || event.newValue === 'light' ? event.newValue : null;
    apply();
  });
})();
