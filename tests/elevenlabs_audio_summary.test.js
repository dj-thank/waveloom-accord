import assert from 'node:assert/strict';
import test from 'node:test';
import { waveSummary } from '../tools/summarize_elevenlabs_audio_factory.js';

test('audio summary counts generated candidates, technical audit evidence, and optional mastering without exposing a request payload', () => {
  const result = waveSummary('wave', { assets: [{ sha256: 'a', characterCost: 3 }, { sourcePath: 'raw.mp3', characterCost: 2 }] }, { passed: 2, failed: 0 }, [{ mastered: 1, failed: 1 }, { mastered: 2, failed: 0 }]);
  assert.deepEqual(result, { id: 'wave', assets: 2, generated: 2, providerCharacterCost: 5, technical: { passed: 2, failed: 0 }, mastering: { passed: 3, failed: 1 } });
});
