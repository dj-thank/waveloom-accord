// Three.js 描画: グレーボックスマップ / 目標円柱 / 回復灯珠 / 準備扉 /
// 他プレイヤー（カプセル+名前スプライト）/ トレーサー / マズルフラッシュ光
//
// 座標系: ゲームは右手系 x=東西, y=南北, z=上（PROTOCOL.md）。
// worldGroup.rotation.x = -π/2 により、worldGroup 内ではゲーム座標をそのまま使える。
// カメラは three ワールド座標 (gx, gz, -gy) に置き、rotation.y = yaw - π/2, rotation.x = pitch。

import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pushBounded, ReusableEffectPool } from '/client/bounded_pool.js';
import { PerformanceBudget, copyRendererInfo } from '/client/performance_budget.js';
import { HERO_BY_ID } from '/shared/data/heroes.js';
import { verifyAuthoredAssetIdentity } from '/shared/data/map_oshioi.js';
import { weaponMuzzlePosition } from '/shared/sim/combat.js';
import { createVerifiedObjectUrl } from '/client/runtime_asset_integrity.js';

const TAG_COLORS = {
  ground: 0xa18a66,
  slab: 0xb49a73,
  rim: 0xc1a47a,
  stair: 0xb99c73,
  cover: 0x7c5d40,
  wall: 0x93816a,
  spawnwall: 0x766858,
  tower: 0xc29a62,
  solid: 0x9a856d,
};

const GAMEPLAY_PBR_MATERIALS = Object.freeze([
  Object.freeze({
    id: 'concrete-floor',
    tags: Object.freeze(['ground', 'slab', 'rim']),
    baseUrl: '/client/assets/materials/polyhaven/concrete_floor_01',
    stem: 'concrete_floor_01',
    repeat: 12,
  }),
  Object.freeze({
    id: 'concrete-structure',
    tags: Object.freeze(['wall', 'tower', 'cover']),
    baseUrl: '/client/assets/materials/polyhaven/concrete',
    stem: 'concrete',
    repeat: 8,
  }),
]);

const ALLY_COLOR = 0x35d5e8;   // シアン系
const ENEMY_COLOR = 0xff9750;  // オレンジ系
const OBJ_NEUTRAL = 0xf2f4f4;
const OBJ_ALLY = 0x3fb4ff;
const OBJ_ENEMY = 0xff8a3c;
const OBJ_SEALED = 0xaab8bd;
const EFFECT_NEUTRAL = 0xe6edf0;
const MAX_WORLD_EFFECTS = 256;
const MAX_ABILITY_CUES = 96;
const MAX_PARTICLES = 420;
const MAX_TRACERS = 200;

// Silhouette components are deliberately redundant with hero color: color-blind
// and distant players can identify the full roster from shape alone.
const HERO_SILHOUETTES = Object.freeze({
  zairu: Object.freeze({ body: 'heavy', head: 'round', accessory: 'anchor' }),
  baraga: Object.freeze({ body: 'block', head: 'square', accessory: 'horns' }),
  vesta: Object.freeze({ body: 'tall', head: 'round', accessory: 'crown' }),
  nuedori: Object.freeze({ body: 'tapered', head: 'faceted', accessory: 'veil' }),
  sedora: Object.freeze({ body: 'block', head: 'round', accessory: 'pillars' }),
  shiomaneki: Object.freeze({ body: 'broad', head: 'round', accessory: 'claws' }),
  asagi: Object.freeze({ body: 'standard', head: 'round', accessory: 'scope' }),
  shirasagi: Object.freeze({ body: 'slim', head: 'faceted', accessory: 'wing' }),
  tsubakuro: Object.freeze({ body: 'slim', head: 'round', accessory: 'blades' }),
  hokuchi: Object.freeze({ body: 'broad', head: 'square', accessory: 'tank' }),
  botan: Object.freeze({ body: 'tapered', head: 'round', accessory: 'petals' }),
  ankou: Object.freeze({ body: 'standard', head: 'faceted', accessory: 'lure' }),
  tsuzuri: Object.freeze({ body: 'slim', head: 'round', accessory: 'needles' }),
  koyomi: Object.freeze({ body: 'standard', head: 'square', accessory: 'incense' }),
  karakasa: Object.freeze({ body: 'tapered', head: 'round', accessory: 'umbrella' }),
  shirabe: Object.freeze({ body: 'tall', head: 'faceted', accessory: 'strings' }),
  hibari: Object.freeze({ body: 'slim', head: 'faceted', accessory: 'flames' }),
  kazura: Object.freeze({ body: 'broad', head: 'faceted', accessory: 'vines' }),
});

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function safeVec3(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value)) return [...fallback];
  return [
    finiteNumber(value[0], fallback[0]),
    finiteNumber(value[1], fallback[1]),
    finiteNumber(value[2], fallback[2]),
  ];
}

const NAMEPLATE_MIN_DISTANCE_M = 3.5;
const NAMEPLATE_MAX_DISTANCE_M = 42;

function effectPosition(effect) {
  return safeVec3(effect?.center ?? effect?.pos ?? effect?.position ?? effect?.origin);
}

function effectRelation(team, myTeam) {
  if (team === undefined || team === null || myTeam === undefined || myTeam === null) return 'neutral';
  return team === myTeam ? 'ally' : 'enemy';
}

function effectColor(relation) {
  if (relation === 'ally') return ALLY_COLOR;
  if (relation === 'enemy') return ENEMY_COLOR;
  return EFFECT_NEUTRAL;
}

function boundedRadius(value, fallback = 1) {
  return Math.max(0.15, Math.min(100, finiteNumber(value, fallback)));
}

function applyAtlasFrame(texture, grid, frame) {
  if (!texture?.repeat?.set || !texture?.offset?.set) return;
  const rows = Math.max(1, Math.floor(finiteNumber(grid?.rows, 1)));
  const cols = Math.max(1, Math.floor(finiteNumber(grid?.cols, 1)));
  const count = rows * cols;
  const index = ((Math.floor(finiteNumber(frame, 0)) % count) + count) % count;
  const row = Math.floor(index / cols);
  const col = index % cols;
  texture.repeat.set(1 / cols, 1 / rows);
  texture.offset.set(col / cols, 1 - ((row + 1) / rows));
  texture.needsUpdate = true;
}

function makeSurfaceTexture(hex, variation = 0.12, seed = 1, repeat = 8) {
  const size = 64;
  const color = new THREE.Color(hex);
  const data = new Uint8Array(size * size * 4);
  let state = seed >>> 0;
  for (let index = 0; index < size * size; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const coarse = (((state >>> 8) & 0xffff) / 0xffff - 0.5) * variation;
    const x = index % size;
    const y = Math.floor(index / size);
    const grain = (Math.sin(x * 0.71) + Math.cos(y * 0.53)) * variation * 0.08;
    const multiplier = Math.max(0.55, 1 + coarse + grain);
    data[index * 4] = Math.min(255, color.r * 255 * multiplier);
    data[index * 4 + 1] = Math.min(255, color.g * 255 * multiplier);
    data[index * 4 + 2] = Math.min(255, color.b * 255 * multiplier);
    data[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function makeResourceRegistry() {
  return { geometries: new Set(), materials: new Set(), textures: new Set() };
}

function collectTextureValue(value, textures) {
  if (!value) return;
  if (value.isTexture) {
    textures.add(value);
    return;
  }
  if (Array.isArray(value)) value.forEach(item => collectTextureValue(item, textures));
}

function collectMaterialResources(material, registry) {
  if (!material?.isMaterial) return;
  registry.materials.add(material);
  for (const value of Object.values(material)) collectTextureValue(value, registry.textures);
  for (const uniform of Object.values(material.uniforms || {})) {
    collectTextureValue(uniform?.value, registry.textures);
  }
}

function collectResourceValue(value, registry) {
  if (!value) return;
  if (value.isBufferGeometry) registry.geometries.add(value);
  else if (value.isMaterial) collectMaterialResources(value, registry);
  else collectTextureValue(value, registry.textures);
}

function collectObjectResources(root, registry) {
  if (!root?.traverse) return;
  collectTextureValue(root.background, registry.textures);
  collectTextureValue(root.environment, registry.textures);
  collectMaterialResources(root.overrideMaterial, registry);
  root.traverse(object => {
    collectResourceValue(object.geometry, registry);
    if (Array.isArray(object.material)) {
      object.material.forEach(material => collectMaterialResources(material, registry));
    } else {
      collectMaterialResources(object.material, registry);
    }
    collectMaterialResources(object.customDepthMaterial, registry);
    collectMaterialResources(object.customDistanceMaterial, registry);
    collectTextureValue(object.skeleton?.boneTexture, registry.textures);
  });
}

function disposeResourceRegistry(registry) {
  registry.textures.forEach(texture => texture.dispose?.());
  registry.materials.forEach(material => material.dispose?.());
  registry.geometries.forEach(geometry => geometry.dispose?.());
}

function disposeObjectResources(root, additionalResources = []) {
  const registry = makeResourceRegistry();
  collectObjectResources(root, registry);
  additionalResources.forEach(resource => collectResourceValue(resource, registry));
  disposeResourceRegistry(registry);
}

export class SceneRenderer {
  constructor(canvas, map, assetCatalog = {}) {
    this.map = map;
    this.assetCatalog = assetCatalog;
    this._disposed = false;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.performanceBudget = new PerformanceBudget();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bcbd8);
    this.scene.fog = new THREE.FogExp2(0xa9d0d5, 0.0042);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // ゲーム座標系グループ
    this.world = new THREE.Group();
    this.world.rotation.x = -Math.PI / 2;
    this.scene.add(this.world);

    this._surfaceTextures = [];
    this._buildEnvironment();
    this._buildLights();
    this._applyQualityProfile(this.performanceBudget.quality);
    this._buildMapMeshes();
    this._loadAuthoredMap(this.map.visualAsset);
    this._buildEnvironmentProps();
    this._buildObjective();
    this._buildPickups();
    this._buildDoors();

    // プレイヤー表示
    this.playerVisuals = new Map(); // id -> visual
    this._unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14);
    this._unitSphere = new THREE.SphereGeometry(1, 14, 10);
    this._teamMats = {};
    for (const [team, color] of [['ally', ALLY_COLOR], ['enemy', ENEMY_COLOR]]) {
      this._teamMats[team] = {
        body: new THREE.MeshStandardMaterial({ color: 0xdde4e6, emissive: color, emissiveIntensity: 0.28, roughness: 0.45, metalness: 0.24 }),
        outline: new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, transparent: true, opacity: 0.85 }),
        color,
      };
    }
    this._visorMat = new THREE.MeshBasicMaterial({ color: 0x20262a });

    // トレーサー
    this.tracers = [];
    this._tracerPool = null;

    // Snapshot-backed and short-lived ability presentation.
    this.zoneVisuals = new Map();
    this.barrierVisuals = new Map();
    this.projectileVisuals = new Map();
    this.abilityCues = [];
    this.particles = [];
    this._particlePool = null;
    this._playerPositions = new Map();
    this._abilityTextureCache = new Map();
    this._abilityTexturePromises = new Map();
    this._abilityTextureFailures = new Set();
    this._assetTextureLoader = typeof THREE.TextureLoader === 'function' ? new THREE.TextureLoader() : null;
    this._effectTime = 0;
    this._viewWeaponHeroId = null;
    this._viewWeapon = null;
    this._weaponRecoil = 0;
    this._motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this._reducedMotion = !!this._motionQuery?.matches;
    this._onMotionChange = event => {
      this._reducedMotion = !!event.matches;
    };
    this._motionQuery?.addEventListener?.('change', this._onMotionChange);

    // マズルフラッシュ光
    this.flashLight = new THREE.PointLight(0xffe9b0, 0, 14, 2);
    this.scene.add(this.flashLight);

    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.performanceBudget.profile.dprCap));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this._onResize);
  }

  _applyQualityProfile(quality) {
    const changed = this.performanceBudget.setQuality(quality);
    const profile = this.performanceBudget.profile;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.dprCap));
    this.renderer.shadowMap.enabled = profile.shadows;
    if (this.sun?.shadow?.mapSize && profile.shadowMapSize > 0) {
      this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      this.sun.shadow.needsUpdate = true;
    }
    return changed;
  }

  setQualityProfile(quality) {
    if (!['low', 'medium', 'high'].includes(quality)) return false;
    const wasQuality = this.performanceBudget.quality;
    this._applyQualityProfile(quality);
    return this.performanceBudget.quality !== wasQuality;
  }

  _buildEnvironment() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 40, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x287fa8) },
          uHorizon: { value: new THREE.Color(0xc5e5e6) },
          uSunset: { value: new THREE.Color(0xffd19a) },
        },
        vertexShader: 'varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vDir; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunset; void main(){ float h=smoothstep(-0.15,0.75,vDir.y); float glow=pow(max(0.0,dot(vDir,normalize(vec3(0.45,0.62,-0.35)))),28.0); vec3 sky=mix(uHorizon,uTop,h); sky=mix(sky,uSunset,glow*0.48); gl_FragColor=vec4(sky,1.0); }',
      }),
    );
    this.scene.add(sky);
    this.sky = sky;

    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(7, 20, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff1c9, fog: false }),
    );
    sunDisc.position.set(145, 188, -115);
    this.scene.add(sunDisc);

    const haze = new THREE.Mesh(
      new THREE.CylinderGeometry(230, 230, 24, 64, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xcde7e5, transparent: true, opacity: 0.13, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    haze.position.y = 4;
    this.scene.add(haze);
  }

  _buildLights() {
    // 真昼の環礁: 空と海からの反射光 + 低い角度の太陽
    this.scene.add(new THREE.HemisphereLight(0xdff6ff, 0x7c684b, 1.55));
    const sun = new THREE.DirectionalLight(0xffe5bf, 3.4);
    sun.position.set(62, 105, -48);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -95;
    sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 95;
    sun.shadow.camera.bottom = -95;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.00022;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);
    this.sun = sun;
    this.scene.add(new THREE.AmbientLight(0xbdd9df, 0.18));
  }

  _boxMesh(b, material) {
    const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(dx, dy, dz), material);
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    return mesh;
  }

  _buildMapMeshes() {
    const canonicalMapPresentation = new THREE.Group();
    canonicalMapPresentation.name = 'canonical-gameplay-surfaces';
    this.world.add(canonicalMapPresentation);
    this.canonicalMapPresentation = canonicalMapPresentation;
    const mats = {};
    const properties = {
      ground: { roughness: 0.92, metalness: 0, variation: 0.18, repeat: 16 },
      cover: { roughness: 0.34, metalness: 0.62, variation: 0.1, repeat: 6 },
      tower: { roughness: 0.64, metalness: 0.08, variation: 0.12, repeat: 8 },
    };
    for (const [tag, color] of Object.entries(TAG_COLORS)) {
      const settings = properties[tag] || { roughness: 0.78, metalness: 0.04, variation: 0.09, repeat: 8 };
      const texture = makeSurfaceTexture(color, settings.variation, tag.length * 977 + color, settings.repeat);
      this._surfaceTextures.push(texture);
      mats[tag] = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: texture, roughness: settings.roughness, metalness: settings.metalness,
        emissive: color, emissiveIntensity: 0.075,
      });
    }
    this._pbrMaterialLoad = this._loadGameplayPbrMaterials(mats);
    const edgePositions = [];
    const presentationSolids = Array.isArray(this.map.presentationSolids)
      ? this.map.presentationSolids
      : this.map.solids;
    for (const b of presentationSolids) {
      const mesh = this._boxMesh(b, mats[b.tag] || mats.solid);
      mesh.receiveShadow = true;
      mesh.castShadow = b.tag !== 'ground';
      canonicalMapPresentation.add(mesh);
      if (b.tag !== 'ground') {
        // 輪郭線（グレーボックスの視認性向上）を1本のLineSegmentsへ統合
        const eg = new THREE.EdgesGeometry(mesh.geometry);
        const arr = eg.attributes.position.array;
        const [cx, cy, cz] = [mesh.position.x, mesh.position.y, mesh.position.z];
        for (let i = 0; i < arr.length; i += 3) {
          edgePositions.push(arr[i] + cx, arr[i + 1] + cy, arr[i + 2] + cz);
        }
        eg.dispose();
      }
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
    canonicalMapPresentation.add(new THREE.LineSegments(edgeGeo,
      new THREE.LineBasicMaterial({ color: 0x8d867b, transparent: true, opacity: 0.35 })));

    // 浅瀬の水面（視覚のみ・当たり判定なし）
    const [x0, x1] = this.map.boundsM.x, [y0, y1] = this.map.boundsM.y;
    this.waterMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(0x45c7c4) },
        uDeep: { value: new THREE.Color(0x176f91) },
        uSun: { value: new THREE.Color(0xffebbf) },
      },
      vertexShader: 'uniform float uTime; varying vec2 vUv; varying float vWave; void main(){ vUv=uv; vec3 p=position; float w=sin((p.x+p.y)*0.12+uTime*1.1)*0.07+sin(p.x*0.27-uTime*0.8)*0.035; p.z+=w; vWave=w; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }',
      fragmentShader: 'uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSun; varying vec2 vUv; varying float vWave; void main(){ float rip=sin((vUv.x*28.0+uTime)*2.1)*sin((vUv.y*31.0-uTime*0.7)*1.7); float foam=smoothstep(0.78,1.0,rip*0.5+0.5); vec3 c=mix(uDeep,uShallow,0.52+vWave*2.4); c=mix(c,uSun,foam*0.2); gl_FragColor=vec4(c,0.6); }',
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0, 48, 48), this.waterMaterial);
    water.position.set(0, 0, 0.14);
    water.receiveShadow = true;
    canonicalMapPresentation.add(water);
    this.water = water;
  }

  async _loadGameplayPbrMaterials(materials) {
    if (this._disposed) return GAMEPLAY_PBR_MATERIALS.map(() => false);
    const loader = this._textureLoader || new THREE.TextureLoader();
    const anisotropy = Math.min(4, this.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    const loadTexture = url => new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, error => reject(error || new Error(`Texture load failed: ${url}`)));
    });

    const loadBundle = async bundle => {
      const urls = [
        `${bundle.baseUrl}/${bundle.stem}_diff_1k.jpg`,
        `${bundle.baseUrl}/${bundle.stem}_nor_gl_1k.jpg`,
        `${bundle.baseUrl}/${bundle.stem}_rough_1k.jpg`,
      ];
      const results = await Promise.allSettled(urls.map(loadTexture));
      const loadedTextures = results
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
      const failed = results.find(result => result.status === 'rejected');
      const invalid = loadedTextures.length !== 3 || loadedTextures.some(texture => !texture?.isTexture);
      if (failed || invalid || this._disposed) {
        loadedTextures.forEach(texture => texture?.dispose?.());
        if ((failed || invalid) && !this._disposed) {
          const reason = failed?.reason?.message || failed?.reason || (invalid ? 'invalid texture bundle' : 'load failed');
          console.warn(`[map] ${bundle.id} PBR fallback: ${reason}`);
        }
        return false;
      }

      const [diffuse, normal, roughness] = loadedTextures;
      diffuse.colorSpace = THREE.SRGBColorSpace;
      normal.colorSpace = THREE.NoColorSpace;
      roughness.colorSpace = THREE.NoColorSpace;
      for (const texture of loadedTextures) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(bundle.repeat, bundle.repeat);
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
      }

      for (const tag of bundle.tags) {
        const material = materials[tag];
        if (!material) continue;
        material.map = diffuse;
        material.normalMap = normal;
        material.roughnessMap = roughness;
        material.roughness = 1;
        material.metalness = 0;
        material.needsUpdate = true;
      }
      this._surfaceTextures.push(...loadedTextures);
      return true;
    };

    return Promise.all(GAMEPLAY_PBR_MATERIALS.map(loadBundle));
  }

  _buildEnvironmentProps() {
    const [x0, x1] = this.map.boundsM.x;
    const [y0, y1] = this.map.boundsM.y;
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x776b5b, roughness: 0.93, metalness: 0.02 });
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, 72);
    const dummy = new THREE.Object3D();
    let state = 0x51f15e;
    for (let index = 0; index < 72; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const ratio = (state & 0xffff) / 0xffff;
      const side = index % 4;
      const margin = 4 + ((state >>> 16) & 7);
      const x = side < 2 ? x0 + (x1 - x0) * ratio : (side === 2 ? x0 + margin : x1 - margin);
      const y = side >= 2 ? y0 + (y1 - y0) * ratio : (side === 0 ? y0 + margin : y1 - margin);
      const scale = 0.28 + ((state >>> 24) / 255) * 0.9;
      dummy.position.set(x, y, 0.18 + scale * 0.25);
      dummy.rotation.set((state & 7) * 0.11, ((state >>> 4) & 15) * 0.2, ((state >>> 8) & 15) * 0.16);
      dummy.scale.set(scale * 1.3, scale, scale * 0.65);
      dummy.updateMatrix();
      rocks.setMatrixAt(index, dummy.matrix);
    }
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rocks.instanceMatrix.needsUpdate = true;
    this.canonicalMapPresentation.add(rocks);

    const lanternGeometry = new THREE.CylinderGeometry(0.16, 0.2, 0.52, 8);
    const lanternMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f4c2a, emissive: 0xffb64d, emissiveIntensity: 1.7, roughness: 0.45, metalness: 0.32,
    });
    const lanterns = new THREE.InstancedMesh(lanternGeometry, lanternMaterial, 18);
    for (let index = 0; index < 18; index++) {
      const angle = index * Math.PI * 2 / 18;
      const radius = this.map.objective.radiusM + 4.2;
      dummy.position.set(
        this.map.objective.center[0] + Math.cos(angle) * radius,
        this.map.objective.center[1] + Math.sin(angle) * radius,
        0.42,
      );
      dummy.rotation.set(0, 0, angle);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      lanterns.setMatrixAt(index, dummy.matrix);
    }
    lanterns.castShadow = true;
    lanterns.instanceMatrix.needsUpdate = true;
    this.canonicalMapPresentation.add(lanterns);
  }

  _setAuthoredMapStatus(status, detail = {}) {
    this.authoredMapStatus = status;
    if (typeof document !== 'undefined') document.documentElement.dataset.authoredMap = status;
    if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(`authored-map-${status}`, { detail }));
    }
  }

  _loadAuthoredMap(asset = {}) {
    const url = asset?.url;
    if (!url) {
      this._setAuthoredMapStatus('fallback', { reason: 'No authored map asset configured' });
      return;
    }
    if (asset.collision !== false) {
      this._setAuthoredMapStatus('fallback', { url, reason: 'Imported map assets must declare collision:false' });
      return;
    }
    this._setAuthoredMapStatus('loading', { url, title: asset.title });
    const loader = new GLTFLoader();
    fetch(url).then(async response => {
      if (!response.ok) throw new Error(`GLB request failed with HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      await verifyAuthoredAssetIdentity(bytes, asset);
      const resourcePath = url.slice(0, Math.max(0, url.lastIndexOf('/') + 1));
      return loader.parseAsync(bytes, resourcePath);
    }).then(gltf => {
      if (this._disposed) {
        disposeObjectResources(gltf?.scene);
        return;
      }
      try {
        const model = gltf?.scene;
        if (!model) throw new Error('GLB scene is empty');
        const transform = asset.transform;
        if (!transform || !(Number(transform.scale) > 0)
          || !Array.isArray(transform.scenePosition) || transform.scenePosition.length !== 3
          || !transform.scenePosition.every(Number.isFinite)
          || !Array.isArray(transform.sourceBounds?.min) || !Array.isArray(transform.sourceBounds?.max)) {
          throw new Error('Pinned authored map transform is invalid');
        }
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        if (!(size.x > 0 && size.y > 0 && size.z > 0)) throw new Error('GLB bounds are invalid');
        for (let axis = 0; axis < 3; axis++) {
          const sourceMin = Number(transform.sourceBounds.min[axis]);
          const sourceMax = Number(transform.sourceBounds.max[axis]);
          if (!Number.isFinite(sourceMin) || !Number.isFinite(sourceMax)
            || Math.abs(bounds.min.getComponent(axis) - sourceMin) > 1e-5
            || Math.abs(bounds.max.getComponent(axis) - sourceMax) > 1e-5) {
            throw new Error(`GLB bounds do not match collision manifest on axis ${axis}`);
          }
        }
        const scale = Number(transform.scale);
        model.scale.setScalar(scale);
        model.position.fromArray(transform.scenePosition);
        model.name = 'chicken-gun-fruzer-mine-authored-map';
        model.userData.collision = false;
        model.userData.decorativeOnly = true;
        // The supplied scene does not share the competitive blueprint. Keeping
        // opaque structural meshes visible would recreate walls that players can
        // walk through, so retain the verified bytes as a hidden reference only.
        model.userData.referenceOnly = true;
        model.visible = false;

        const anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy?.() || 1);
        let shadowCasters = 0;
        let meshCount = 0;
        model.traverse(object => {
          if (!object.isMesh) return;
          meshCount++;
          object.receiveShadow = true;
          const name = `${object.name} ${object.parent?.name || ''}`;
          object.castShadow = shadowCasters < 48 && /building|entrance|tower|fence|rock/i.test(name);
          if (object.castShadow) shadowCasters++;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!material) continue;
            material.envMapIntensity = 0.82;
            if (material.map) material.map.anisotropy = anisotropy;
            if (material.metalnessMap) material.metalnessMap.anisotropy = anisotropy;
            if (material.roughnessMap) material.roughnessMap.anisotropy = anisotropy;
          }
        });
        this.scene.add(model);
        this.authoredMap = model;
        // The verified GLB is a hidden reference. Authoritative gameplay surfaces
        // stay visible for the whole match and are released only by dispose().
        this._setAuthoredMapStatus('loaded', {
          url, title: asset.title, author: asset.author, license: asset.license,
          collisionModel: asset.collisionModel,
          displayMode: asset.displayMode || 'verified-reference-hidden',
          meshCount, scale,
          size: [size.x * scale, size.y * scale, size.z * scale],
        });
      } catch (error) {
        console.warn(`[map] authored map fallback: ${error?.message || error}`);
        this._setAuthoredMapStatus('fallback', { url, reason: String(error?.message || error) });
      }
    }).catch(error => {
      if (this._disposed) return;
      console.warn(`[map] authored map fallback: ${error?.message || error}`);
      this._setAuthoredMapStatus('fallback', { url, reason: String(error?.message || error) });
    });
  }

  _buildObjective() {
    const { center, radiusM, heightM } = this.map.objective;
    this.objMat = new THREE.MeshBasicMaterial({
      color: OBJ_SEALED, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radiusM, radiusM, heightM, 48, 1, true), this.objMat);
    cyl.rotation.x = Math.PI / 2;
    cyl.position.set(center[0], center[1], center[2] + heightM / 2);
    this.world.add(cyl);
    this.objCyl = cyl;

    this.objRingMat = new THREE.MeshBasicMaterial({
      color: OBJ_SEALED, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radiusM - 0.6, radiusM, 56), this.objRingMat);
    ring.position.set(center[0], center[1], center[2] + 0.06);
    this.world.add(ring);
  }

  _buildPickups() {
    this.pickupVisuals = new Map(); // id -> { group, light, baseZ }
    for (const pk of this.map.pickups) {
      const group = new THREE.Group();
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xaef7cf }),
      );
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xaef7cf, transparent: true, opacity: 0.25 }),
      );
      const light = new THREE.PointLight(0x9df0c0, 6, 7, 2);
      group.add(orb, halo, light);
      group.position.set(pk.pos[0], pk.pos[1], pk.pos[2] + 1.1);
      this.world.add(group);
      this.pickupVisuals.set(pk.id, { group, baseZ: pk.pos[2] + 1.1 });
    }
  }

  _buildDoors() {
    this.doorMeshes = [];
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8fd8ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const b of this.map.setupDoors) {
      const mesh = this._boxMesh(b, mat);
      mesh.visible = false;
      this.world.add(mesh);
      this.doorMeshes.push(mesh);
    }
  }

  setDoorsVisible(v) {
    for (const m of this.doorMeshes) m.visible = v;
  }

  setLocalHero(heroId) {
    const hero = HERO_BY_ID[heroId] || HERO_BY_ID.asagi;
    this.preloadHeroAssets(hero.id).catch(() => {});
    if (this._viewWeapon && this._viewWeaponHeroId === hero.id) return;
    if (this._viewWeapon) {
      this.camera.remove(this._viewWeapon);
      const geometries = new Set();
      const materials = new Set();
      this._viewWeapon.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach(geometry => geometry.dispose?.());
      materials.forEach(material => material.dispose?.());
    }

    const group = new THREE.Group();
    group.userData.heroId = hero.id;
    const color = new THREE.Color(hero.color);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color, roughness: 0.32, metalness: 0.68, emissive: color, emissiveIntensity: 0.16,
      depthTest: false, depthWrite: false,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x18232a, roughness: 0.5, metalness: 0.75, depthTest: false, depthWrite: false,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: hero.color, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false,
    });
    const add = (geometry, material, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.scale.set(...scale);
      mesh.renderOrder = 50;
      group.add(mesh);
      return mesh;
    };
    const type = hero.weapon.type;
    const long = type === 'charge' || type === 'guided_projectile' || type === 'ricochet_projectile';
    const wide = type === 'shotgun' || type === 'explosive' || type === 'explosive_heal';
    add(new THREE.BoxGeometry(long ? 0.18 : 0.24, wide ? 0.22 : 0.16, long ? 0.86 : 0.64), bodyMaterial, [0, 0, -0.18]);
    add(new THREE.CylinderGeometry(wide ? 0.08 : 0.045, wide ? 0.1 : 0.055, long ? 0.72 : 0.52, 10), darkMaterial, [0, 0.02, -0.78], [Math.PI / 2, 0, 0]);
    add(new THREE.BoxGeometry(0.09, 0.28, 0.2), darkMaterial, [0, -0.2, -0.05], [0.2, 0, 0]);
    if (type === 'beam' || type === 'charge' || type === 'healing_projectile') {
      add(new THREE.TorusGeometry(0.11, 0.022, 8, 20), glowMaterial, [0, 0.04, -0.52], [Math.PI / 2, 0, 0]);
    }
    if (type === 'melee' || type === 'hybrid_melee_projectile') {
      add(new THREE.ConeGeometry(0.11, 0.72, 6), bodyMaterial, [0, 0, -0.7], [Math.PI / 2, 0, 0]);
    }
    this._viewWeaponMuzzle = add(new THREE.SphereGeometry(0.055, 8, 6), glowMaterial, [0, 0.02, long ? -1.12 : -0.94]);
    this._viewWeaponMuzzle.visible = false;
    group.position.set(0.42, -0.34, -0.72);
    group.rotation.set(-0.08, -0.12, 0.02);
    group.scale.setScalar(0.9);
    this.camera.add(group);
    this._viewWeapon = group;
    this._viewWeaponHeroId = hero.id;
  }

  async preloadHeroAssets(heroId) {
    const hero = typeof this.assetCatalog?.getHeroAsset === 'function'
      ? this.assetCatalog.getHeroAsset(String(heroId || ''))
      : null;
    if (!hero) return [];
    const visuals = Object.values(hero.abilities || {}).map(action => action?.visual).filter(Boolean);
    return Promise.allSettled(visuals.map(visual => this._preloadAbilityAtlas(visual)));
  }

  _preloadAbilityAtlas(visual) {
    const url = visual?.runtimeUrl;
    if (typeof url !== 'string' || !url.startsWith('/client/assets/generated/')) return Promise.resolve(null);
    if (this._abilityTextureCache.has(url)) return Promise.resolve(this._abilityTextureCache.get(url));
    if (this._abilityTextureFailures.has(url) || !this._assetTextureLoader) return Promise.resolve(null);
    if (this._abilityTexturePromises.has(url)) return this._abilityTexturePromises.get(url);
    const promise = createVerifiedObjectUrl(visual, {
      host: globalThis,
      expectedContentType: 'image/webp',
      maxBytes: 8 * 1024 * 1024,
    }).then(verified => new Promise(resolve => {
      this._assetTextureLoader.load(verified.objectUrl, texture => {
        verified.revoke();
        if (this._disposed) {
          texture.dispose?.();
          resolve(null);
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        this._abilityTextureCache.set(url, texture);
        resolve(texture);
      }, undefined, () => {
        verified.revoke();
        this._abilityTextureFailures.add(url);
        resolve(null);
      });
    })).catch(() => {
      this._abilityTextureFailures.add(url);
      return null;
    }).finally(() => this._abilityTexturePromises.delete(url));
    this._abilityTexturePromises.set(url, promise);
    return promise;
  }

  _attachActionAtlas(group, materials, event, target, type) {
    const requestedId = event?.abilityId ?? event?.actionId;
    const action = typeof this.assetCatalog?.getActionAsset === 'function'
      ? this.assetCatalog.getActionAsset(String(requestedId || ''))
      : null;
    const visual = action?.visual;
    if (!visual) return null;
    this._preloadAbilityAtlas(visual).catch(() => {});
    const base = this._abilityTextureCache.get(visual.runtimeUrl);
    if (!base) return null;
    const texture = base.clone();
    const grid = visual.grid || { rows: 4, cols: 4 };
    applyAtlasFrame(texture, grid, 0);
    const material = new THREE.SpriteMaterial({
      map: texture, color: 0xffffff, transparent: true, opacity: 0.9,
      depthWrite: false, depthTest: true,
    });
    material.userData.baseOpacity = 0.9;
    materials.push(material);
    const sprite = new THREE.Sprite(material);
    const ultimate = type.includes('ultimate');
    sprite.position.set(target[0], target[1], target[2] + (ultimate ? 1.7 : 1.05));
    sprite.scale.setScalar(ultimate ? 5.2 : 2.8);
    sprite.renderOrder = 12;
    group.add(sprite);
    return {
      actionId: action.id,
      texture,
      grid,
      frameCount: Math.max(1, Math.floor(finiteNumber(grid.rows, 4)) * Math.floor(finiteNumber(grid.cols, 4))),
    };
  }

  setWorldEffects(worldEffects = {}, myTeam) {
    const effects = worldEffects && typeof worldEffects === 'object' ? worldEffects : {};
    this._syncWorldEffectMap(this.zoneVisuals, effects.zones, 'zone', myTeam);
    this._syncWorldEffectMap(this.barrierVisuals, effects.barriers, 'barrier', myTeam);
    this._syncWorldEffectMap(this.projectileVisuals, effects.projectiles, 'projectile', myTeam);
  }

  _syncWorldEffectMap(map, rawItems, type, myTeam) {
    const items = Array.isArray(rawItems) ? rawItems.slice(0, MAX_WORLD_EFFECTS) : [];
    const seen = new Set();
    for (let index = 0; index < items.length; index++) {
      if (!items[index] || typeof items[index] !== 'object') continue;
      const effect = items[index];
      const id = effect.id === undefined || effect.id === null ? `${type}:${index}` : String(effect.id);
      const relation = effectRelation(effect.team, myTeam);
      const kind = String(effect.kind ?? effect.effectKind ?? effect.type ?? 'unknown');
      const layout = type === 'barrier' && this._barrierEndpoints(effect) ? 'line' : 'ring';
      const signature = `${relation}:${kind}:${layout}`;
      seen.add(id);

      let visual = map.get(id);
      if (!visual || visual.signature !== signature) {
        if (visual) this._disposeEffectVisual(visual);
        if (type === 'zone') visual = this._makeZoneVisual(id, relation, kind);
        else if (type === 'barrier') visual = this._makeBarrierVisual(id, relation, kind, layout);
        else visual = this._makeProjectileVisual(id, relation, kind);
        visual.signature = signature;
        map.set(id, visual);
      }

      if (type === 'zone') this._updateZoneVisual(visual, effect);
      else if (type === 'barrier') this._updateBarrierVisual(visual, effect, layout);
      else this._updateProjectileVisual(visual, effect);
    }

    for (const [id, visual] of map) {
      if (seen.has(id)) continue;
      this._disposeEffectVisual(visual);
      map.delete(id);
    }
  }

  _makeZoneVisual(id, relation, kind) {
    const color = effectColor(relation);
    const group = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), ringMat);
    group.add(ring);

    const points = relation === 'enemy'
      ? [[-0.55, -0.55, 0.025], [0.55, 0.55, 0.025], [-0.55, 0.55, 0.025], [0.55, -0.55, 0.025]]
      : relation === 'ally'
        ? [[-0.62, 0, 0.025], [0.62, 0, 0.025], [0, -0.62, 0.025], [0, 0.62, 0.025]]
        : [[-0.45, 0, 0.025], [0, 0.45, 0.025], [0, 0.45, 0.025], [0.45, 0, 0.025], [0.45, 0, 0.025], [0, -0.45, 0.025], [0, -0.45, 0.025], [-0.45, 0, 0.025]];
    const markerGeo = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
    const markerMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.82 });
    group.add(new THREE.LineSegments(markerGeo, markerMat));
    group.userData = {
      effectType: 'zone', effectId: id, relation, kind,
      shape: relation === 'enemy' ? 'crossed-ring' : relation === 'ally' ? 'quartered-ring' : 'diamond-ring',
    };
    this.world.add(group);
    return { group, pulseMaterials: [ringMat, markerMat], baseOpacities: [0.3, 0.82] };
  }

  _updateZoneVisual(visual, effect) {
    const [x, y, z] = effectPosition(effect);
    const radius = boundedRadius(effect.radiusM ?? effect.radius, 1);
    visual.group.position.set(x, y, z + 0.04);
    visual.group.scale.set(radius, radius, 1);
    visual.group.visible = effect.active !== false && effect.alive !== false;
  }

  _barrierEndpoints(effect) {
    const start = effect?.start ?? effect?.from ?? effect?.a;
    const end = effect?.end ?? effect?.to ?? effect?.b;
    return Array.isArray(start) && Array.isArray(end) ? [safeVec3(start), safeVec3(end)] : null;
  }

  _makeBarrierVisual(id, relation, kind, layout) {
    const color = effectColor(relation);
    const group = new THREE.Group();
    const faceMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    if (layout === 'line') {
      const face = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 1), faceMat);
      face.position.z = 0.5;
      group.add(face);
      const edgeGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.5, 0, 0.02), new THREE.Vector3(0.5, 0, 0.02),
        new THREE.Vector3(-0.5, 0, 0.98), new THREE.Vector3(0.5, 0, 0.98),
      ]);
      group.add(new THREE.LineSegments(edgeGeo, edgeMat));
    } else {
      const face = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), faceMat);
      face.rotation.x = Math.PI / 2;
      face.position.z = 0.5;
      group.add(face);
      const edge = new THREE.Mesh(
        new THREE.RingGeometry(0.96, 1.02, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      );
      group.add(edge);
    }

    const markerPoints = relation === 'enemy'
      ? [[-0.35, -0.35, 1.01], [0.35, 0.35, 1.01], [-0.35, 0.35, 1.01], [0.35, -0.35, 1.01]]
      : [[-0.4, 0, 1.01], [0.4, 0, 1.01], [0, -0.4, 1.01], [0, 0.4, 1.01]];
    const markerGeo = new THREE.BufferGeometry().setFromPoints(markerPoints.map(point => new THREE.Vector3(...point)));
    group.add(new THREE.LineSegments(markerGeo, edgeMat));
    group.userData = {
      effectType: 'barrier', effectId: id, relation, kind,
      shape: `${layout}-${relation === 'enemy' ? 'cross-braced' : 'barred'}`,
    };
    this.world.add(group);
    return { group, faceMat, edgeMat };
  }

  _updateBarrierVisual(visual, effect, layout) {
    const height = boundedRadius(effect.heightM ?? effect.height, 2.8);
    if (layout === 'line') {
      const [start, end] = this._barrierEndpoints(effect);
      const dx = end[0] - start[0], dy = end[1] - start[1];
      const length = Math.max(0.2, Math.hypot(dx, dy));
      visual.group.position.set((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2);
      visual.group.rotation.z = Math.atan2(dy, dx);
      visual.group.scale.set(length, 1, height);
    } else {
      const [x, y, z] = effectPosition(effect);
      const radius = boundedRadius(effect.radiusM ?? effect.radius, 2.5);
      visual.group.position.set(x, y, z);
      visual.group.rotation.z = finiteNumber(effect.yaw, 0);
      visual.group.scale.set(radius, radius, height);
    }
    const maxHp = Math.max(1, finiteNumber(effect.maxHp, finiteNumber(effect.hp, 1)));
    const hpRatio = Math.max(0, Math.min(1, finiteNumber(effect.hp, maxHp) / maxHp));
    visual.faceMat.opacity = 0.12 + hpRatio * 0.2;
    visual.group.visible = effect.active !== false && effect.alive !== false && hpRatio > 0;
  }

  _makeProjectileVisual(id, relation, kind) {
    const color = effectColor(relation);
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshBasicMaterial({ color });
    if (relation === 'enemy') {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.8, 4), bodyMat);
      body.rotation.z = -Math.PI / 2;
      group.add(body);
    } else if (relation === 'ally') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.68, 8), bodyMat);
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bodyMat);
      nose.position.x = 0.36;
      group.add(body, nose);
    } else {
      group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.24), bodyMat));
    }
    const tailGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.05, 0, 0), new THREE.Vector3(-0.25, 0, 0),
    ]);
    const tailMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 });
    group.add(new THREE.Line(tailGeo, tailMat));
    group.userData = {
      effectType: 'projectile', effectId: id, relation, kind,
      shape: relation === 'enemy' ? 'diamond-bolt' : relation === 'ally' ? 'round-bolt' : 'octa-bolt',
    };
    this.world.add(group);
    return { group, bodyMat, tailMat };
  }

  _updateProjectileVisual(visual, effect) {
    const [x, y, z] = effectPosition(effect);
    visual.group.position.set(x, y, z);
    const dir = safeVec3(effect.dir ?? effect.direction ?? effect.vel ?? effect.velocity, [1, 0, 0]);
    const horizontal = Math.hypot(dir[0], dir[1]);
    const yaw = horizontal > 1e-6 ? Math.atan2(dir[1], dir[0]) : finiteNumber(effect.yaw, 0);
    const pitch = Math.atan2(dir[2], Math.max(1e-6, horizontal));
    visual.group.rotation.set(0, -pitch, yaw, 'ZYX');
    const radius = boundedRadius(effect.radiusM ?? effect.radius, 0.15);
    visual.group.scale.setScalar(Math.max(0.4, Math.min(5, radius / 0.15)));
    visual.group.visible = effect.active !== false && effect.alive !== false;
  }

  _disposeEffectVisual(visual) {
    if (!visual?.group) return;
    this.world.remove(visual.group);
    const geometries = new Set();
    const materials = new Set();
    visual.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  }

  spawnAbilityCue(rawEvent = {}, myTeam) {
    if (!rawEvent || typeof rawEvent !== 'object') return;
    const event = rawEvent;
    if (!Array.isArray(this.abilityCues)) this.abilityCues = [];
    if (!(this._playerPositions instanceof Map)) this._playerPositions = new Map();

    const type = String(event.type ?? event.kind ?? 'ability').toLowerCase();
    const cueKind = type.includes('windup') || type.includes('cast') || type.includes('telegraph')
      ? 'cast'
      : type.includes('projectile') || type.includes('deployable')
        ? 'projectile'
        : type.includes('kill')
          ? 'kill'
          : type.includes('hit')
            ? 'hit'
            : 'ability';
    const sourceId = event.source ?? event.player ?? event.ownerId ?? event.owner;
    const targetId = Array.isArray(event.target) ? null : (event.target ?? event.targetId);
    const sourceState = this._playerPositions.get(sourceId);
    const targetState = this._playerPositions.get(targetId);
    const origin = safeVec3(
      event.origin ?? event.start ?? event.from ?? sourceState?.pos,
      targetState?.pos ?? [0, 0, 0],
    );
    const targetValue = Array.isArray(event.target)
      ? event.target
      : event.targetPos ?? event.hitPos ?? event.end ?? event.to ?? event.pos ?? event.position ?? targetState?.pos;
    const target = safeVec3(targetValue, origin);
    const relation = effectRelation(event.team ?? sourceState?.team, myTeam);
    const color = effectColor(relation);
    const group = new THREE.Group();
    const materials = [];

    const addLine = (from, to, opacity = 0.9) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...from), new THREE.Vector3(...to),
      ]);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      material.userData.baseOpacity = opacity;
      materials.push(material);
      group.add(new THREE.Line(geometry, material));
    };
    const addRing = (position, radius, opacity = 0.72) => {
      const geometry = new THREE.RingGeometry(Math.max(0.05, radius * 0.72), radius, 36);
      const material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
      });
      material.userData.baseOpacity = opacity;
      materials.push(material);
      const ring = new THREE.Mesh(geometry, material);
      ring.position.set(...position);
      group.add(ring);
    };
    const addRelationMarker = (position, radius = 0.65, opacity = 0.86) => {
      const offsets = relation === 'enemy'
        ? [[-1, -1], [1, 1], [-1, 1], [1, -1]]
        : relation === 'ally'
          ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
          : [[-1, 0], [0, 1], [0, 1], [1, 0], [1, 0], [0, -1], [0, -1], [-1, 0]];
      const points = offsets.map(([dx, dy]) =>
        new THREE.Vector3(position[0] + dx * radius, position[1] + dy * radius, position[2] + 0.035));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      material.userData.baseOpacity = opacity;
      materials.push(material);
      group.add(new THREE.LineSegments(geometry, material));
    };

    let life = 0.55;
    if (cueKind === 'cast') {
      const castSec = Math.max(0.1, Math.min(4, finiteNumber(event.castSec ?? event.durationSec, 0.6)));
      life = castSec + 0.18;
      addLine(origin, target, 0.88);
      addRing(target, boundedRadius(event.radiusM ?? event.radius, 1.25), 0.66);
      addRelationMarker(target);
    } else if (cueKind === 'projectile') {
      life = Math.max(0.2, Math.min(1.5, finiteNumber(event.durationSec ?? event.life, 0.45)));
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      material.userData.baseOpacity = 0.95;
      materials.push(material);
      const geometry = relation === 'enemy'
        ? new THREE.OctahedronGeometry(0.22)
        : new THREE.SphereGeometry(0.18, 8, 6);
      const body = new THREE.Mesh(geometry, material);
      body.position.set(...target);
      group.add(body);
      addLine(origin, target, 0.68);
    } else if (cueKind === 'hit') {
      life = 0.34;
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, wireframe: true });
      material.userData.baseOpacity = 0.88;
      materials.push(material);
      const burstGeometry = relation === 'ally'
        ? new THREE.SphereGeometry(0.42, 8, 6)
        : relation === 'enemy'
          ? new THREE.OctahedronGeometry(0.48)
          : new THREE.TetrahedronGeometry(0.46);
      const burst = new THREE.Mesh(burstGeometry, material);
      burst.position.set(...target);
      group.add(burst);
    } else if (cueKind === 'kill') {
      life = 0.8;
      addRing(target, 1.15, 0.92);
      addRelationMarker(target, 0.82, 0.92);
      const p = target;
      addLine([p[0] - 0.75, p[1] - 0.75, p[2] + 0.1], [p[0] + 0.75, p[1] + 0.75, p[2] + 1.6], 0.92);
      addLine([p[0] - 0.75, p[1] + 0.75, p[2] + 1.6], [p[0] + 0.75, p[1] - 0.75, p[2] + 0.1], 0.92);
    } else {
      life = type.includes('ultimate') ? 1.05 : 0.6;
      addRing(target, boundedRadius(event.radiusM ?? event.radius, type.includes('ultimate') ? 2 : 1), 0.8);
      addRelationMarker(target, type.includes('ultimate') ? 1.15 : 0.62, 0.82);
      if (Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]) > 0.1) {
        addLine(origin, target, 0.72);
      }
    }

    const actionId = event.abilityId ?? event.actionId ?? null;
    group.userData = {
      cueKind, relation, sourceId, targetId,
      shape: `${cueKind}-${relation === 'enemy' ? 'angular-cross' : relation === 'ally' ? 'rounded-plus' : 'neutral-diamond'}`,
      actionAssetId: actionId,
    };
    const atlas = this._attachActionAtlas(group, materials, event, target, type);
    if (!atlas) group.userData.actionAssetId = null;
    this.world.add(group);
    const cue = { group, materials, life, maxLife: life, phase: this.abilityCues.length * 0.73, atlas };
    pushBounded(this.abilityCues, cue, MAX_ABILITY_CUES, oldCue => this._disposeEffectVisual(oldCue));
    const particleCount = this._reducedMotion ? 0
      : cueKind === 'kill' ? 18 : cueKind === 'hit' ? 7 : type.includes('ultimate') ? 14 : 4;
    if (particleCount > 0) this._spawnParticles(target, color, particleCount, cueKind === 'kill' ? 5.5 : 3.2);
  }

  _spawnParticles(position, color, count, speed) {
    this._ensureParticlePool();
    const origin = safeVec3(position);
    const budget = this.performanceBudget?.profile?.particleBudget ?? MAX_PARTICLES;
    for (let index = 0; index < count; index++) {
      const particle = this._particlePool.acquire(budget);
      if (!particle) break;
      const phase = (index + 1) * 2.399963 + this._effectTime * 1.7;
      const rise = 0.2 + ((index * 37) % 100) / 100;
      particle.mesh.position.set(...origin);
      particle.mesh.scale.setScalar(0.7 + rise * 1.1);
      particle.mesh.visible = true;
      particle.material.color.set(color);
      particle.material.opacity = 0.9;
      particle.velocity[0] = Math.cos(phase) * speed * (0.35 + rise * 0.45);
      particle.velocity[1] = Math.sin(phase) * speed * (0.35 + rise * 0.45);
      particle.velocity[2] = speed * (0.25 + rise * 0.65);
      particle.life = particle.maxLife = 0.35 + rise * 0.42;
    }
  }

  _ensureParticlePool() {
    if (this._particlePool) return;
    const geometry = new THREE.OctahedronGeometry(0.075, 0);
    this._particleGeometry = geometry;
    this._particlePool = new ReusableEffectPool(MAX_PARTICLES, () => {
      const material = new THREE.MeshBasicMaterial({
        color: EFFECT_NEUTRAL, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.world.add(mesh);
      return { mesh, material, geometry, velocity: [0, 0, 0], life: 0, maxLife: 0 };
    }, particle => {
      particle.mesh.visible = false;
      particle.life = 0;
    });
    this.particles = this._particlePool.active;
  }

  _disposeParticle(particle) {
    if (this._particlePool?.release(particle)) return;
    this.world.remove(particle?.mesh);
    particle?.geometry?.dispose?.();
    particle?.material?.dispose?.();
  }

  // objective 表示更新（毎フレーム）
  // view: { sealed, owner(-1/0/1), myTeam, contested, tSec }
  updateObjective(view = {}) {
    let color;
    if (view.sealed) color = OBJ_SEALED;
    else if (view.owner < 0) color = OBJ_NEUTRAL;
    else color = view.owner === view.myTeam ? OBJ_ALLY : OBJ_ENEMY;
    this.objMat.color.setHex(color);
    this.objRingMat.color.setHex(color);
    if (view.contested) {
      if (this._reducedMotion) {
        this.objMat.opacity = 0.22;
        this.objRingMat.opacity = 0.72;
      } else {
        const on = Math.sin(finiteNumber(view.tSec, 0) * Math.PI * 6) > 0;
        this.objMat.opacity = on ? 0.3 : 0.08;
        this.objRingMat.opacity = on ? 0.9 : 0.25;
      }
    } else {
      this.objMat.opacity = view.sealed ? 0.1 : 0.16;
      this.objRingMat.opacity = 0.55;
    }
  }

  updatePickups(pickups, tSec) {
    if (!Array.isArray(pickups)) return;
    for (const pk of pickups) {
      if (!pk || typeof pk !== 'object') continue;
      const v = this.pickupVisuals.get(pk.id);
      if (!v) continue;
      v.group.visible = !!pk.active;
      v.group.position.z = v.baseZ + (this._reducedMotion ? 0 : Math.sin(finiteNumber(tSec, 0) * 2.2) * 0.14);
    }
  }

  // ---- 他プレイヤー ----

  _makeNameSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.8, 0.45, 1);
    return { sprite, canvas, tex, mat };
  }

  _drawNameSprite(v, name, hp, maxHp, colorHex) {
    const ctx = v.nameCanvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(name, 128, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, 128, 30);
    // HPバー
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(48, 42, 160, 12);
    ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.fillRect(50, 44, 156 * Math.max(0, Math.min(1, hp / maxHp)), 8);
    v.nameTex.needsUpdate = true;
  }

  _makePlayerVisual(isAlly, requestedHeroId) {
    const mats = this._teamMats[isAlly ? 'ally' : 'enemy'];
    const hero = HERO_BY_ID[requestedHeroId] || null;
    const heroId = hero?.id || (HERO_SILHOUETTES[requestedHeroId] ? requestedHeroId : 'unknown');
    const silhouette = HERO_SILHOUETTES[heroId] || HERO_SILHOUETTES.asagi;
    const group = new THREE.Group();
    const ownedGeometries = [];
    const ownedMaterials = [];

    const bodyGeometry = this._heroBodyGeometry(silhouette.body);
    const headGeometry = silhouette.head === 'square'
      ? new THREE.BoxGeometry(2, 2, 2)
      : silhouette.head === 'faceted'
        ? new THREE.OctahedronGeometry(1)
        : new THREE.SphereGeometry(1, 14, 10);
    const visorGeometry = new THREE.BoxGeometry(0.16, 0.3, 0.12);
    ownedGeometries.push(bodyGeometry, headGeometry, visorGeometry);

    const heroColor = hero?.color || '#d9a441';
    const bodyMat = new THREE.MeshStandardMaterial({
      color: heroColor, emissive: mats.color, emissiveIntensity: 0.18, roughness: 0.46, metalness: 0.32,
    });
    const accentMat = new THREE.MeshBasicMaterial({ color: mats.color });
    ownedMaterials.push(bodyMat, accentMat);

    const outlineCyl = new THREE.Mesh(bodyGeometry, mats.outline);
    outlineCyl.name = 'team-outline-body';
    const body = new THREE.Mesh(bodyGeometry, bodyMat);
    body.name = 'hero-body';
    const outlineHead = new THREE.Mesh(headGeometry, mats.outline);
    outlineHead.name = 'team-outline-head';
    const head = new THREE.Mesh(headGeometry, bodyMat);
    head.name = 'hero-head';
    const visor = new THREE.Mesh(visorGeometry, this._visorMat);
    body.castShadow = body.receiveShadow = true;
    head.castShadow = head.receiveShadow = true;
    body.rotation.x = Math.PI / 2;
    outlineCyl.rotation.x = Math.PI / 2;
    group.add(outlineCyl, body, outlineHead, head, visor);

    const accessoryGroup = this._makeHeroAccessory(
      silhouette.accessory, bodyMat, accentMat, ownedGeometries,
    );
    accessoryGroup.name = `hero-accessory-${silhouette.accessory}`;
    group.add(accessoryGroup);

    const shieldGeometry = new THREE.SphereGeometry(1, 16, 10);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: mats.color, transparent: true, opacity: 0.18, wireframe: true, depthWrite: false,
    });
    ownedGeometries.push(shieldGeometry);
    ownedMaterials.push(shieldMat);
    const shield = new THREE.Mesh(shieldGeometry, shieldMat);
    shield.name = 'shield-shell';
    shield.visible = false;
    group.add(shield);

    const statusGeometry = new THREE.RingGeometry(0.42, 0.54, 24);
    const statusMat = new THREE.MeshBasicMaterial({
      color: 0xaef7cf, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false,
    });
    ownedGeometries.push(statusGeometry);
    ownedMaterials.push(statusMat);
    const statusRing = new THREE.Mesh(statusGeometry, statusMat);
    statusRing.name = 'status-marker';
    statusRing.visible = false;
    group.add(statusRing);

    const ns = this._makeNameSprite();
    group.add(ns.sprite);
    group.userData = {
      heroId,
      silhouetteSignature: `${silhouette.body}|${silhouette.head}|${silhouette.accessory}`,
    };

    this.world.add(group);
    return {
      group, body, outlineCyl, head, outlineHead, visor, accessoryGroup, shield, shieldMat, statusRing, statusMat,
      sprite: ns.sprite, nameCanvas: ns.canvas, nameTex: ns.tex, nameMat: ns.mat,
      lastHp: -1, lastName: '', color: mats.color, heroId, silhouette,
      ownedGeometries, ownedMaterials,
    };
  }

  _heroBodyGeometry(body) {
    if (body === 'block') return new THREE.BoxGeometry(2, 1, 2);
    if (body === 'tapered') return new THREE.ConeGeometry(1, 1, 10);
    if (body === 'heavy') return new THREE.CylinderGeometry(1, 0.82, 1, 8);
    if (body === 'tall') return new THREE.CylinderGeometry(0.72, 0.9, 1, 10);
    if (body === 'broad') return new THREE.CylinderGeometry(1, 1, 1, 6);
    if (body === 'slim') return new THREE.CylinderGeometry(0.68, 0.82, 1, 12);
    return new THREE.CylinderGeometry(1, 1, 1, 14);
  }

  _makeHeroAccessory(kind, bodyMat, accentMat, ownedGeometries) {
    const group = new THREE.Group();
    const add = (geometry, material, position, scale = [1, 1, 1], rotation = [0, 0, 0]) => {
      ownedGeometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      mesh.rotation.set(...rotation);
      group.add(mesh);
      return mesh;
    };
    const box = (position, scale, rotation = [0, 0, 0], material = accentMat) =>
      add(new THREE.BoxGeometry(1, 1, 1), material, position, scale, rotation);
    const cone = (position, scale, rotation = [Math.PI / 2, 0, 0], material = bodyMat, segments = 8) =>
      add(new THREE.ConeGeometry(1, 1, segments), material, position, scale, rotation);
    const orb = (position, scale, material = accentMat) =>
      add(new THREE.SphereGeometry(1, 8, 6), material, position, scale);

    switch (kind) {
      case 'anchor':
        box([-0.32, 0, 0.95], [0.08, 0.08, 0.7]);
        add(new THREE.TorusGeometry(0.25, 0.06, 6, 16, Math.PI * 1.55), accentMat, [-0.32, 0, 0.55], [1, 1, 1], [0, Math.PI / 2, -0.3]);
        break;
      case 'horns':
        cone([0, -0.24, 1.65], [0.1, 0.3, 0.1]);
        cone([0, 0.24, 1.65], [0.1, 0.3, 0.1]);
        break;
      case 'crown':
        for (const y of [-0.22, 0, 0.22]) cone([0, y, 1.9], [0.08, 0.22 + (y === 0 ? 0.08 : 0), 0.08]);
        break;
      case 'veil':
        add(new THREE.PlaneGeometry(0.75, 0.95), accentMat, [-0.18, 0, 1.22], [1, 1, 1], [Math.PI / 2, Math.PI / 2, 0]);
        break;
      case 'pillars':
        box([0, -0.48, 1.0], [0.18, 0.18, 1.05]);
        box([0, 0.48, 1.0], [0.18, 0.18, 1.05]);
        break;
      case 'claws':
        for (const y of [-0.3, 0.3]) cone([0.55, y, 0.9], [0.11, 0.5, 0.11], [0, 0, -Math.PI / 2]);
        break;
      case 'scope':
        add(new THREE.CylinderGeometry(1, 1, 1, 8), accentMat, [0.38, -0.16, 1.52], [0.09, 0.24, 0.09], [0, 0, Math.PI / 2]);
        break;
      case 'wing':
        cone([-0.18, -0.42, 1.2], [0.12, 0.7, 0.38], [0, 0, -0.55], accentMat, 3);
        cone([-0.18, 0.42, 1.2], [0.12, 0.7, 0.38], [0, 0, 0.55], accentMat, 3);
        break;
      case 'blades':
        box([-0.2, 0, 1.1], [0.08, 0.85, 0.08], [0.6, 0, 0.45]);
        box([-0.2, 0, 1.1], [0.08, 0.85, 0.08], [-0.6, 0, -0.45]);
        break;
      case 'tank':
        add(new THREE.CylinderGeometry(1, 1, 1, 10), bodyMat, [-0.38, 0, 0.95], [0.28, 0.72, 0.28], [Math.PI / 2, 0, 0]);
        break;
      case 'petals':
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5;
          orb([0, Math.cos(a) * 0.35, 1.56 + Math.sin(a) * 0.35], [0.08, 0.16, 0.08]);
        }
        break;
      case 'lure':
        box([0, 0, 1.93], [0.04, 0.04, 0.52]);
        orb([0.13, 0, 2.14], [0.13, 0.13, 0.13]);
        break;
      case 'needles':
        for (const y of [-0.22, 0, 0.22]) box([-0.3, y, 1.15], [0.04, 0.04, 0.9], [0, 0.15 + y, 0]);
        break;
      case 'incense':
        add(new THREE.TorusGeometry(0.28, 0.055, 6, 18), accentMat, [0.35, 0, 0.85], [1, 1, 1], [0, Math.PI / 2, 0]);
        orb([0.36, 0, 1.26], [0.07, 0.07, 0.07]);
        orb([0.32, 0, 1.48], [0.05, 0.05, 0.05]);
        break;
      case 'umbrella':
        cone([0, 0, 1.92], [0.62, 0.18, 0.62], [Math.PI / 2, 0, 0], bodyMat, 12);
        box([0, 0, 1.42], [0.04, 0.04, 0.72]);
        break;
      case 'strings':
        for (const y of [-0.28, 0, 0.28]) box([-0.3, y, 1.12], [0.035, 0.035, 1.25]);
        break;
      case 'flames':
        cone([-0.15, -0.32, 1.55], [0.14, 0.48, 0.14]);
        cone([-0.15, 0.32, 1.55], [0.14, 0.48, 0.14]);
        cone([-0.25, 0, 1.72], [0.17, 0.58, 0.17]);
        break;
      case 'vines':
        add(new THREE.TorusGeometry(0.38, 0.055, 6, 20, Math.PI * 1.45), accentMat, [0, 0, 1.02], [1, 1, 1], [0, Math.PI / 2, 0.4]);
        orb([-0.15, -0.38, 1.22], [0.12, 0.06, 0.18]);
        orb([-0.15, 0.38, 0.82], [0.12, 0.06, 0.18]);
        break;
      default:
        box([-0.25, 0, 1.1], [0.08, 0.35, 0.08]);
        break;
    }
    return group;
  }

  _poseVisual(v, crouch) {
    const bh = crouch ? 1.2 : 1.7;       // combat.movement stand/crouch
    const profile = {
      heavy: { radius: 0.48, height: 0.92 },
      block: { radius: 0.44, height: 0.9 },
      tall: { radius: 0.38, height: 1.04 },
      tapered: { radius: 0.44, height: 0.96 },
      broad: { radius: 0.5, height: 0.9 },
      slim: { radius: 0.34, height: 1.02 },
      standard: { radius: 0.4, height: 1 },
    }[v.silhouette?.body] || { radius: 0.4, height: 1 };
    const r = profile.radius;
    const cylH = bh - 0.5;
    v.body.scale.set(r, cylH * profile.height, r);
    v.body.position.set(0, 0, cylH / 2);
    v.outlineCyl.scale.set(r + 0.05, cylH * profile.height + 0.06, r + 0.05);
    v.outlineCyl.position.copy(v.body.position);
    const headR = v.silhouette?.head === 'square' ? 0.28 : v.silhouette?.head === 'faceted' ? 0.32 : 0.3;
    v.head.scale.set(headR, headR, headR);
    v.head.position.set(0, 0, bh - headR);
    v.outlineHead.scale.setScalar(headR + 0.05);
    v.outlineHead.position.copy(v.head.position);
    v.visor.position.set(headR + 0.04, 0, bh - headR);
    v.accessoryGroup.position.z = bh - 1.7;
    v.shield.position.set(0, 0, bh * 0.5);
    v.shield.scale.set(0.68, 0.68, bh * 0.62);
    v.statusRing.position.set(0, 0, 0.04);
    v.sprite.position.set(0, 0, bh + 0.65);
  }

  // players: [{id, name, team, pos:[x,y,z], yaw, crouch, hp, alive}] （自分は除外済み）
  setPlayers(players, myTeam, maxHp) {
    const seen = new Set();
    const list = Array.isArray(players) ? players : [];
    if (!(this._playerPositions instanceof Map)) this._playerPositions = new Map();
    for (let index = 0; index < list.length; index++) {
      if (!list[index] || typeof list[index] !== 'object') continue;
      const p = list[index];
      if (p.id === undefined || p.id === null) continue;
      const id = p.id;
      const heroId = typeof p.heroId === 'string' ? p.heroId : 'unknown';
      const pos = safeVec3(p.pos ?? p.position);
      seen.add(id);
      this._playerPositions.set(id, { pos, team: p.team });
      let v = this.playerVisuals.get(id);
      const isAlly = myTeam !== undefined && myTeam !== null && p.team === myTeam;
      if (!v || v.isAlly !== isAlly || v.heroId !== (HERO_BY_ID[heroId]?.id || 'unknown')) {
        if (v) this._disposeVisual(v);
        v = this._makePlayerVisual(isAlly, heroId);
        v.isAlly = isAlly;
        this.playerVisuals.set(id, v);
      }
      const alive = p.alive !== false;
      v.group.visible = alive;
      if (!alive) continue;
      v.group.position.set(...pos);
      v.group.rotation.z = finiteNumber(p.yaw, 0);
      this._poseVisual(v, !!p.crouch);
      this._updatePlayerEffects(v, p);
      const heroMaxHp = HERO_BY_ID[v.heroId]?.maxHp;
      const shownMaxHp = Math.max(1, finiteNumber(p.maxHp, finiteNumber(maxHp, finiteNumber(heroMaxHp, 250))));
      const hpInt = Math.round(finiteNumber(p.hp, shownMaxHp));
      const name = String(p.name ?? id ?? '?');
      if (hpInt !== v.lastHp || name !== v.lastName || shownMaxHp !== v.lastMaxHp) {
        v.lastHp = hpInt; v.lastName = name; v.lastMaxHp = shownMaxHp;
        this._drawNameSprite(v, name, hpInt, shownMaxHp, v.color);
      }
    }
    for (const [id, v] of this.playerVisuals) {
      if (!seen.has(id)) {
        this._disposeVisual(v);
        this.playerVisuals.delete(id);
        this._playerPositions.delete(id);
      }
    }
  }

  _updatePlayerEffects(v, player) {
    const shield = Math.max(0, finiteNumber(player.shield, 0));
    const maxHp = Math.max(1, finiteNumber(player.maxHp, HERO_BY_ID[v.heroId]?.maxHp || 250));
    v.shield.visible = shield > 0;
    v.shieldMat.opacity = 0.12 + Math.min(0.2, shield / maxHp * 0.4);

    const statuses = Array.isArray(player.statuses) ? player.statuses.filter(Boolean) : [];
    v.statusRing.visible = statuses.length > 0;
    if (statuses.length > 0) {
      const negative = statuses.some(status => status.negative === true || [
        'slow', 'oiled', 'hud_suppress', 'cast_delay',
      ].includes(status.kind));
      v.statusMat.color.setHex(negative ? 0xff5d68 : 0xaef7cf);
      v.statusRing.rotation.z = negative ? Math.PI / 4 : 0;
    }
  }

  _disposeVisual(v) {
    this.world.remove(v.group);
    v.nameTex?.dispose?.();
    v.nameMat?.dispose?.();
    for (const geometry of new Set(v.ownedGeometries || [])) geometry.dispose?.();
    for (const material of new Set(v.ownedMaterials || [])) material.dispose?.();
  }

  // ---- 射撃演出 ----

  spawnTracer(origin, dir, dist) {
    this._ensureTracerPool();
    const d = Math.max(0.5, Math.min(dist, 200));
    const budget = this.performanceBudget?.profile?.tracerBudget ?? MAX_TRACERS;
    const tracer = this._tracerPool.acquire(budget);
    if (!tracer) return;
    const positions = tracer.geo.attributes.position.array;
    positions[0] = origin[0]; positions[1] = origin[1]; positions[2] = origin[2];
    positions[3] = origin[0] + dir[0] * d;
    positions[4] = origin[1] + dir[1] * d;
    positions[5] = origin[2] + dir[2] * d;
    tracer.geo.attributes.position.needsUpdate = true;
    tracer.mat.opacity = 0.9;
    tracer.line.visible = true;
    tracer.life = 0.1;
  }

  _ensureTracerPool() {
    if (this._tracerPool) return;
    this._tracerPool = new ReusableEffectPool(MAX_TRACERS, () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      this.world.add(line);
      return { line, mat, geo, life: 0 };
    }, tracer => {
      tracer.line.visible = false;
      tracer.life = 0;
    });
    this.tracers = this._tracerPool.active;
  }

  _disposeTracer(tracer) {
    if (this._tracerPool?.release(tracer)) return;
    this.world.remove(tracer?.line);
    tracer?.geo?.dispose?.();
    tracer?.mat?.dispose?.();
  }

  getPerformanceSnapshot() {
    const profile = this.performanceBudget?.profile || { particleBudget: MAX_PARTICLES, tracerBudget: MAX_TRACERS };
    return this.performanceBudget?.snapshot({
      rendererInfo: copyRendererInfo(this.renderer?.info),
      pools: {
        particles: Object.freeze({
          active: this.particles?.length || 0,
          budget: profile.particleBudget,
          capacity: MAX_PARTICLES,
          peak: this._particlePool?.peak || 0,
        }),
        tracers: Object.freeze({
          active: this.tracers?.length || 0,
          budget: profile.tracerBudget,
          capacity: MAX_TRACERS,
          peak: this._tracerPool?.peak || 0,
        }),
      },
    }) || Object.freeze({});
  }

  dispose() {
    if (this._disposed) return false;
    this._disposed = true;

    globalThis.window?.removeEventListener?.('resize', this._onResize);
    this._motionQuery?.removeEventListener?.('change', this._onMotionChange);

    const registry = makeResourceRegistry();
    const roots = new Set();
    const addRoot = root => {
      if (root?.traverse) roots.add(root);
    };
    const addVisualMap = map => {
      for (const visual of map?.values?.() || []) addRoot(visual?.group || visual);
    };

    // Scene traversal covers normal ownership. Explicit roots cover resources
    // detached during teardown or held in free pools.
    addRoot(this.scene);
    addRoot(this.world);
    addRoot(this.camera);
    if (!this.canonicalMapPresentation?.userData?.disposed) addRoot(this.canonicalMapPresentation);
    addRoot(this.authoredMap);
    addRoot(this._viewWeapon);
    addVisualMap(this.zoneVisuals);
    addVisualMap(this.barrierVisuals);
    addVisualMap(this.projectileVisuals);
    addVisualMap(this.pickupVisuals);
    for (const cue of this.abilityCues || []) addRoot(cue?.group);
    for (const mesh of this.doorMeshes || []) addRoot(mesh);

    for (const visual of this.playerVisuals?.values?.() || []) {
      addRoot(visual?.group || visual);
      for (const geometry of visual?.ownedGeometries || []) collectResourceValue(geometry, registry);
      for (const material of visual?.ownedMaterials || []) collectResourceValue(material, registry);
      collectResourceValue(visual?.nameTex, registry);
      collectResourceValue(visual?.nameMat, registry);
    }

    for (const pool of [this._particlePool, this._tracerPool]) {
      const effects = new Set([...(pool?.active || []), ...(pool?.free || [])]);
      for (const effect of effects) {
        addRoot(effect?.mesh || effect?.line);
        collectResourceValue(effect?.geometry || effect?.geo, registry);
        collectResourceValue(effect?.material || effect?.mat, registry);
      }
    }

    for (const root of roots) collectObjectResources(root, registry);
    for (const resource of [
      this._unitCyl,
      this._unitSphere,
      this._visorMat,
      this.objMat,
      this.objRingMat,
      this._particleGeometry,
      this.waterMaterial,
      ...(this._surfaceTextures || []),
      ...(this._abilityTextureCache?.values?.() || []),
    ]) collectResourceValue(resource, registry);
    for (const teamMaterials of Object.values(this._teamMats || {})) {
      collectResourceValue(teamMaterials?.body, registry);
      collectResourceValue(teamMaterials?.outline, registry);
    }
    disposeResourceRegistry(registry);

    this.world?.clear?.();
    this.camera?.clear?.();
    this.scene?.clear?.();
    this.playerVisuals?.clear?.();
    this.zoneVisuals?.clear?.();
    this.barrierVisuals?.clear?.();
    this.projectileVisuals?.clear?.();
    this.pickupVisuals?.clear?.();
    this._playerPositions?.clear?.();
    this.abilityCues = [];
    this._particlePool = null;
    this._tracerPool = null;
    this.particles = [];
    this.tracers = [];
    this.doorMeshes = [];
    this._surfaceTextures = [];
    this._abilityTextureCache?.clear?.();
    this._abilityTexturePromises?.clear?.();
    this._abilityTextureFailures?.clear?.();
    this._viewWeapon = null;
    this._viewWeaponMuzzle = null;
    this.authoredMap = null;
    this.canonicalMapPresentation = null;
    this.water = null;
    this.waterMaterial = null;
    this._particleGeometry = null;
    this.renderer?.dispose?.();
    return true;
  }

  _disposePooledEffects(pool) {
    if (!pool) return;
    pool.releaseAll();
    const geometries = new Set();
    const materials = new Set();
    for (const effect of pool.free) {
      this.world.remove(effect.mesh || effect.line);
      geometries.add(effect.geometry || effect.geo);
      materials.add(effect.material || effect.mat);
    }
    geometries.forEach(geometry => geometry?.dispose?.());
    materials.forEach(material => material?.dispose?.());
    if (pool === this._particlePool) this._particleGeometry = null;
  }

  muzzleFlash(eyePos, yaw, pitch) {
    const [gx, gy, gz] = weaponMuzzlePosition(eyePos, yaw, pitch);
    this.flashLight.position.set(gx, gz, -gy); // three ワールド座標に変換
    this.flashLight.intensity = 22;
    this._weaponRecoil = 1;
    if (this._viewWeaponMuzzle) this._viewWeaponMuzzle.visible = true;
  }

  update(dt) {
    const delta = Math.max(0, finiteNumber(dt, 0));
    const fallbackQuality = this.performanceBudget?.recordFrameMs(delta * 1000);
    if (fallbackQuality) this._applyQualityProfile(fallbackQuality);
    this._effectTime = finiteNumber(this._effectTime, 0) + delta;
    if (this.waterMaterial?.uniforms?.uTime) this.waterMaterial.uniforms.uTime.value = this._effectTime;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= delta;
      if (t.life <= 0) {
        this._disposeTracer(t);
        if (!this._tracerPool) this.tracers.splice(i, 1);
      } else {
        t.mat.opacity = 0.9 * (t.life / 0.1);
      }
    }

    const zonePulse = this._reducedMotion ? 1 : 0.82 + Math.sin(this._effectTime * 5) * 0.18;
    for (const visual of this.zoneVisuals?.values?.() || []) {
      visual.pulseMaterials?.forEach((material, index) => {
        material.opacity = (visual.baseOpacities?.[index] ?? 1) * zonePulse;
      });
    }

    for (let i = this.abilityCues.length - 1; i >= 0; i--) {
      const cue = this.abilityCues[i];
      cue.life -= delta;
      if (cue.life <= 0) {
        this._disposeEffectVisual(cue);
        this.abilityCues.splice(i, 1);
        continue;
      }
      const remaining = Math.max(0, Math.min(1, cue.life / cue.maxLife));
      const blink = this._reducedMotion || cue.group.userData.cueKind !== 'cast'
        ? 1
        : 0.62 + Math.sin(this._effectTime * 18 + cue.phase) * 0.38;
      for (const material of cue.materials) {
        material.opacity = (material.userData.baseOpacity ?? 1) * remaining * blink;
      }
      if (cue.atlas) {
        const frame = Math.min(cue.atlas.frameCount - 1, Math.floor((1 - remaining) * cue.atlas.frameCount));
        applyAtlasFrame(cue.atlas.texture, cue.atlas.grid, frame);
      }
      if (!this._reducedMotion && cue.group.userData.cueKind === 'kill') {
        cue.group.rotation.z += delta * 1.8;
      }
    }
    if (!Array.isArray(this.particles)) this.particles = [];
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life -= delta;
      if (particle.life <= 0) {
        this._disposeParticle(particle);
        if (!this._particlePool) this.particles.splice(i, 1);
        continue;
      }
      particle.velocity[2] -= 5.5 * delta;
      particle.mesh.position.x += particle.velocity[0] * delta;
      particle.mesh.position.y += particle.velocity[1] * delta;
      particle.mesh.position.z += particle.velocity[2] * delta;
      particle.material.opacity = 0.9 * Math.max(0, particle.life / particle.maxLife);
    }
    if (this.flashLight.intensity > 0) {
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - delta * 260);
    }
    this._weaponRecoil = Math.max(0, finiteNumber(this._weaponRecoil, 0) - delta * 7.5);
    if (this._viewWeapon) {
      const idle = this._reducedMotion ? 0 : Math.sin(this._effectTime * 1.8) * 0.004;
      this._viewWeapon.position.set(0.42, -0.34 + idle - this._weaponRecoil * 0.025, -0.72 + this._weaponRecoil * 0.11);
      this._viewWeapon.rotation.set(-0.08 + this._weaponRecoil * 0.08, -0.12, 0.02 + idle * 0.6);
    }
    if (this._viewWeaponMuzzle && this._weaponRecoil < 0.68) this._viewWeaponMuzzle.visible = false;
  }

  // camPose: { pos:[gx,gy,gz]（目線のゲーム座標）, yaw, pitch }
  _updateNameplateVisibility(camPose) {
    const cameraPos = safeVec3(camPose?.pos);
    const minDistanceSq = NAMEPLATE_MIN_DISTANCE_M ** 2;
    const maxDistanceSq = NAMEPLATE_MAX_DISTANCE_M ** 2;
    for (const [id, visual] of this.playerVisuals) {
      if (!visual?.sprite) continue;
      const trackedPosition = this._playerPositions?.get(id)?.pos;
      if (!Array.isArray(trackedPosition) || visual.group?.visible === false) {
        visual.sprite.visible = false;
        continue;
      }
      const playerPos = safeVec3(trackedPosition);
      const dx = playerPos[0] - cameraPos[0];
      const dy = playerPos[1] - cameraPos[1];
      const dz = playerPos[2] - cameraPos[2];
      const distanceSq = dx * dx + dy * dy + dz * dz;
      visual.sprite.visible = distanceSq >= minDistanceSq && distanceSq <= maxDistanceSq;
    }
  }

  render(camPose) {
    this.camera.position.set(camPose.pos[0], camPose.pos[2], -camPose.pos[1]);
    this.camera.rotation.set(camPose.pitch, camPose.yaw - Math.PI / 2, 0);
    this._updateNameplateVisibility(camPose);
    this.renderer.render(this.scene, this.camera);
  }
}
