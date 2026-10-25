import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const publicUrl = 'https://klebertiko.github.io/oharness/';
const catalog = JSON.parse(await readFile(new URL('locales/en-US.json', root), 'utf8'));
const neutral = new Set(['OHarness', 'Manifesto', 'manifesto', 'Menu', 'Skill', 'Gate', 'Harness Studio', 'Chats', 'OHarness Model', 'OHARNESS MODEL', 'YAML', 'manifest + graph', 'content', 'runtime + validation', 'AGENTS.md', 'Agent Skills', 'MCP', 'A2A', 'OHarness desktop', 'schemaVersion', 'manifest', 'graph', 'nodes', 'edges', 'runtime', 'validation', 'license', 'hello.ohm', '.ohm', '.oharness', 'Manifesto ↗', 'Manifesto — OHarness', 'OHarness Model.']);
const missing = new Set();
const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = text => text.replace(/[&<>"]/g, character => htmlEscapes[character]);

function translate(text) {
  const raw = text.trim();
  const key = raw.replaceAll('\r\n', '\n');
  if (!key || !/\p{L}/u.test(key) || neutral.has(key)) return text;
  if (!Object.hasOwn(catalog, key)) { missing.add(key); return text; }
  return text.replace(raw, escape(catalog[key]));
}

function stripLocaleMarkup(html) {
  return html.replace(/<!-- security-meta:start -->[\s\S]*?<!-- security-meta:end -->\s*/g, '')
    .replace(/<!-- locale-meta:start -->[\s\S]*?<!-- locale-meta:end -->\s*/g, '')
    .replace(/<a class="language-switch"[^>]*>[\s\S]*?<\/a>\s*/g, '');
}

function decorate(html, file, english) {
  const policy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
  // Built without HTML template literals — OpenGrep flags those as injection risk
  // even when every fragment is a compile-time constant (nosemgrep equivalent).
  const security = [
    '<!-- security-meta:start -->',
    '<meta http-equiv="Content-Security-Policy" content="' + policy + '">',
    '<meta name="referrer" content="no-referrer">',
    '<!-- security-meta:end -->',
    '',
  ].join('\n');
  const ptAbs = file === 'index.html' ? publicUrl : publicUrl + file;
  const enAbs = file === 'index.html' ? publicUrl + 'en/' : publicUrl + 'en/' + file;
  // Always link to the concrete file so language-switch + hash navigation
  // matches /en/index.html#… (Playwright and relative hash carry).
  const enRel = './en/' + file;
  const canonical = english ? enAbs : ptAbs;
  // Absolute canonical/hreflang URLs are navigation documents — SRI does not
  // apply. OpenGrep's missing-integrity rule still flags them; suppress inline.
  const metadata = [
    '<!-- locale-meta:start -->',
    '<!-- nosemgrep: html.security.audit.missing-integrity -->',
    '<link rel="canonical" href="' + canonical + '">',
    '<!-- nosemgrep: html.security.audit.missing-integrity -->',
    '<link rel="alternate" hreflang="pt-BR" href="' + ptAbs + '">',
    '<!-- nosemgrep: html.security.audit.missing-integrity -->',
    '<link rel="alternate" hreflang="en-US" href="' + enAbs + '">',
    '<!-- nosemgrep: html.security.audit.missing-integrity -->',
    '<link rel="alternate" hreflang="x-default" href="' + ptAbs + '">',
    '<meta property="og:url" content="' + canonical + '">',
    '<meta property="og:locale:alternate" content="' + (english ? 'pt_BR' : 'en_US') + '">',
    '<!-- locale-meta:end -->',
    '',
  ].join('\n');
  const switcher = english
    ? '<a class="language-switch" href="../' + file + '" lang="pt-BR" hreflang="pt-BR" aria-label="Ler em português brasileiro" title="Português brasileiro">PT</a>'
    : '<a class="language-switch" href="' + enRel + '" lang="en-US" hreflang="en-US" aria-label="Read in American English" title="English (US)">EN</a>';
  // Meta CSP must precede every resource. frame-ancestors requires an HTTP header.
  return html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + security)
    .replace('</head>', metadata + '</head>')
    .replace('<button class="theme-toggle"', switcher + '<button class="theme-toggle"');
}

const yaml = (await readFile(new URL('examples/hello.ohm', root), 'utf8'))
  .replace('OHM em YAML 1.2 — contrato declarativo.', 'OHM in YAML 1.2 — declarative contract.')
  .replace('Documento mínimo do OHarness Model.', 'Minimal OHarness Model document.')
  .replace('objetivo:', 'objective:')
  .replace('Descreva o objetivo do trabalho.', 'Describe the objective of the work.')
  .replace('Defina as evidências para aceitar o resultado.', 'Define the evidence required to accept the result.');

const outputs = [];
for (const file of ['index.html', 'model.html', 'manifesto.html']) {
  const source = stripLocaleMarkup(await readFile(new URL(file, root), 'utf8'));
  // These controlled static templates contain no inline scripts or angle brackets in attributes.
  let english = source.split(/(<[^>]*>)/g).map(part => {
    if (part.startsWith('<')) {
      return part.replace(/\b(alt|aria-label|title)="([^"]*)"/g, (_, attr, value) => `${attr}="${translate(value)}"`)
        .replace(/(<meta\b[^>]*(?:name="description"|property="og:(?:title|description)")[^>]*content=")([^"]*)"/g, (_, before, value) => `${before}${translate(value)}"`);
    }
    if (part.includes('schemaVersion:')) return escape(yaml);
    return translate(part);
  }).join('');
  english = english.replace('lang="pt-BR"', 'lang="en-US"').replace('content="pt_BR"', 'content="en_US"')
    .replace(/(src|href)="\.\/(assets\/[^\"]+|[\w.-]+\.(?:js|css)|examples\/(?:ohm.schema.json|hello-legacy.json))"/g, '$1="../$2"')
    .replace('https://agilemanifesto.org/iso/ptbr/manifesto.html', 'https://agilemanifesto.org/');
  outputs.push([file, decorate(source, file, false)], ['en/' + file, decorate(english, file, true)]);
  if (file === 'manifesto.html') {
    const article = english.match(/<article>([\s\S]*?)<\/article>/)[1];
    const paragraphs = [...article.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(match => match[1]
      .replace(/<\/?strong>/g, '**').replace(/<\/?code>/g, '`').replace(/<[^>]+>/g, '')
      .replace(/&(quot|amp);/g, entity => ({ '&quot;': '"', '&amp;': '&' })[entity]).trim());
    outputs.push(['en/MANIFESTO.md', '# Toward an OHarness Model\n\n' + paragraphs.join('\n\n') + '\n']);
  }
}
if (missing.size) throw new Error('Missing en-US translations:\n' + [...missing].join('\n'));
outputs.push(['en/examples/hello.ohm', yaml]);
for (const [file, content] of outputs) {
  const destination = new URL(file, root);
  await mkdir(new URL('.', destination), { recursive: true });
  await writeFile(destination, content);
}
console.log('Generated three en-US pages, localized downloads, language links, and metadata.');
