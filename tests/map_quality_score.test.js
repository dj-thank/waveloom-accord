import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMap } from '../shared/data/map_oshioi.js';
import { evaluateMapQuality } from '../tools/audit_map_quality_score.mjs';

test('the local quality score requires real browser evidence, not source data alone', () => {
  const map = buildMap();
  const withoutPreview = evaluateMapQuality({ map });
  assert.equal(withoutPreview.status, 'incomplete-evidence');
  assert.ok(withoutPreview.failedCriteria.includes('preview-contract'));

  const instances = map.presentation.layers.reduce((sum, layer) => sum + layer.transforms.length, 0);
  const preview = {
    ok: true,
    exceptions: [],
    console: [],
    review: {
      contract: { valid: true },
      map: {
        instanceCount: instances,
        layerCount: map.presentation.layers.length,
        performance: { renderer: { render: { calls: 147, triangles: 505146 } } },
      },
    },
  };
  const withPreview = evaluateMapQuality({ map, preview });
  assert.equal(withPreview.status, 'complete-local-evidence');
  assert.equal(withPreview.score, 100);
  assert.equal(withPreview.maximum, 100);
});

test('the runtime mode declaration is no longer left at implementation target', () => {
  const mode = JSON.parse(readFileSync(
    new URL('../shared/data/mode_flashpoint.json', import.meta.url),
    'utf8',
  ));
  assert.equal(mode.status, 'runtime_enabled');
});
