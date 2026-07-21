import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCombatCue, weaponSoundProfile } from '../client/audio_cues.js';

test('散弾・精密射撃・ビームは異なる武器音プロファイルを持つ', () => {
  const shotgun = weaponSoundProfile('hokuchi_scattergun');
  const precision = weaponSoundProfile('shirasagi_crystal_rifle');
  const beam = weaponSoundProfile('shirabe_string_beam');

  assert.equal(shotgun.family, 'shotgun');
  assert.equal(precision.family, 'precision');
  assert.equal(beam.family, 'beam');
  assert.ok(shotgun.bodyHz < precision.bodyHz);
  assert.notEqual(beam.wave, shotgun.wave);
});

test('遠隔射撃は発射位置を持つ空間音、本人射撃は中央の強い音になる', () => {
  const remote = describeCombatCue({
    type: 'shot', source: 'enemy', weaponId: 'hokuchi_scattergun', origin: [12, -4, 1.5],
  }, { myId: 'me' });
  const local = describeCombatCue({
    type: 'shot', source: 'me', weaponId: 'asagi_survey_rifle', origin: [0, 0, 1.5],
  }, { myId: 'me' });

  assert.equal(remote.kind, 'weapon');
  assert.equal(remote.spatial, true);
  assert.deepEqual(remote.position, [12, -4, 1.5]);
  assert.equal(local.spatial, false);
  assert.ok(local.gain > remote.gain);
});

test('命中確認・被弾・回復・必殺技は戦術上別のキューになる', () => {
  assert.equal(describeCombatCue({ type: 'hit', source: 'me', target: 'enemy' }, { myId: 'me' }).kind, 'hit_confirm');
  assert.equal(describeCombatCue({ type: 'hit', source: 'enemy', target: 'me' }, { myId: 'me' }).kind, 'damaged');
  assert.equal(describeCombatCue({ type: 'heal', target: 'me' }, { myId: 'me' }).kind, 'healed');
  const ultimate = describeCombatCue({ type: 'ultimate_used', player: 'enemy', pos: [8, 3, 0] }, { myId: 'me' });
  assert.equal(ultimate.kind, 'ultimate');
  assert.equal(ultimate.priority, 'critical');
});

test('描画専用または不明なイベントは音を生成しない', () => {
  assert.equal(describeCombatCue({ type: 'projectile_scattered' }, { myId: 'me' }), null);
  assert.equal(describeCombatCue({ type: 'future_event' }, { myId: 'me' }), null);
  assert.equal(describeCombatCue(null, { myId: 'me' }), null);
});

test('障壁・設置物イベントは共通posまたはcenterから空間位置を得る', () => {
  const barrier = describeCombatCue({ type: 'barrier_hit', center: [5, -3, 1] }, { myId: 'me' });
  const deployable = describeCombatCue({ type: 'deployable_hit', pos: [-2, 7, 0.8] }, { myId: 'me' });
  assert.equal(barrier.kind, 'barrier_hit');
  assert.deepEqual(barrier.position, [5, -3, 1]);
  assert.equal(deployable.kind, 'barrier_hit');
  assert.deepEqual(deployable.position, [-2, 7, 0.8]);
});

test('weapon and action cues carry SSOT sample URLs while procedural profiles remain fallback-safe', () => {
  const assets = {
    getWeaponAsset: id => id === 'asagi_survey_rifle'
      ? { audio: { runtimeUrl: '/client/assets/generated/audio/weapons/asagi.123456789abc.mp3' } }
      : null,
    getActionAsset: id => id === 'shirubeya'
      ? { audio: { runtimeUrl: '/client/assets/generated/audio/abilities/shirubeya.abcdef123456.mp3' } }
      : null,
  };
  const context = { myId: 'me', assets };

  const shot = describeCombatCue({ type: 'shot', source: 'me', weaponId: 'asagi_survey_rifle' }, context);
  assert.equal(shot.sampleUrl, '/client/assets/generated/audio/weapons/asagi.123456789abc.mp3');
  const ability = describeCombatCue({ type: 'ability_used', player: 'me', abilityId: 'shirubeya' }, context);
  assert.equal(ability.kind, 'ability');
  assert.equal(ability.sampleUrl, '/client/assets/generated/audio/abilities/shirubeya.abcdef123456.mp3');
  const ultimate = describeCombatCue({ type: 'ultimate_used', player: 'me', abilityId: 'shirubeya' }, context);
  assert.equal(ultimate.sampleUrl, '/client/assets/generated/audio/abilities/shirubeya.abcdef123456.mp3');
  assert.equal(describeCombatCue({ type: 'ability_used', player: 'me', abilityId: 'missing' }, context).sampleUrl, null);
});

test('SSOT WAV content type is exposed on weapon and action cue descriptors', () => {
  const wav = {
    runtimeUrl: '/client/assets/generated/audio/sample.123456789abc.wav',
    sha256: '12'.repeat(32),
    bytes: 44,
    contentType: 'audio/wav',
  };
  const assets = {
    getWeaponAsset: id => id === 'asagi_survey_rifle' ? { audio: wav } : null,
    getActionAsset: id => id === 'shirubeya' ? { audio: wav } : null,
  };
  const context = { myId: 'me', assets };

  const shot = describeCombatCue({ type: 'shot', source: 'me', weaponId: 'asagi_survey_rifle' }, context);
  const ability = describeCombatCue({ type: 'ability_used', player: 'me', abilityId: 'shirubeya' }, context);

  assert.equal(shot.sampleContentType, 'audio/wav');
  assert.equal(ability.sampleContentType, 'audio/wav');
});
