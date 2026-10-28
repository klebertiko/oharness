import './build-locales.mjs';
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(source, 'artifacts'), {recursive:true});
const output = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(resolve(source, 'artifacts/pages-'));
// Never reuse a directory: old files and symlinks must not enter a publication.
if (process.argv[2]) {
  await mkdir(dirname(output), {recursive:true});
  await mkdir(output);
}
const files = [
  'index.html', 'model.html', 'manifesto.html', 'MANIFESTO.md',
  'tokens.css', 'style.css', 'motion.css', 'theme.js', 'main.js', 'nilo.js', 'motion.js', 'i18n.js',
  'examples/hello.ohm', 'examples/hello-legacy.json', 'examples/ohm.schema.json',
  'en/index.html', 'en/model.html', 'en/manifesto.html', 'en/MANIFESTO.md', 'en/examples/hello.ohm',
  'assets/mark.svg', 'assets/nilo.svg', 'assets/nilo-poses.json',
  'assets/sora-latin.woff2', 'assets/plex-mono-latin.woff2', 'assets/OFL-Sora.txt', 'assets/OFL-Plex.txt',
  ...['chats','studio','canvas','run','providers'].flatMap(name => ['light','dark'].map(theme => `assets/${name}-${theme}.webp`)),
];
for (const file of files) {
  const destination = resolve(output, file);
  await mkdir(dirname(destination), {recursive:true});
  await copyFile(resolve(source, file), destination);
}
await writeFile(resolve(output, '.nojekyll'), '');
await writeFile(resolve(output, 'README.md'), `# OHarness website

- Português brasileiro: https://klebertiko.github.io/oharness/
- American English: https://klebertiko.github.io/oharness/en/

This is the static product website, generated from the website/ folder on main by npm run build:pages and deployed by the Pages workflow (.github/workflows/pages.yml). Edit the source on main, not this output.

Keep the font licenses. Internal notes, local servers, tests, and credentials do not belong in the publication.
`);
const expected = [...files, '.nojekyll', 'README.md'].sort();
const entries = await readdir(output, {recursive:true, withFileTypes:true});
const actual = entries.filter(entry => !entry.isDirectory()).map(entry =>
  resolve(entry.parentPath, entry.name).slice(output.length + 1).replaceAll('\\', '/')
).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected) || entries.some(entry => entry.isSymbolicLink())) {
  throw new Error('Publication inventory does not match the public file allowlist.');
}
console.log(`Prepared ${expected.length} public files in ${output}`);
