#!/usr/bin/env node

// A deliberately narrow, evidence-backed scorecard for the Oshioi Flashpoint
// map. It is not an artistic "AAA" claim: it reports whether the agreed local
// map contract, budget, and preview evidence are all present at one point in
// time. Gameplay safety remains independently enforced by the collision,
// route, and false-cover test suites.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap } from '../shared/data/map_oshioi.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';

const EXPECTED_SITES = Object.freeze(['shiogama', 'mizuichi', 'kado', 'ami', 'kazami']);
const MAX_DRAWS = 250;
const MAX_TRIANGLES = 1_200_000;

function flag(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function layer(map, id) {
  return map.presentation.layers.find(candidate => candidate.id === id) || null;
}

function transformKey(transform) {
  return transform.position.map(value => value.toFixed(5)).join(',');
}

function criterion(id, label, maxPoints, pass, actual, target) {
  return {
    id,
    label,
    points: pass ? maxPoints : 0,
    maxPoints,
    pass,
    actual,
    target,
  };
}

function previewEvidence(preview) {
  const review = preview?.review || {};
  const renderer = review.map?.performance?.renderer?.render || {};
  const errors = [
    ...(Array.isArray(preview?.exceptions) ? preview.exceptions : []),
    ...(Array.isArray(preview?.console) ? preview.console.filter(entry => entry.type === 'error') : []),
  ];
  return {
    valid: review.contract?.valid === true && preview?.ok === true,
    instances: review.map?.instanceCount,
    layers: review.map?.layerCount,
    calls: renderer.calls,
    triangles: renderer.triangles,
    errors: errors.length,
  };
}

export function evaluateMapQuality({ map = buildMap(), preview = null } = {}) {
  const layers = map.presentation.layers;
  const totalInstances = layers.reduce((sum, candidate) => sum + candidate.transforms.length, 0);
  const budget = map.presentation.performanceBudget;
  const sites = map.objectives?.map(objective => objective.id) || [];
  const domeLayer = layer(map, 'metropolis-dome-roofs');
  const beaconLayer = layer(map, 'landmark-beacon-body');
  const seamLayer = layer(map, 'ground-figure-seam');
  const goldLayer = layer(map, 'ground-lane-gold');
  const finialLayer = layer(map, 'clad-ring-finial');
  const previewMetrics = previewEvidence(preview);
  const finialPositions = new Set(finialLayer?.transforms.map(transformKey) || []);
  const finialSilhouettes = new Set((finialLayer?.transforms || []).map(transform =>
    transform.scale.map(value => value.toFixed(3)).join(',')));
  const distinctSiteFamilies = ['kiln', 'market', 'dock', 'lock', 'slip'].every(prefix =>
    layers.filter(candidate => candidate.id.startsWith(`clad-${prefix}-`)).length >= 3);
  const onlyDeclaredSemantics = layers.every(candidate =>
    candidate.semantics === 'clad-existing-solid' || candidate.semantics === 'outside-playable-bounds');

  const categories = [
    {
      id: 'map-contract', label: 'マップ契約と競技境界', criteria: [
        criterion('five-sites', '5拠点の順序とID', 8,
          sites.length === EXPECTED_SITES.length && EXPECTED_SITES.every((id, index) => sites[index] === id),
          sites, EXPECTED_SITES),
        criterion('presentation-boundary', '描画層の明示的な競技境界', 8,
          onlyDeclaredSemantics, [...new Set(layers.map(candidate => candidate.semantics))],
          ['clad-existing-solid', 'outside-playable-bounds']),
        criterion('collision-scale', '衝突ソリッドの本番規模', 6,
          map.solids.length >= 1_000, map.solids.length, '>= 1000'),
        criterion('flashpoint-protocol', 'Flashpointプロトコルv6', 8,
          PROTOCOL_VERSION === 6, PROTOCOL_VERSION, 6),
      ],
    },
    {
      id: 'visual-hierarchy', label: '視覚階層', criteria: [
        criterion('dome-rhythm', '遠景の丸屋根リズム', 7,
          domeLayer?.primitive === 'dome' && domeLayer.transforms.length >= 12,
          domeLayer?.transforms.length ?? 0, 'dome >= 12'),
        criterion('beacon-contrast', '中央灯柱の暖色シルエット', 6,
          beaconLayer?.material === 'copperPlaster'
            && beaconLayer.transforms.some(transform => transform.position[2] > 20),
          beaconLayer?.material ?? null, 'copperPlaster above z=20'),
        criterion('plaza-hierarchy', '広場の暖色目地と金の導線', 6,
          seamLayer?.material === 'cedar' && (goldLayer?.transforms.length || 0) >= 300,
          { seam: seamLayer?.material ?? null, gold: goldLayer?.transforms.length ?? 0 },
          { seam: 'cedar', gold: '>= 300' }),
        criterion('finial-cadence', '金冠の重複なし・形状変化', 5,
          finialPositions.size === (finialLayer?.transforms.length || 0) && finialSilhouettes.size >= 7,
          { positions: finialPositions.size, silhouettes: finialSilhouettes.size },
          { positions: 'all unique', silhouettes: '>= 7' }),
        criterion('site-vocabulary', '5拠点の固有語彙', 6,
          distinctSiteFamilies, distinctSiteFamilies, 'five families with >= 3 layers'),
      ],
    },
    {
      id: 'performance', label: '性能予算', criteria: [
        criterion('instances', '描画インスタンス', 8,
          totalInstances <= budget.maxPresentationInstances,
          totalInstances, `<= ${budget.maxPresentationInstances}`),
        criterion('layers', 'presentation層', 5,
          layers.length <= budget.maxPresentationDrawCalls,
          layers.length, `<= ${budget.maxPresentationDrawCalls}`),
        criterion('preview-draws', '実画面ドローコール', 6,
          Number.isFinite(previewMetrics.calls) && previewMetrics.calls <= MAX_DRAWS,
          previewMetrics.calls ?? null, `<= ${MAX_DRAWS}`),
        criterion('preview-triangles', '実画面三角形', 6,
          Number.isFinite(previewMetrics.triangles) && previewMetrics.triangles <= MAX_TRIANGLES,
          previewMetrics.triangles ?? null, `<= ${MAX_TRIANGLES}`),
      ],
    },
    {
      id: 'evidence', label: '実行証跡', criteria: [
        criterion('preview-contract', 'ブラウザのマップ契約', 6,
          previewMetrics.valid, previewMetrics.valid, true),
        criterion('preview-clean', 'ブラウザ例外・console error', 4,
          previewMetrics.errors === 0, previewMetrics.errors, 0),
        criterion('preview-count-match', 'ブラウザと定義の件数一致', 5,
          previewMetrics.instances === totalInstances && previewMetrics.layers === layers.length,
          { instances: previewMetrics.instances ?? null, layers: previewMetrics.layers ?? null },
          { instances: totalInstances, layers: layers.length }),
      ],
    },
  ];

  const total = categories.reduce((sum, category) => sum
    + category.criteria.reduce((categorySum, item) => categorySum + item.points, 0), 0);
  const maximum = categories.reduce((sum, category) => sum
    + category.criteria.reduce((categorySum, item) => categorySum + item.maxPoints, 0), 0);
  const failed = categories.flatMap(category => category.criteria
    .filter(item => !item.pass).map(item => item.id));

  return {
    schemaVersion: 1,
    scope: 'local-map-quality-evidence',
    score: total,
    maximum,
    status: total === maximum ? 'complete-local-evidence' : 'incomplete-evidence',
    limitations: [
      'This is a deterministic local evidence score, not a human AAA-art verdict.',
      'Route safety, collision containment, and false-cover clustering are gated by their dedicated test/audit commands.',
      'It does not prove deployment, multiplayer production traffic, or a human playtest.',
    ],
    metrics: {
      solids: map.solids.length,
      presentationLayers: layers.length,
      presentationInstances: totalInstances,
      budget,
      preview: previewMetrics,
    },
    categories,
    failedCriteria: failed,
  };
}

function readPreview(path) {
  if (!path) return null;
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`PREVIEW_EVIDENCE_NOT_FOUND:${path}`);
  return JSON.parse(readFileSync(absolute, 'utf8'));
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const result = evaluateMapQuality({ preview: readPreview(flag('preview')) });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const output = flag('out');
  if (output) {
    const absolute = resolve(output);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, serialized);
  }
  process.stdout.write(serialized);
  process.exitCode = result.status === 'complete-local-evidence' ? 0 : 1;
}
