import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('asset builder reports the Python spawn error instead of undefined output', () => {
  const missingPython = path.join(ROOT, 'work', 'missing-python-for-asset-builder-test.exe');
  const result = spawnSync(process.execPath, ['tools/build_hero_asset_manifest.js'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, KAGARIAI_PYTHON: missingPython },
    windowsHide: true,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /atlas processor failed for zairu-concept/);
  assert.match(result.stderr, /ENOENT/);
  assert.match(result.stderr, /missing-python-for-asset-builder-test\.exe/);
  assert.doesNotMatch(result.stderr, /\nundefined\nundefined/);
});
