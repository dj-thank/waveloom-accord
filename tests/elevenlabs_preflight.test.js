import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, runPreflight } from '../tools/elevenlabs_preflight.js';

test('preflight records only operational model and quota facts, never the key or raw account payload', async () => {
  const requests = [];
  const report = await runPreflight({
    apiKey: 'very-secret-key',
    now: new Date('2026-07-30T00:00:00.000Z'),
    fetchImpl: async (url, init) => {
      requests.push({ url, key: init.headers['xi-api-key'] });
      if (url.endsWith('/v1/models')) return { ok: true, status: 200, json: async () => [{ model_id: 'eleven_multilingual_v2', name: 'Multilingual', can_do_text_to_speech: true, concurrency_group: 'standard', description: 'not persisted' }] };
      return { ok: true, status: 200, json: async () => ({ user_id: 'not-persisted', character_count: 20, character_limit: 100, max_credit_limit_extension: 0, status: 'active', open_invoices: [{ amount_due_cents: 99 }] }) };
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].key, 'very-secret-key');
  assert.deepEqual(report.subscription, { access: 'available', status: 'active', creditsUsed: 20, creditLimit: 100, creditsRemaining: 80, overageEnabled: false });
  assert.equal(report.modelListing.requiredTts[0].listed, true);
  assert.ok(!JSON.stringify(report).includes('very-secret-key'));
  assert.ok(!JSON.stringify(report).includes('not-persisted'));
  assert.ok(!JSON.stringify(report).includes('amount_due_cents'));
});

test('preflight fails closed when the required model or required subscription access is unavailable', async () => {
  await assert.rejects(runPreflight({ apiKey: 'test', fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) }), /required TTS model unavailable/);
  await assert.rejects(runPreflight({
    apiKey: 'test',
    fetchImpl: async url => url.endsWith('/v1/models')
      ? ({ ok: true, status: 200, json: async () => [{ model_id: 'eleven_multilingual_v2', can_do_text_to_speech: true }] })
      : ({ ok: false, status: 403, json: async () => ({}) }),
  }), /provider preflight failed \(403\)/);
});

test('preflight argument parser accepts an explicit TTS model and keeps subscription access required by default', () => {
  const args = parseArgs(['--required-tts-model', 'model-x', '--timeout-ms', '5000', '--out', 'out.json']);
  assert.deepEqual(args.requiredTtsModels, ['model-x']);
  assert.equal(args.timeoutMs, 5000);
  assert.equal(args.requireSubscription, true);
});
