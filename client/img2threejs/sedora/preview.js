import * as THREE from '/vendor/three.module.js';
import { createSedoraPlayableHeroModel, createSedoraPlayableHeroLookDevLights } from './createSedoraModel.js';

const query = new URLSearchParams(location.search);
const clean = query.get('clean') === '1' || query.get('capture') === '1';
const scene = new THREE.Scene();
scene.background = clean ? null : new THREE.Color(0x10151b);
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: clean, preserveDrawingBuffer: clean });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const model = createSedoraPlayableHeroModel();
scene.add(model, createSedoraPlayableHeroLookDevLights());

function visibleBounds(target) {
  target.updateMatrixWorld(true);
  const out = new THREE.Box3();
  target.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    if (o.geometry.boundingBox) out.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return out;
}
const bounds = visibleBounds(model);
model.position.y -= bounds.min.y;
const grounded = visibleBounds(model);
const center = grounded.getCenter(new THREE.Vector3());
const size = grounded.getSize(new THREE.Vector3());
const frameHeight = Math.max(size.y, size.x / camera.aspect) * 1.18;
const distance = (frameHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
camera.lookAt(center);
if (clean) document.getElementById('status').hidden = true;
else document.getElementById('status').textContent = `sedora ${model.userData.characterModel.performance.triangles} tris`;
document.documentElement.dataset.reviewReady = 'true';
document.documentElement.dataset.reviewContract = 'valid';
document.documentElement.dataset.reviewHeroId = 'sedora';
window.reviewModel = model;
window.reviewBounds = { min: grounded.min.toArray(), max: grounded.max.toArray(), size: size.toArray() };
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop(() => renderer.render(scene, camera));
