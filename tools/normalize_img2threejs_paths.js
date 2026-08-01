import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'work', 'img2threejs');
const TEXT_EXTENSIONS = new Set(['.json', '.js', '.mjs', '.ts', '.md', '.log']);
const WINDOWS_ROOT = `${ROOT}${path.sep}`;
const POSIX_ROOT = `${ROOT.replaceAll(path.sep, '/')}/`;
const ESCAPED_WINDOWS_ROOT = WINDOWS_ROOT.replaceAll('\\', '\\\\');
const ABSOLUTE_USER_PATH = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\/Users\/)/m;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }));
  return nested.flat();
}

function normalizeText(source) {
  return source
    .replaceAll(ESCAPED_WINDOWS_ROOT, '')
    .replaceAll(WINDOWS_ROOT, '')
    .replaceAll(POSIX_ROOT, '')
    .replace(/"work(?:\\\\[^"\r\n]*)"/g, (value) => value.replaceAll('\\\\', '/'));
}

const check = process.argv.includes('--check');
const files = (await walk(TARGET)).filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()));
const changed = [];
const invalid = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const normalized = normalizeText(source);
  if (normalized !== source) {
    changed.push(path.relative(ROOT, file).replaceAll(path.sep, '/'));
    if (!check) await writeFile(file, normalized, 'utf8');
  }
  if (ABSOLUTE_USER_PATH.test(normalized)) {
    invalid.push(path.relative(ROOT, file).replaceAll(path.sep, '/'));
  }
}

if (check && changed.length) {
  throw new Error(`img2threejs paths are not normalized: ${changed.join(', ')}`);
}
if (invalid.length) {
  throw new Error(`img2threejs files still contain workstation paths: ${invalid.join(', ')}`);
}
console.log(JSON.stringify({ checked: files.length, changed: check ? 0 : changed.length }));
