import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatAudio } from '../client/combat_audio.js';

function hostWith(values = {}) {
  const saved = new Map(Object.entries(values));
  return {
    saved,
    localStorage: {
      getItem: key => saved.has(key) ? saved.get(key) : null,
      setItem: (key, value) => saved.set(key, value),
    },
  };
}

const VERIFIED_DIGEST = '11'.repeat(32);

function enableDeterministicIntegrity(host) {
  host.crypto = {
    subtle: {
      digest: async () => new Uint8Array(32).fill(0x11).buffer,
    },
  };
  return host;
}

test('音量未保存時は72%、保存済み0は消音として区別する', () => {
  assert.equal(new CombatAudio(hostWith()).volume, 0.72);
  assert.equal(new CombatAudio(hostWith({ kagariai_audio_volume: '0' })).volume, 0);
});

test('音響ON/OFFと音量は安全な範囲で永続化する', () => {
  const host = hostWith();
  const audio = new CombatAudio(host);
  assert.equal(audio.setEnabled(false), false);
  assert.equal(host.saved.get('kagariai_audio_enabled'), 'false');
  assert.equal(audio.setVolume(1.8), 1);
  assert.equal(host.saved.get('kagariai_audio_volume'), '1');
});

function runningAudio() {
  const audio = new CombatAudio(hostWith());
  audio.context = { state: 'running', currentTime: 10 };
  audio.played = [];
  audio._play = cue => audio.played.push(cue);
  return audio;
}

test('同じattackIdの散弾イベントは一度だけ鳴らす', () => {
  const audio = runningAudio();
  const shot = {
    type: 'shot', source: 'enemy', weaponId: 'hokuchi_scattergun',
    origin: [4, 2, 1.5], attackId: 'enemy:17',
  };

  audio.handleEvent(shot, { myId: 'me' });
  audio.handleEvent({ ...shot, pelletIndex: 1 }, { myId: 'me' });
  audio.handleEvent({ ...shot, pelletIndex: 2 }, { myId: 'me' });
  audio.handleEvent({ ...shot, attackId: 'enemy:18' }, { myId: 'me' });

  assert.equal(audio.played.length, 2);
  assert.equal(audio.diagnostics().coalescedShots, 2);
});

test('高RTTでもローカル予測銃声とサーバー確定銃声を二重再生しない', () => {
  const audio = runningAudio();

  audio.playLocalShot('asagi_survey_rifle', 'prediction:1');
  audio.context.currentTime += 0.34;
  audio.handleEvent({
    type: 'shot', source: 'me', weaponId: 'asagi_survey_rifle',
    origin: [0, 0, 1.5], attackId: 'me:31',
  }, { myId: 'me', rttMs: 280, interpMs: 100 });

  assert.equal(audio.played.length, 1, '予測音だけを残す');
  assert.equal(audio.diagnostics().predictedShotConfirms, 1);
});

test('通常音声に上限を設け、緊急キュー用のvoice枠を予約する', () => {
  const audio = new CombatAudio(hostWith());
  const normal = Array.from({ length: 40 }, () => ({ onended: null }));
  for (const node of normal) assert.equal(audio._trackVoice(node, 'normal'), true);
  assert.equal(audio._trackVoice({ onended: null }, 'normal'), false);

  const critical = Array.from({ length: 8 }, () => ({ onended: null }));
  for (const node of critical) assert.equal(audio._trackVoice(node, 'critical'), true);
  assert.equal(audio._trackVoice({ onended: null }, 'critical'), false);
  assert.deepEqual(audio.diagnostics().voices, { active: 48, normalLimit: 40, hardLimit: 48, dropped: 2 });

  normal[0].onended();
  assert.equal(audio.diagnostics().voices.active, 47);
});

test('preloadHero decodes every SSOT sample once and reuses the buffer cache', async () => {
  const fetched = [];
  const host = enableDeterministicIntegrity(hostWith());
  host.fetch = async url => {
    fetched.push(url);
    return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const assets = {
    getHeroAsset: id => id === 'asagi' ? {
      weapon: { audio: { runtimeUrl: `/client/assets/generated/audio/weapon.${VERIFIED_DIGEST.slice(0, 12)}.mp3`, sha256: VERIFIED_DIGEST, bytes: 16 } },
      abilities: {
        secondary: { audio: { runtimeUrl: `/client/assets/generated/audio/secondary.${VERIFIED_DIGEST.slice(0, 12)}.mp3`, sha256: VERIFIED_DIGEST, bytes: 16 } },
        ability1: { audio: { runtimeUrl: `/client/assets/generated/audio/ability1.${VERIFIED_DIGEST.slice(0, 12)}.mp3`, sha256: VERIFIED_DIGEST, bytes: 16 } },
        ability2: { audio: { runtimeUrl: `/client/assets/generated/audio/ability1.${VERIFIED_DIGEST.slice(0, 12)}.mp3`, sha256: VERIFIED_DIGEST, bytes: 16 } },
        ultimate: { audio: { runtimeUrl: `/client/assets/generated/audio/ultimate.${VERIFIED_DIGEST.slice(0, 12)}.mp3`, sha256: VERIFIED_DIGEST, bytes: 16 } },
      },
    } : null,
  };
  const audio = new CombatAudio(host, assets);
  let decoded = 0;
  audio.context = { decodeAudioData: async () => ({ id: ++decoded }) };

  await audio.preloadHero('asagi');
  await audio.preloadHero('asagi');

  assert.deepEqual(fetched.sort(), [
    `/client/assets/generated/audio/ability1.${VERIFIED_DIGEST.slice(0, 12)}.mp3`,
    `/client/assets/generated/audio/secondary.${VERIFIED_DIGEST.slice(0, 12)}.mp3`,
    `/client/assets/generated/audio/ultimate.${VERIFIED_DIGEST.slice(0, 12)}.mp3`,
    `/client/assets/generated/audio/weapon.${VERIFIED_DIGEST.slice(0, 12)}.mp3`,
  ]);
  assert.equal(decoded, 4);
  assert.equal(audio.diagnostics().samples.ready, 4);
  assert.equal(audio.diagnostics().samples.failed, 0);
});

test('tampered SSOT audio is rejected before decode and recorded as a failed sample', async () => {
  const host = enableDeterministicIntegrity(hostWith());
  host.fetch = async () => ({ ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(16) });
  const url = '/client/assets/generated/audio/tampered.222222222222.mp3';
  const audio = new CombatAudio(host, {
    getHeroAsset: () => ({
      weapon: { audio: { runtimeUrl: url, sha256: '22'.repeat(32), bytes: 16 } },
      abilities: {},
    }),
  });
  let decoded = 0;
  audio.context = { decodeAudioData: async () => { decoded++; } };

  await audio.preloadHero('zairu');

  assert.equal(decoded, 0);
  assert.equal(audio.diagnostics().samples.ready, 0);
  assert.equal(audio.diagnostics().samples.failed, 1);
});
