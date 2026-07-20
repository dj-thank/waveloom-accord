import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROTOCOL_VERSION, LAG_COMPENSATION_POLICY, isSupportedProtocolVersion,
} from '../shared/protocol.js';
import { PROTOCOL_VERSION as RUNTIME_PROTOCOL_VERSION } from '../server/runtime.js';

test('shared, runtime, and protocol document agree on protocol v5', () => {
  assert.equal(PROTOCOL_VERSION, 5);
  assert.equal(RUNTIME_PROTOCOL_VERSION, PROTOCOL_VERSION);
  assert.equal(isSupportedProtocolVersion(5), true);
  assert.equal(isSupportedProtocolVersion(4), false);
  assert.deepEqual(LAG_COMPENSATION_POLICY, {
    displayInterpolationBaseMs: 100,
    absoluteMaxMs: 220,
  });
  const title = fs.readFileSync(path.resolve('server/PROTOCOL.md'), 'utf8').split(/\r?\n/, 1)[0];
  assert.match(title, /v5$/);
});
