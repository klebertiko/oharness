import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'oharness-publication-test-'));
const build = path => spawnSync(process.execPath, ['scripts/build-pages.mjs', path], {cwd:root,encoding:'utf8'});
const stale = join(temporary, 'stale');
await mkdir(stale);
await writeFile(join(stale, 'internal-note.txt'), 'must not be published');
assert.notEqual(build(stale).status, 0, 'An existing output must be rejected');
assert.deepEqual(await readdir(stale), ['internal-note.txt'], 'Rejected output must remain untouched');
const fresh = join(temporary, 'fresh');
const result = build(fresh);
assert.equal(result.status, 0, result.stderr);
const entries = await readdir(fresh, {recursive:true,withFileTypes:true});
assert.equal(entries.filter(entry => entry.isFile()).length, 33);
assert.ok(!entries.some(entry => /internal-note|\.env|serve\.mjs|tests|scripts/.test(entry.name)));
for (const prefix of ['', 'en/']) for (const file of ['index.html', 'model.html', 'manifesto.html']) {
  const html = await readFile(join(fresh, prefix + file), 'utf8');
  assert.equal((html.match(/http-equiv="Content-Security-Policy"/g) || []).length, 1);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
  assert.ok(!html.includes('unsafe-inline') && !html.includes('unsafe-eval'));
}
assert.notEqual(build(fresh).status, 0, 'A previously generated artifact must not be reused');
console.log('PASS: stale output rejected unchanged; fresh public inventory and security metadata verified.');
