import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OSHIOI_PRESENTATION } from '../../../shared/data/map_oshioi_presentation.js';
import { createKagariaiRoofRibReviewAdmission } from './runtimeAdmissionCandidate.js';
import {
  createKagariaiRoofRibMapReviewGroup,
  disposeKagariaiRoofRibRuntimeGroup,
} from './runtimeAdapter.js';

const params = new URLSearchParams(window.location.search);
if (params.get('capture') === '1') document.body.classList.add('capture');
const stage = document.querySelector('#stage');
const telemetry = document.querySelector('#telemetry');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9da8a4);
scene.fog = new THREE.FogExp2(0x9da8a4, 0.0065);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 103, 35);

const hemisphere = new THREE.HemisphereLight(0xcde0e5, 0x29322f, 1.0);
scene.add(hemisphere);
const key = new THREE.DirectionalLight(0xffe8c8, 3.0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
scene.add(key);
const rim = new THREE.DirectionalLight(0x79a9ca, 0.8);
scene.add(rim);

const textureLoader = new THREE.TextureLoader();
async function loadSurface(folder, stem) {
  const channels = ['albedo', 'normal', 'roughness', 'ao'];
  const loaded = await Promise.all(channels.map(channel => textureLoader.loadAsync(`./materials/${folder}/${stem}_${channel}.png`)));
  const maps = Object.fromEntries(channels.map((channel, index) => [channel, loaded[index]]));
  maps.albedo.colorSpace = THREE.SRGBColorSpace;
  for (const texture of loaded) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  return maps;
}

const pbrTextures = {
  ceramic: await loadSurface('indigo-ceramic', 'indigo-ceramic'),
  copper: await loadSurface('oxidized-copper', 'oxidized-copper'),
  iron: await loadSurface('iron-joints', 'iron-joints'),
  brass: await loadSurface('aged-brass', 'aged-brass'),
};
const admission = createKagariaiRoofRibReviewAdmission();
const reviewGroup = createKagariaiRoofRibMapReviewGroup({ THREE, admission, pbrTextures });
scene.add(reviewGroup);

const context = new THREE.Group();
context.name = 'review_map_context';
context.userData.collision = false;
const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x756f64, roughness: 0.92, metalness: 0 });
const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x253e52, roughness: 0.7, metalness: 0.04 });
const shellLayer = OSHIOI_PRESENTATION.layers.find(layer => layer.id === 'district-shells');
const roofLayer = OSHIOI_PRESENTATION.layers.find(layer => layer.id === 'district-hip-roofs');
const selectedSupports = new Set(admission.placements.map(placement => placement.support.transformIndex));
const selectedCenters = admission.placements.map(placement => placement.position.slice(0, 2));
for (const transform of shellLayer.transforms) {
  if (!selectedCenters.some(([x, y]) => Math.abs(x - transform.position[0]) < 1e-8 && Math.abs(y - transform.position[1]) < 1e-8)) continue;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shellMaterial);
  mesh.position.fromArray(transform.position);
  mesh.scale.fromArray(transform.scale);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData.collision = false;
  context.add(mesh);
}

function createHipRoofGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, 0.5, -0.5,  -0.5, 0.5, -0.5,
    -0.32, 0, 0.5,  0.32, 0, 0.5,
  ], 3));
  geometry.setIndex([
    0, 1, 5, 0, 5, 4,
    3, 4, 5, 3, 5, 2,
    0, 4, 3, 1, 2, 5,
    0, 3, 2, 0, 2, 1,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}
const hipGeometry = createHipRoofGeometry();
for (const index of selectedSupports) {
  const transform = roofLayer.transforms[index];
  const roof = new THREE.Mesh(hipGeometry, roofMaterial);
  roof.position.fromArray(transform.position);
  roof.scale.fromArray(transform.scale);
  roof.castShadow = true;
  roof.receiveShadow = true;
  roof.userData.collision = false;
  context.add(roof);
}
scene.add(context);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(360, 280),
  new THREE.MeshStandardMaterial({ color: 0x43524d, roughness: 0.97, metalness: 0 }),
);
ground.position.z = -0.03;
ground.receiveShadow = true;
ground.userData.collision = false;
scene.add(ground);

const siteByKey = {
  west: admission.placements[0],
  mid: admission.placements[1],
  east: admission.placements[2],
};
let activeSite = params.get('site') || 'west';
let activeDistance = Number(params.get('distance')) || 12;
let activeLight = params.get('light') || 'day';

function setCamera(site = activeSite, distance = activeDistance) {
  activeSite = site;
  activeDistance = distance;
  if (site === 'overview') {
    controls.target.set(-24, 103, 35);
    camera.position.set(-24, 8, 92);
  } else {
    const [x, y, z] = siteByKey[site].position;
    controls.target.set(x, y, z + 0.2);
    camera.position.set(x - distance * 0.72, y - distance * 0.62, z + distance * 0.42);
  }
  controls.update();
  updatePressed();
}

function setLighting(mode) {
  activeLight = mode;
  const target = activeSite === 'overview' ? [-24, 103, 35] : siteByKey[activeSite].position;
  if (mode === 'dusk') {
    scene.background.setHex(0x655f68); scene.fog.color.setHex(0x655f68); renderer.toneMappingExposure = 0.92;
    hemisphere.intensity = 0.5; key.color.setHex(0xff9f67); key.intensity = 3.4; rim.intensity = 1.25;
    key.position.set(target[0] - 24, target[1] - 18, target[2] + 14);
  } else if (mode === 'backlit') {
    scene.background.setHex(0xa3aaa5); scene.fog.color.setHex(0xa3aaa5); renderer.toneMappingExposure = 1.0;
    hemisphere.intensity = 0.7; key.color.setHex(0xffe0ae); key.intensity = 4.0; rim.intensity = 0.45;
    key.position.set(target[0] + 18, target[1] + 14, target[2] + 9);
  } else {
    scene.background.setHex(0x9da8a4); scene.fog.color.setHex(0x9da8a4); renderer.toneMappingExposure = 1.08;
    hemisphere.intensity = 1.0; key.color.setHex(0xffe8c8); key.intensity = 3.0; rim.intensity = 0.8;
    key.position.set(target[0] - 18, target[1] - 20, target[2] + 26);
  }
  key.target.position.fromArray(target);
  scene.add(key.target);
  rim.position.set(target[0] + 20, target[1] - 8, target[2] + 14);
  updatePressed();
}

function updatePressed() {
  for (const button of document.querySelectorAll('button')) {
    const selected = button.dataset.site === activeSite
      || Number(button.dataset.distance) === activeDistance
      || button.dataset.light === activeLight;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
}
for (const button of document.querySelectorAll('[data-site]')) button.addEventListener('click', () => setCamera(button.dataset.site, activeDistance));
for (const button of document.querySelectorAll('[data-distance]')) button.addEventListener('click', () => setCamera(activeSite === 'overview' ? 'west' : activeSite, Number(button.dataset.distance)));
for (const button of document.querySelectorAll('[data-light]')) button.addEventListener('click', () => setLighting(button.dataset.light));
setCamera(activeSite, activeDistance);
setLighting(activeLight);

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const reviewRuntime = {
  status: 'candidate-map-review',
  reviewOnly: true,
  productionEnabled: false,
  collision: 'none',
  placements: admission.placements.map(({ id, position, finial }) => ({ id, position, finial })),
  performanceWorstCase: admission.aggregateWorstCaseBudget,
  renderer,
  setSite: site => setCamera(site, activeDistance),
  setDistance: distance => setCamera(activeSite === 'overview' ? 'west' : activeSite, Number(distance)),
  setLighting,
  dispose: () => disposeKagariaiRoofRibRuntimeGroup(reviewGroup),
};
window.__KAGARIAI_ROOF_RIB_MAP_REVIEW__ = reviewRuntime;
Object.assign(document.documentElement.dataset, {
  reviewReady: 'true',
  candidateOnly: 'true',
  reviewOnly: 'true',
  productionEnabled: 'false',
  collision: 'none',
  placements: String(admission.placements.length),
  worstCaseTriangles: String(admission.aggregateWorstCaseBudget.triangles),
  worstCaseDrawCalls: String(admission.aggregateWorstCaseBudget.drawCalls),
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  const frame = renderer.info.render;
  reviewRuntime.render = { calls: frame.calls, triangles: frame.triangles, points: frame.points, lines: frame.lines };
  telemetry.innerHTML = [
    'status: candidate-map-review',
    `site: ${activeSite} / distance: ${activeDistance}m / light: ${activeLight}`,
    'production enabled: false',
    'collision: none',
    `placements: ${admission.placements.length}`,
    `worst-case asset: ${admission.aggregateWorstCaseBudget.triangles} tris / ${admission.aggregateWorstCaseBudget.drawCalls} DC`,
    `review frame: ${frame.triangles} tris / ${frame.calls} calls`,
  ].join('<br>');
}
animate();

window.addEventListener('pagehide', () => {
  reviewRuntime.dispose();
  renderer.dispose();
}, { once: true });
