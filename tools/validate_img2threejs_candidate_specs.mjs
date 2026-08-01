import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = 'C:/Users/rambo/projects/kagariai-props';
const python = process.env.PYTHON_BIN || 'C:/Users/rambo/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const validator = 'C:/Users/rambo/.codex/skills/img2threejs/forge/stage2_spec/validate_sculpt_spec.py';
const assets = ['prop-market-awning-01', 'prop-roof-finial-01'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const results = [];

for (const assetId of assets) {
  const relative = `work/asset-rush/aaa-v1-pilot/img2threejs/${assetId}/OBJECT_SCULPT_SPEC.json`;
  const specPath = path.join(root, relative);
  const run = spawnSync(python, [validator, specPath, '--strict-quality', '--json'], { encoding: 'utf8' });
  if (run.error) throw run.error;
  const report = JSON.parse(run.stdout);
  const bytes = await readFile(specPath);
  results.push({ assetId, spec: relative.replaceAll('\\', '/'), sha256: sha256(bytes), exitCode: run.status, ...report });
}

const output = {
  generatedAt: new Date().toISOString(),
  validator: 'validate_sculpt_spec.py --strict-quality',
  policy: 'strict spec PASS is not browser/render/runtime admission',
  results,
};
const out = path.join(root, 'outputs/aaa_img2threejs_candidate_specs_20260801.json');
await writeFile(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out, results: results.map(({ assetId, ok, exitCode, summary }) => ({ assetId, ok, exitCode, summary })) }, null, 2));
if (results.some((item) => item.ok !== true || item.exitCode !== 0)) process.exitCode = 1;
