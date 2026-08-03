import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  applyKagariaiRoofRibLightingMode,
  createKagariaiRoofRibLookDevLights,
  createKagariaiRoofRibModel,
  setKagariaiRoofRibFinialDetached,
} from './createKagariaiRoofRibModel.js';

const params = new URLSearchParams(window.location.search);
const captureMode = params.get('capture') === '1';
if (captureMode) document.body.classList.add('capture');
const stage = document.querySelector('#stage');
const hud = document.querySelector('#hud');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#c9cbc8');
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 2.3;
controls.maxDistance = 7;
controls.target.set(0, 0.28, 0);
const lookDevLights = createKagariaiRoofRibLookDevLights({ THREE });
scene.add(lookDevLights);
const textureLoader = new THREE.TextureLoader();
async function loadSurface(folder, stem) {
  const types = ['albedo', 'normal', 'roughness', 'ao'];
  const loaded = await Promise.all(types.map((type) => textureLoader.loadAsync(`./materials/${folder}/${stem}_${type}.png`)));
  const maps = Object.fromEntries(types.map((type, index) => [type, loaded[index]]));
  maps.albedo.colorSpace = THREE.SRGBColorSpace;
  for (const texture of loaded) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  maps.ao.channel = 0;
  return maps;
}
const usePbr = params.get('materials') !== '0';
const pbrTextures = usePbr ? {
  ceramic: await loadSurface('indigo-ceramic', 'indigo-ceramic'),
  copper: await loadSurface('oxidized-copper', 'oxidized-copper'),
  iron: await loadSurface('iron-joints', 'iron-joints'),
  brass: await loadSurface('aged-brass', 'aged-brass'),
} : undefined;
const model = createKagariaiRoofRibModel({ THREE, finial: 'right', pbrTextures });
scene.add(model);
window.reviewModel = model;

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 5),
  new THREE.MeshStandardMaterial({ color: '#bfc0bc', roughness: 0.94, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.01;
floor.receiveShadow = true;
floor.visible = !captureMode;
scene.add(floor);

const views = {
  front: [0, 0.52, 4.6],
  side: [4.3, 0.62, 0],
  'three-quarter': [-3.35, 1.12, 3.55],
  top: [0.2, 4.35, 0.55],
  'grazing-closeup': [0.58, 0.56, 1.18],
  'interaction-detail': [2.35, 1.0, 1.7],
};
function setView(name) {
  const view = views[name];
  if (!view) throw new Error(`ROOF_RIB_VIEW_UNKNOWN:${name}`);
  camera.position.set(...view);
  if (name === 'grazing-closeup') controls.target.set(0.58, 0.265, 0.02);
  else if (name === 'interaction-detail') controls.target.set(1.3, 0.5, 0.04);
  else controls.target.set(0, 0.3, 0);
  controls.update();
}
function setLighting(name) {
  applyKagariaiRoofRibLightingMode(lookDevLights, name);
  const profile = lookDevLights.userData.lightingProfile;
  renderer.toneMappingExposure = profile.exposure[name];
  scene.background.setHex(profile.background[name]);
  floor.material.color.setHex(name === 'reference' ? 0x8f837b : 0xbfc0bc);
}
setView(params.get('view') || 'three-quarter');

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => setView(button.dataset.view));
}

const runtime = {
  assetId: model.userData.assetModel.assetId,
  candidateOnly: true,
  collision: 'none',
  materialMode: usePbr ? 'reference-pbr-1024' : 'clay-map-stripped',
  performance: model.userData.assetModel.performance,
  renderer,
  setView,
  setLighting,
  setFloorVisible: (visible) => { floor.visible = Boolean(visible); },
  setFinialDetached: (detached) => {
    setKagariaiRoofRibFinialDetached(model, detached);
    return Boolean(detached);
  },
  getRenderer: () => renderer,
};
window.__KAGARIAI_MAP_PREVIEW__ = runtime;
document.documentElement.dataset.reviewReady = 'true';

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  const frame = renderer.info.render;
  runtime.render = { calls: frame.calls, triangles: frame.triangles, points: frame.points, lines: frame.lines };
  if (!captureMode) {
    const perf = model.userData.assetModel.performance;
    hud.innerHTML = [
      'status: blockout candidate',
      `asset triangles: ${Math.round(perf.triangles)} / 5000`,
      `asset draws: ${perf.drawCalls} / 8`,
      `browser calls: ${frame.calls}`,
      `browser triangles: ${frame.triangles}`,
      'collision: none',
    ].join('<br>');
  }
}
animate();
