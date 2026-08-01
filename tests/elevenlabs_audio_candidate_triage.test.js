import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePcm16Mono, classifyMetrics, resolveCandidatePath } from '../tools/triage_elevenlabs_audio_candidates.js';

function pcm(samples) {
  const out = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => out.writeInt16LE(value, index * 2));
  return out;
}

test('candidate triage computes stable PCM metrics and flags clipping/DC/silence', () => {
  const silent = analyzePcm16Mono(pcm(new Array(4410).fill(0)), 0.1);
  assert.equal(silent.durationSec, 0.1);
  assert.equal(silent.rms, 0);
  assert.deepEqual(classifyMetrics(silent), { flags: ['near_silent'], disposition: 'REJECT_OR_REGENERATE_REVIEW' });

  const clipped = analyzePcm16Mono(pcm([32767, -32768, 32767, -32768]), 1);
  const classified = classifyMetrics(clipped);
  assert.ok(classified.flags.includes('clipping_risk'));
  assert.ok(classified.flags.includes('duration_outlier'));
});

test('candidate triage rejects paths outside the project root', () => {
  assert.equal(resolveCandidatePath('C:/project', 'outputs/audio.mp3'), 'C:\\project\\outputs\\audio.mp3');
  assert.throws(() => resolveCandidatePath('C:/project', '../secret.mp3'), /escapes project root/);
  assert.throws(() => resolveCandidatePath('C:/project', 'C:/secret.mp3'), /project-relative/);
  assert.throws(() => resolveCandidatePath('C:/project', 'outputs\\audio.mp3'), /project-relative/);
});
