import * as THREE from '/vendor/three.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createShiomanekiPlayableHeroModel,
  createShiomanekiPlayableHeroLookDevLights,
} from './createShiomanekiModel.js';

const previewParams = new URLSearchParams(location.search);
const cleanCapture = previewParams.get('capture') === '1';
const scene = new THREE.Scene();
scene.background = cleanCapture ? null : new THREE.Color('#111820');
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 100);
const reviewView = previewParams.get('view') || 'front';
const reviewMode = previewParams.get('mode') || 'material';
const cleanReview = previewParams.get('clean') === '1';
if (cleanReview) document.getElementById('panel').hidden = true;
if (cleanCapture) {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}
const cameraPositions = {
  front: [0, 1.6, 7],
  rear: [0, 1.6, -7],
  left: [-4.6, 2.5, 6.2],
  right: [4.6, 2.5, 6.2],
};
camera.position.fromArray(cameraPositions[reviewView] || cameraPositions.front);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: cleanCapture,
  preserveDrawingBuffer: cleanCapture,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);

const model = createShiomanekiPlayableHeroModel({
  castShadow: true,
  receiveShadow: true,
  textureSize: 256,
  textureAnisotropy: 4,
});
model.userData.reviewLabel = 'shiomaneki-structure-review';
const clayMaterial = new THREE.MeshStandardMaterial({
  color: '#7c9aa0',
  roughness: 0.72,
  metalness: 0.08,
});
if (reviewMode === 'clay') {
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.material = clayMaterial;
  });
}
scene.add(model);
scene.add(createShiomanekiPlayableHeroLookDevLights('neutral'));

function visibleModelBounds(target) {
  target.updateMatrixWorld(true);
  const result = new THREE.Box3();
  const local = new THREE.Box3();
  target.traverse((object) => {
    if (!object.isMesh || !object.visible || !object.geometry) return;
    object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    local.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    result.union(local);
  });
  return result;
}

const bounds = visibleModelBounds(model);
model.position.y -= bounds.min.y;
bounds.copy(visibleModelBounds(model));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4.5, 64),
  new THREE.MeshStandardMaterial({ color: '#1c2930', roughness: .9, metalness: .05 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(8, 16, '#42616b', '#253b43');
grid.position.y = -0.015;
scene.add(grid);
ground.visible = !cleanCapture;
grid.visible = !cleanCapture;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.25, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 12;

const size = bounds.getSize(new THREE.Vector3());
const center = bounds.getCenter(new THREE.Vector3());
const reviewDirections = {
  front: new THREE.Vector3(0, 0.02, 1),
  rear: new THREE.Vector3(0, 0.02, -1),
  left: new THREE.Vector3(-0.62, 0.18, 0.78),
  right: new THREE.Vector3(0.62, 0.18, 0.78),
};
const reviewDirection = (reviewDirections[reviewView] || reviewDirections.front).normalize();
const frameHeight = Math.max(size.y, size.x / camera.aspect);
const cameraDistance = (frameHeight * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
camera.position.copy(center).addScaledVector(reviewDirection, cameraDistance);
camera.lookAt(center);
controls.target.copy(center);
controls.update();
document.getElementById('status').textContent =
  `ready · ${reviewMode} · bounds ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} · ${model.userData?.sculptRuntime ? 'runtime metadata OK' : 'runtime metadata missing'}`;
document.documentElement.dataset.reviewReady = 'true';
document.documentElement.dataset.reviewView = reviewView;
const runtimeMetadata = model.userData?.characterModel || model.userData?.sculptRuntime || {};
const requiredObjectNames = [
  ...Object.values(runtimeMetadata.pivots || {}),
  ...Object.values(runtimeMetadata.sockets || {}),
];
const missingRuntimeObjects = requiredObjectNames.filter((name) => !model.getObjectByName(name));
document.documentElement.dataset.reviewHeroId = model.userData?.heroId || '';
document.documentElement.dataset.reviewContract = missingRuntimeObjects.length === 0 ? 'valid' : 'invalid';
document.documentElement.dataset.reviewMissingObjects = missingRuntimeObjects.join(',');
document.documentElement.dataset.reviewTriangles = String(runtimeMetadata.performance?.triangles ?? '');
document.documentElement.dataset.reviewDrawCalls = String(runtimeMetadata.performance?.drawCalls ?? '');
document.documentElement.dataset.reviewTextures = String(runtimeMetadata.performance?.textures ?? '');
window.reviewModel = model;
window.reviewBounds = {
  min: bounds.min.toArray(),
  max: bounds.max.toArray(),
  size: size.toArray(),
  center: center.toArray(),
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
let captureStored = false;
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (cleanCapture && !captureStored) {
    captureStored = true;
    renderer.domElement.dataset.capturePng = renderer.domElement.toDataURL('image/png');
  }
});
