import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HERO_BY_ID } from '../shared/data/heroes.js';
import { pushBounded, ReusableEffectPool } from '../client/bounded_pool.js';
import { PerformanceBudget, copyRendererInfo } from '../client/performance_budget.js';

function loadRenderModule({
  GLTFLoader = class {}, verifyAuthoredAssetIdentity = async () => ({}),
  getActionAsset = () => null, getHeroAsset = () => null,
  createVerifiedObjectUrl = async () => { throw new Error('fixture not configured'); },
} = {}) {
  const file = new URL('../client/render.js', import.meta.url);
  const source = readFileSync(file, 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export class SceneRenderer', 'class SceneRenderer');
  return new Function(
    'THREE',
    'HERO_BY_ID',
    'pushBounded',
    'ReusableEffectPool',
    'PerformanceBudget',
    'copyRendererInfo',
    'GLTFLoader',
    'verifyAuthoredAssetIdentity',
    'getActionAsset',
    'getHeroAsset',
    'createVerifiedObjectUrl',
    `${source}\nreturn {\n` +
      `  SceneRenderer,\n` +
      `  heroSilhouettes: typeof HERO_SILHOUETTES === 'undefined' ? null : HERO_SILHOUETTES,\n` +
      `  maxAbilityCues: typeof MAX_ABILITY_CUES === 'undefined' ? null : MAX_ABILITY_CUES,\n` +
      `};`,
  )(
    THREE, HERO_BY_ID, pushBounded, ReusableEffectPool, PerformanceBudget, copyRendererInfo,
    GLTFLoader, verifyAuthoredAssetIdentity, getActionAsset, getHeroAsset, createVerifiedObjectUrl,
  );
}

function makeBareRenderer(SceneRenderer) {
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.world = new THREE.Group();
  renderer.scene = new THREE.Scene();
  renderer.playerVisuals = new Map();
  renderer.zoneVisuals = new Map();
  renderer.barrierVisuals = new Map();
  renderer.projectileVisuals = new Map();
  renderer.abilityCues = [];
  renderer.tracers = [];
  renderer._playerPositions = new Map();
  renderer._reducedMotion = false;
  renderer._effectTime = 0;
  renderer.flashLight = { intensity: 0 };
  renderer.camera = new THREE.PerspectiveCamera();
  renderer._viewWeaponHeroId = null;
  renderer._viewWeapon = null;
  renderer._weaponRecoil = 0;
  renderer.assetCatalog = { getActionAsset: () => null, getHeroAsset: () => null };
  renderer._abilityTextureCache = new Map();
  renderer._abilityTexturePromises = new Map();
  renderer._abilityTextureFailures = new Set();
  return renderer;
}

function equipPlayerRendering(renderer) {
  renderer._unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14);
  renderer._unitSphere = new THREE.SphereGeometry(1, 14, 10);
  renderer._teamMats = {};
  for (const [team, color] of [['ally', 0x35d5e8], ['enemy', 0xff9750]]) {
    renderer._teamMats[team] = {
      body: new THREE.MeshLambertMaterial({ color: 0xdde4e6, emissive: color }),
      outline: new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }),
      color,
    };
  }
  renderer._visorMat = new THREE.MeshBasicMaterial({ color: 0x20262a });
  renderer._makeNameSprite = () => ({
    sprite: new THREE.Group(), canvas: {}, tex: { dispose() {} }, mat: { dispose() {} },
  });
  renderer._drawNameSprite = () => {};
}

test('all roster heroes have distinct non-color silhouette signatures', () => {
  const { heroSilhouettes } = loadRenderModule();
  assert.ok(heroSilhouettes);
  assert.deepEqual(Object.keys(heroSilhouettes).sort(), Object.keys(HERO_BY_ID).sort());

  const signatures = Object.values(heroSilhouettes).map(({ body, head, accessory }) =>
    `${body}|${head}|${accessory}`);
  assert.equal(new Set(signatures).size, 18);
});

test('setPlayers builds hero-specific geometry while retaining ally outlines', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  equipPlayerRendering(renderer);

  const players = Object.values(HERO_BY_ID).map((hero, index) => ({
    id: `player-${hero.id}`, heroId: hero.id, team: index % 2,
    pos: [index * 2, 0, 0], yaw: 0, alive: true, hp: hero.maxHp, maxHp: hero.maxHp,
    name: hero.id,
    shield: hero.id === 'zairu' ? 60 : 0,
    statuses: hero.id === 'zairu' ? [{ kind: 'slow', negative: true }] : [],
  }));
  renderer.setPlayers(players, 0, 600);

  assert.equal(renderer.playerVisuals.size, 18);
  const signatures = new Set();
  for (const hero of Object.values(HERO_BY_ID)) {
    const visual = renderer.playerVisuals.get(`player-${hero.id}`);
    assert.equal(visual.heroId, hero.id);
    signatures.add(visual.group.userData.silhouetteSignature);
    assert.ok(visual.group.getObjectByName('team-outline-body'));
    assert.ok(visual.group.getObjectByName(`hero-accessory-${visual.silhouette.accessory}`));
  }
  assert.equal(signatures.size, 18);
  assert.equal(renderer.playerVisuals.get('player-zairu').shield.visible, true);
  assert.equal(renderer.playerVisuals.get('player-zairu').statusRing.visible, true);
});

test('world effects reconcile zones, barrier faces, and projectile bodies by relation', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  assert.equal(typeof renderer.setWorldEffects, 'function');

  renderer.setWorldEffects({
    zones: [
      { id: 'za', team: 0, center: [1, 2, 0], radiusM: 4, kind: 'healing_trail' },
      { id: 'ze', team: 1, center: [6, 2, 0], radiusM: 5, kind: 'damage' },
    ],
    barriers: [{ id: 'be', team: 1, center: [3, 4, 0], radiusM: 2.5, hp: 150, maxHp: 300 }],
    projectiles: [
      { id: 'pa', team: 0, pos: [1, 1, 1], dir: [1, 0, 0] },
      { id: 'pb', team: 1, pos: [2, 1, 1], dir: [1, 0, 0], radiusM: 0.3 },
    ],
  }, 0);

  assert.equal(renderer.zoneVisuals.size, 2);
  assert.equal(renderer.barrierVisuals.size, 1);
  assert.equal(renderer.projectileVisuals.size, 2);
  assert.equal(renderer.projectileVisuals.get('pa').group.scale.x, 1, 'legacy snapshotは既定0.15m表示');
  assert.equal(renderer.projectileVisuals.get('pb').group.scale.x, 2, 'radiusMを表示スケールへ反映');
  const ally = renderer.zoneVisuals.get('za').group.userData;
  const enemy = renderer.zoneVisuals.get('ze').group.userData;
  assert.equal(ally.relation, 'ally');
  assert.equal(enemy.relation, 'enemy');
  assert.notEqual(ally.shape, enemy.shape);

  renderer.setWorldEffects({ zones: [], barriers: [], projectiles: [] }, 0);
  assert.equal(renderer.zoneVisuals.size, 0);
  assert.equal(renderer.barrierVisuals.size, 0);
  assert.equal(renderer.projectileVisuals.size, 0);
});

test('ability cues include cast telegraphs and stay in a disposable bounded pool', () => {
  const { SceneRenderer, maxAbilityCues } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  renderer._playerPositions.set('caster', { pos: [0, 0, 1], team: 0 });
  assert.equal(typeof renderer.spawnAbilityCue, 'function');

  renderer.spawnAbilityCue({
    type: 'ability_windup', player: 'caster', target: [8, 2, 0], castSec: 0.5,
  }, 0);
  const telegraph = renderer.abilityCues.at(-1);
  assert.equal(telegraph.group.userData.cueKind, 'cast');
  assert.ok(telegraph.group.children.some(child => child.isLine || child.isLineSegments));
  renderer._playerPositions.set('enemy-caster', { pos: [1, 0, 1], team: 1 });
  renderer.spawnAbilityCue({
    type: 'ability_windup', player: 'enemy-caster', target: [8, 2, 0], castSec: 0.5,
  }, 0);
  const enemyTelegraph = renderer.abilityCues.at(-1);
  assert.notEqual(telegraph.group.userData.shape, enemyTelegraph.group.userData.shape);

  for (let index = 0; index < maxAbilityCues + 20; index++) {
    renderer.spawnAbilityCue({ type: 'hit', target: 'caster', amount: index }, 1);
  }
  assert.equal(renderer.abilityCues.length, maxAbilityCues);
  assert.equal(renderer.world.children.filter(child => child.userData.cueKind).length, maxAbilityCues);

  renderer.update(10);
  assert.equal(renderer.abilityCues.length, 0);
  assert.equal(renderer.world.children.filter(child => child.userData.cueKind).length, 0);
});

test('ability cues consume and animate the action atlas selected by SSOT action ID', () => {
  const action = {
    id: 'toubyou',
    visual: {
      runtimeUrl: '/client/assets/generated/abilities/toubyou/toubyou.123456789abc.webp',
      grid: { rows: 4, cols: 4 },
    },
  };
  const { SceneRenderer } = loadRenderModule({ getActionAsset: id => id === action.id ? action : null });
  const renderer = makeBareRenderer(SceneRenderer);
  renderer.assetCatalog = { getActionAsset: id => id === action.id ? action : null, getHeroAsset: () => null };
  const base = new THREE.Texture();
  renderer._abilityTextureCache.set(action.visual.runtimeUrl, base);

  renderer.spawnAbilityCue({
    type: 'ability_used', player: 'caster', abilityId: action.id, pos: [2, 3, 0],
  }, 0);

  const cue = renderer.abilityCues.at(-1);
  assert.equal(cue.group.userData.actionAssetId, action.id);
  assert.ok(cue.group.children.some(child => child.isSprite));
  assert.equal(cue.atlas.frameCount, 16);
  const initialOffset = cue.atlas.texture.offset.clone();
  renderer.update(0.2);
  assert.notDeepEqual(cue.atlas.texture.offset.toArray(), initialOffset.toArray());
});

test('ability atlas bytes are integrity-verified before TextureLoader receives an object URL', async () => {
  const visual = {
    runtimeUrl: '/client/assets/generated/abilities/test/test.111111111111.webp',
    sha256: '11'.repeat(32),
    bytes: 32,
    grid: { rows: 4, cols: 4 },
  };
  const verified = [];
  let revoked = 0;
  const { SceneRenderer } = loadRenderModule({
    createVerifiedObjectUrl: async descriptor => {
      verified.push(descriptor);
      return { objectUrl: 'blob:verified-atlas', revoke: () => { revoked++; } };
    },
  });
  const renderer = makeBareRenderer(SceneRenderer);
  renderer._disposed = false;
  renderer._assetTextureLoader = {
    load(url, onLoad) {
      assert.equal(url, 'blob:verified-atlas');
      queueMicrotask(() => onLoad(new THREE.Texture()));
    },
  };

  const texture = await renderer._preloadAbilityAtlas(visual);

  assert.equal(verified.length, 1);
  assert.equal(verified[0], visual);
  assert.equal(revoked, 1);
  assert.equal(renderer._abilityTextureCache.get(visual.runtimeUrl), texture);
});

test('the existing tracer pool remains capped at 200', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  for (let index = 0; index < 220; index++) {
    renderer.spawnTracer([0, index, 1], [1, 0, 0], 10);
  }
  assert.equal(renderer.tracers.length, 200);
  assert.equal(renderer.world.children.length, 200);
});

test('particle pool reuses fixed GPU objects and exposes immutable pool metrics', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  renderer.performanceBudget = new PerformanceBudget({ fallbackMinSamples: 120 });
  renderer.renderer = { info: { memory: { geometries: 4, textures: 2 }, render: { calls: 9, triangles: 12 } } };

  renderer._spawnParticles([0, 0, 0], 0x35d5e8, 440, 3);
  assert.equal(renderer.particles.length, 420);
  assert.equal(renderer.world.children.length, 420);
  assert.equal(new Set(renderer.particles.map(particle => particle.geometry)).size, 1);

  renderer.update(1);
  assert.equal(renderer.particles.length, 0);
  renderer._spawnParticles([1, 0, 0], 0xff9750, 1, 3);
  assert.equal(renderer.world.children.length, 420);
  const snapshot = renderer.getPerformanceSnapshot();
  assert.equal(snapshot.pools.particles.capacity, 420);
  assert.equal(snapshot.pools.particles.peak, 420);
  assert.equal(snapshot.renderer.render.calls, 9);
  assert.ok(Object.isFrozen(snapshot));
});

test('verified authored decoration keeps canonical gameplay surfaces visible until renderer disposal', { timeout: 2000 }, async () => {
  const authoredModel = new THREE.Group();
  authoredModel.add(new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 6),
    new THREE.MeshBasicMaterial(),
  ));
  class StubGLTFLoader {
    async parseAsync() { return { scene: authoredModel }; }
  }
  let identityChecks = 0;
  const { SceneRenderer } = loadRenderModule({
    GLTFLoader: StubGLTFLoader,
    verifyAuthoredAssetIdentity: async () => { identityChecks++; },
  });
  const renderer = makeBareRenderer(SceneRenderer);
  renderer.renderer = {
    capabilities: { getMaxAnisotropy: () => 1 },
    dispose() {},
  };
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const texture = new THREE.Texture();
  let geometryDisposals = 0;
  let materialDisposals = 0;
  let textureDisposals = 0;
  geometry.addEventListener('dispose', () => { geometryDisposals++; });
  material.addEventListener('dispose', () => { materialDisposals++; });
  texture.addEventListener('dispose', () => { textureDisposals++; });
  renderer.canonicalMapPresentation = new THREE.Group();
  renderer.canonicalMapPresentation.add(new THREE.Mesh(geometry, material));
  renderer.world.add(renderer.canonicalMapPresentation);
  renderer._surfaceTextures = [texture];
  const water = {};
  const waterMaterial = {};
  renderer.water = water;
  renderer.waterMaterial = waterMaterial;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  try {
    const loaded = new Promise(resolve => {
      renderer._setAuthoredMapStatus = status => {
        renderer.authoredMapStatus = status;
        if (status === 'loaded' || status === 'fallback') resolve(status);
      };
    });
    renderer._loadAuthoredMap({
      url: '/client/assets/decoration.glb',
      title: 'Decoration',
      collision: false,
      collisionModel: 'decorative-only',
      transform: {
        scale: 1,
        scenePosition: [0, 0, 0],
        sourceBounds: { min: [-1, -2, -3], max: [1, 2, 3] },
      },
    });
    assert.equal(await loaded, 'loaded');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(identityChecks, 1);
  assert.equal(renderer.authoredMap, authoredModel);
  assert.equal(renderer.authoredMap.userData.collision, false);
  assert.equal(renderer.authoredMap.userData.decorativeOnly, true);
  assert.equal(renderer.authoredMap.userData.referenceOnly, true);
  assert.equal(renderer.authoredMap.visible, false,
    'unmatched reference geometry must not create visible surfaces that players can cross');
  assert.equal(renderer.canonicalMapPresentation.parent, renderer.world);
  assert.equal(renderer.canonicalMapPresentation.visible, true);
  assert.equal(geometryDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(textureDisposals, 0);
  assert.equal(renderer.water, water);
  assert.equal(renderer.waterMaterial, waterMaterial);

  renderer.dispose();
  renderer.dispose();
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(textureDisposals, 1);
  assert.equal(renderer.canonicalMapPresentation, null);
  assert.equal(renderer.water, null);
  assert.equal(renderer.waterMaterial, null);
});

test('canonical PBR bundles apply atomically while failed bundles keep procedural textures', async () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  renderer.renderer = {
    capabilities: { getMaxAnisotropy: () => 16 },
    dispose() {},
  };

  const tags = ['ground', 'slab', 'rim', 'wall', 'tower', 'cover'];
  const mats = Object.fromEntries(tags.map(tag => {
    const fallback = new THREE.Texture();
    return [tag, new THREE.MeshStandardMaterial({ map: fallback, roughness: 0.8 })];
  }));
  const fallbackMaps = Object.fromEntries(tags.map(tag => [tag, mats[tag].map]));
  renderer._surfaceTextures = Object.values(fallbackMaps);

  const requested = [];
  const disposalCounts = new Map();
  renderer._textureLoader = {
    load(url, onLoad, _onProgress, onError) {
      requested.push(url);
      queueMicrotask(() => {
        if (url.endsWith('/concrete/concrete_rough_1k.jpg')) {
          onError(new Error('fixture load failure'));
          return;
        }
        const texture = new THREE.Texture();
        disposalCounts.set(url, 0);
        texture.addEventListener('dispose', () => disposalCounts.set(url, disposalCounts.get(url) + 1));
        onLoad(texture);
      });
      return new THREE.Texture();
    },
  };

  await renderer._loadGameplayPbrMaterials(mats);

  assert.deepEqual(requested.sort(), [
    '/client/assets/materials/polyhaven/concrete/concrete_diff_1k.jpg',
    '/client/assets/materials/polyhaven/concrete/concrete_nor_gl_1k.jpg',
    '/client/assets/materials/polyhaven/concrete/concrete_rough_1k.jpg',
    '/client/assets/materials/polyhaven/concrete_floor_01/concrete_floor_01_diff_1k.jpg',
    '/client/assets/materials/polyhaven/concrete_floor_01/concrete_floor_01_nor_gl_1k.jpg',
    '/client/assets/materials/polyhaven/concrete_floor_01/concrete_floor_01_rough_1k.jpg',
  ]);
  for (const tag of ['ground', 'slab', 'rim']) {
    assert.notEqual(mats[tag].map, fallbackMaps[tag]);
    assert.equal(mats[tag].map, mats.ground.map);
    assert.equal(mats[tag].normalMap, mats.ground.normalMap);
    assert.equal(mats[tag].roughnessMap, mats.ground.roughnessMap);
    assert.equal(mats[tag].map.colorSpace, THREE.SRGBColorSpace);
    assert.equal(mats[tag].map.wrapS, THREE.RepeatWrapping);
    assert.equal(mats[tag].map.repeat.x, 12);
    assert.equal(mats[tag].map.anisotropy, 4);
  }
  for (const tag of ['wall', 'tower', 'cover']) {
    assert.equal(mats[tag].map, fallbackMaps[tag]);
    assert.equal(mats[tag].normalMap, null);
    assert.equal(mats[tag].roughnessMap, null);
  }
  for (const url of requested.filter(url => url.includes('/concrete/') && !url.endsWith('rough_1k.jpg'))) {
    assert.equal(disposalCounts.get(url), 1, `failed bundle texture leaked: ${url}`);
  }

  renderer.dispose();
  for (const url of requested.filter(url => url.includes('/concrete_floor_01/'))) {
    assert.equal(disposalCounts.get(url), 1, `successful PBR texture was not disposed once: ${url}`);
  }
});

test('map meshes render presentationSolids instead of an independent collision side channel', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  renderer.renderer = { dispose() {} };
  renderer._surfaceTextures = [];
  renderer._loadGameplayPbrMaterials = async () => [];
  renderer.map = {
    boundsM: { x: [-5, 5], y: [-4, 4] },
    presentationSolids: [{ min: [1, 2, 3], max: [3, 5, 7], tag: 'ground' }],
    solids: [{ min: [-50, -50, -50], max: [50, 50, 50], tag: 'wall' }],
  };

  renderer._buildMapMeshes();

  const gameplayBoxes = renderer.canonicalMapPresentation.children.filter(child =>
    child.isMesh && child.geometry?.type === 'BoxGeometry');
  assert.equal(gameplayBoxes.length, 1);
  assert.deepEqual(gameplayBoxes[0].geometry.parameters, {
    width: 2, height: 3, depth: 4, widthSegments: 1, heightSegments: 1, depthSegments: 1,
  });
  assert.deepEqual(gameplayBoxes[0].position.toArray(), [2, 3.5, 5]);

  renderer.dispose();
});

test('world nameplates stay readable by hiding at extreme camera distances', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  const makeVisual = () => ({
    group: { visible: true },
    sprite: { visible: true },
  });
  const close = makeVisual();
  const readable = makeVisual();
  const maxRange = makeVisual();
  const distant = makeVisual();
  const dead = makeVisual();
  dead.group.visible = false;
  renderer.playerVisuals.set('close', close);
  renderer.playerVisuals.set('readable', readable);
  renderer.playerVisuals.set('max-range', maxRange);
  renderer.playerVisuals.set('distant', distant);
  renderer.playerVisuals.set('dead', dead);
  renderer._playerPositions.set('close', { pos: [3.49, 0, 0] });
  renderer._playerPositions.set('readable', { pos: [3.5, 0, 0] });
  renderer._playerPositions.set('max-range', { pos: [42, 0, 0] });
  renderer._playerPositions.set('distant', { pos: [42.01, 0, 0] });
  renderer._playerPositions.set('dead', { pos: [10, 0, 0] });
  let renderCalls = 0;
  renderer.renderer = { render() { renderCalls++; } };

  renderer.render({ pos: [0, 0, 0], yaw: 0, pitch: 0 });

  assert.equal(close.sprite.visible, false);
  assert.equal(readable.sprite.visible, true);
  assert.equal(maxRange.sprite.visible, true);
  assert.equal(distant.sprite.visible, false);
  assert.equal(dead.sprite.visible, false);
  assert.equal(renderCalls, 1);
});

test('dispose releases every owned scene resource exactly once and is idempotent', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  const originalWindow = globalThis.window;
  globalThis.window = { removeEventListener() {} };

  const trackedBundle = () => {
    const counts = { geometry: 0, material: 0, texture: 0 };
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    geometry.addEventListener('dispose', () => { counts.geometry++; });
    material.addEventListener('dispose', () => { counts.material++; });
    texture.addEventListener('dispose', () => { counts.texture++; });
    return { counts, geometry, material };
  };

  try {
    renderer.scene.add(renderer.world, renderer.camera);
    renderer._motionQuery = { removeEventListener() {} };
    renderer._onResize = () => {};
    renderer._onMotionChange = () => {};
    renderer._particlePool = null;
    renderer._tracerPool = null;
    renderer.canonicalMapPresentation = null;
    renderer._surfaceTextures = [];

    const staticBundle = trackedBundle();
    renderer.world.add(new THREE.Mesh(staticBundle.geometry, staticBundle.material));

    const playerBundle = trackedBundle();
    const playerGroup = new THREE.Group();
    playerGroup.add(new THREE.Mesh(playerBundle.geometry, playerBundle.material));
    renderer.playerVisuals.set('player', { group: playerGroup });

    const weaponBundle = trackedBundle();
    renderer._viewWeapon = new THREE.Group();
    renderer._viewWeapon.add(new THREE.Mesh(weaponBundle.geometry, weaponBundle.material));
    renderer.camera.add(renderer._viewWeapon);

    const authoredBundle = trackedBundle();
    renderer.authoredMap = new THREE.Group();
    renderer.authoredMap.add(new THREE.Mesh(authoredBundle.geometry, authoredBundle.material));
    renderer.scene.add(renderer.authoredMap);

    const sharedBundle = trackedBundle();
    renderer.world.add(new THREE.Mesh(sharedBundle.geometry, sharedBundle.material));
    renderer.authoredMap.add(new THREE.Mesh(sharedBundle.geometry, sharedBundle.material));

    const surfaceTexture = new THREE.Texture();
    let surfaceTextureDisposals = 0;
    surfaceTexture.addEventListener('dispose', () => { surfaceTextureDisposals++; });
    renderer._surfaceTextures.push(surfaceTexture);

    let rendererDisposals = 0;
    renderer.renderer = { dispose() { rendererDisposals++; } };

    renderer.dispose();
    renderer.dispose();

    for (const bundle of [staticBundle, playerBundle, weaponBundle, authoredBundle, sharedBundle]) {
      assert.deepEqual(bundle.counts, { geometry: 1, material: 1, texture: 1 });
    }
    assert.equal(surfaceTextureDisposals, 1);
    assert.equal(rendererDisposals, 1);
    assert.equal(renderer.playerVisuals.size, 0);
    assert.equal(renderer.world.children.length, 0);
    assert.equal(renderer.camera.children.length, 0);
    assert.equal(renderer.scene.children.length, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('一人称武器は選択ヒーローに追従し、同じヒーローでは再構築しない', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  assert.equal(typeof renderer.setLocalHero, 'function');

  renderer.setLocalHero('asagi');
  const first = renderer._viewWeapon;
  assert.equal(first.userData.heroId, 'asagi');
  assert.equal(first.parent, renderer.camera);
  assert.ok(first.children.some(child => child.isMesh));

  renderer.setLocalHero('asagi');
  assert.equal(renderer._viewWeapon, first);
  renderer.setLocalHero('hokuchi');
  assert.notEqual(renderer._viewWeapon, first);
  assert.equal(renderer._viewWeapon.userData.heroId, 'hokuchi');
});

test('missing and unknown snapshot fields degrade safely with reduced motion', () => {
  const { SceneRenderer } = loadRenderModule();
  const renderer = makeBareRenderer(SceneRenderer);
  equipPlayerRendering(renderer);
  renderer._reducedMotion = true;

  assert.doesNotThrow(() => renderer.setPlayers(undefined, undefined, undefined));
  assert.doesNotThrow(() => renderer.setPlayers([
    null,
    { id: 'unknown', heroId: 'future-hero', alive: true, shield: 'invalid', statuses: null },
  ], 0));
  assert.equal(renderer.playerVisuals.get('unknown').heroId, 'unknown');

  assert.doesNotThrow(() => renderer.setWorldEffects({
    zones: [{}], barriers: [{}], projectiles: [{ position: [1] }],
  }, 0));
  assert.doesNotThrow(() => renderer.spawnAbilityCue(null, 0));
  const zone = renderer.zoneVisuals.get('zone:0');
  renderer.update(0.1);
  assert.equal(zone.pulseMaterials[0].opacity, zone.baseOpacities[0]);
});
