// Static character-asset SSOT. Unlike generated hero image/audio metadata,
// this file is hand-reviewed and must stay content-addressed and fail-closed.
const animations = Object.freeze({
  idle: 'Idle',
  walk: 'Walking',
  run: 'Running',
  air: 'Jump',
  crouch: 'Sitting',
  fire: 'Punch',
  cast: 'Wave',
  death: 'Death',
});

export const HERO_RIG_ASSET = Object.freeze({
  id: 'robot-expressive-cc0',
  kind: 'third-person-articulated-base',
  runtimeUrl: '/client/assets/generated/characters/robot_expressive/RobotExpressive.047f5e5fb3bb.glb',
  sha256: '047f5e5fb3bb6d378bd1df16ca6137f2a596c99b3a1b5690b4020c05aaf6f319',
  bytes: 463988,
  contentType: 'model/gltf-binary',
  maxBytes: 1024 * 1024,
  animations,
  authors: Object.freeze([
    Object.freeze({ name: 'Tomas Laulhe', contribution: 'original model' }),
    Object.freeze({ name: 'Don McCurdy', contribution: 'glTF modifications' }),
  ]),
  sourceUrl: 'https://threejs.org/examples/models/gltf/RobotExpressive/',
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  licenseFile: '/client/assets/generated/characters/robot_expressive/LICENSE.txt',
});

export const HERO_RIG_ANIMATIONS = HERO_RIG_ASSET.animations;
