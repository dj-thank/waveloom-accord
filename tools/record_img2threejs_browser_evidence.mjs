import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = 'C:/Users/rambo/projects/kagariai-props';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const screenshotRecord = async (relativePath, view, light) => {
  const bytes = await readFile(path.join(root, relativePath));
  return { path: relativePath.replaceAll('\\', '/'), view, light, width: 1280, height: 720, bytes: bytes.length, sha256: sha256(bytes) };
};

const awningScreens = await Promise.all([
  screenshotRecord('outputs/aaa_market_awning_browser_20260801_front_neutral.png', 'front', 'neutral'),
  screenshotRecord('outputs/aaa_market_awning_browser_20260801_three_quarter_reference.png', 'three-quarter', 'reference'),
  screenshotRecord('outputs/aaa_market_awning_browser_20260801_rear_grazing.png', 'rear', 'grazing'),
  screenshotRecord('outputs/aaa_market_awning_browser_20260801_top_clearance_neutral.png', 'top-clearance', 'neutral'),
]);
const finialScreens = await Promise.all([
  screenshotRecord('outputs/aaa_roof_finial_browser_20260801_front_neutral.png', 'front', 'neutral'),
  screenshotRecord('outputs/aaa_roof_finial_browser_20260801_three_quarter_reference.png', 'three-quarter', 'reference'),
  screenshotRecord('outputs/aaa_roof_finial_browser_20260801_rear_grazing.png', 'rear', 'grazing'),
  screenshotRecord('outputs/aaa_roof_finial_browser_20260801_top_clearance_neutral.png', 'top-clearance', 'neutral'),
]);

const evidence = {
  generatedAt: new Date().toISOString(),
  browser: { engine: 'Google Chrome via Playwright', webgl: true, consoleErrors: 0, viewport: [1280, 720], captureMode: 'capture=1' },
  policy: 'browser-render candidate evidence only; no Tier-1, map safety, human AAA, or runtime admission is implied',
  assets: [
    {
      assetId: 'prop-market-awning-01',
      preview: 'work/asset-rush/aaa-v1-pilot/img2threejs/prop-market-awning-01/preview.html',
      metrics: { assetTriangles: 820, assetDrawCalls: 3, triangleBudget: 1400, drawCallBudget: 3, collision: 'none', candidateOnly: true, undersideMeters: 2.2, safetyAudit: 'required' },
      screenshots: awningScreens,
    },
    {
      assetId: 'prop-roof-finial-01',
      preview: 'work/asset-rush/aaa-v1-pilot/img2threejs/prop-roof-finial-01/preview.html',
      metrics: { assetTriangles: 808, assetDrawCalls: 2, triangleBudget: 900, drawCallBudget: 2, collision: 'none', candidateOnly: true, roofClearanceMeters: 0.25, sightlineAudit: 'required' },
      screenshots: finialScreens,
    },
  ],
};
const out = path.join(root, 'outputs/aaa_img2threejs_browser_evidence_20260801.json');
await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: out, assets: evidence.assets.map(item => ({ assetId: item.assetId, triangles: item.metrics.assetTriangles, drawCalls: item.metrics.assetDrawCalls, screenshots: item.screenshots.length })) }, null, 2));
