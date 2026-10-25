// Preview pages read ?theme=dark|light, as the index does.
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'dark';
