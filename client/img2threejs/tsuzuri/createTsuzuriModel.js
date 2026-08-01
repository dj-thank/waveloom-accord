import * as THREE from '/vendor/three.module.js';
import { createGeometryKit } from '../runtime/geometry_kit.js';
const { addMesh, addSocket, measureModelPerformance } = createGeometryKit(THREE);
const M = {
  gold: new THREE.MeshStandardMaterial({ color: 0xe3b34e, metalness: 0.5, roughness: 0.42 }),
  ivory: new THREE.MeshStandardMaterial({ color: 0xf4ead0, roughness: 0.78 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb84e4e, emissive: 0x401414, emissiveIntensity: 0.45, roughness: 0.55 }),
  ink: new THREE.MeshStandardMaterial({ color: 0x302b35, roughness: 0.75 }),
};
function mesh(parent, geometry, material, name, position, scale) { const n = addMesh(parent, geometry, material, name, position); if (scale) n.scale.fromArray(scale); return n; }
function pivot(root, name, p) { const n = new THREE.Group(); n.name = name; n.position.fromArray(p); n.userData.semanticPivot = name; root.add(n); return n; }
function tube(parent, name, a, b, r, material) { const s = new THREE.Vector3(...a), e = new THREE.Vector3(...b), d = e.clone().sub(s); const n = mesh(parent, new THREE.CylinderGeometry(r, r * 1.08, d.length(), 10), material, name, s.clone().add(e).multiplyScalar(0.5)); n.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return n; }
export function createTsuzuriPlayableHeroModel(options = {}) {
  const root = new THREE.Group(); root.name = 'tsuzuri_playable_hero'; root.userData.heroId = 'tsuzuri';
  const torso = pivot(root, 'pivot_torso', [0, 1.65, 0]);
  mesh(torso, new THREE.CapsuleGeometry(0.44, 0.92, 8, 16), M.ivory, 'tsuzuri_layered_robe', [0, 0, 0], [0.98, 1.05, 0.72]);
  mesh(torso, new THREE.CylinderGeometry(0.19, 0.23, 0.34, 16), M.gold, 'tsuzuri_chest_spool', [0, 0.18, 0.42], [1, 1, 0.8]);
  for (let i = -2; i <= 2; i += 1) tube(torso, `tsuzuri_red_thread_${i}`, [0, 0.28, 0.54], [i * 0.13, -0.5, 0.48], 0.012, M.red);
  const pelvis = pivot(root, 'pivot_pelvis', [0, 1.0, 0]);
  mesh(pelvis, new THREE.CylinderGeometry(0.48, 0.58, 0.45, 12), M.red, 'tsuzuri_robe_sash', [0, 0, 0], [1, 1, 0.8]);
  const head = pivot(root, 'pivot_head', [0, 2.47, 0]);
  mesh(head, new THREE.SphereGeometry(0.36, 20, 14), M.ivory, 'tsuzuri_calm_mask', [0, 0, 0.04], [0.96, 1.08, 0.78]);
  mesh(head, new THREE.BoxGeometry(0.18, 0.025, 0.06), M.ink, 'tsuzuri_mask_eyes', [0, 0.02, 0.31]);
  for (let i = -2; i <= 2; i += 1) {
    const needle = mesh(head, new THREE.CylinderGeometry(0.025, 0.025, 0.56, 8), M.gold, `tsuzuri_needle_crown_${i}`, [i * 0.1, 0.45, 0.02]);
    needle.rotation.z = i * 0.12;
  }
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? -1 : 1;
    const shoulder = pivot(root, `pivot_${side}_shoulder`, [s * 0.5, 2.03, 0]);
    mesh(shoulder, new THREE.SphereGeometry(0.22, 14, 10), M.ivory, `tsuzuri_${side}_shoulder`, [0, 0, 0]);
    const arm = pivot(root, `pivot_${side}_arm`, [s * 0.58, 1.85, 0.02]);
    mesh(arm, new THREE.CylinderGeometry(0.23, 0.32, 0.9, 12), M.ivory, `tsuzuri_${side}_wide_sleeve`, [0, -0.35, 0], [1, 1, 0.72]);
    mesh(arm, new THREE.SphereGeometry(0.12, 12, 8), M.ivory, `tsuzuri_${side}_long_sleeve_hand`, [s * 0.02, -0.85, 0.16]);
    const leg = pivot(root, `pivot_${side}_leg`, [s * 0.25, 0.78, 0]);
    mesh(leg, new THREE.CapsuleGeometry(0.2, 0.65, 8, 12), M.red, `tsuzuri_${side}_light_foot_leg`, [0, 0, 0]);
    mesh(leg, new THREE.SphereGeometry(0.2, 12, 8), M.gold, `tsuzuri_${side}_soft_sandal`, [0, -0.43, 0.2], [1.1, 0.38, 1.6]);
  }
  const fan = pivot(root, 'pivot_weapon_fan', [0.65, 1.42, 0.28]);
  for (let i = -2; i <= 2; i += 1) { const n = mesh(fan, new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8), M.gold, `tsuzuri_healing_needle_${i}`, [i * 0.08, 0.18, 0.1]); n.rotation.z = i * 0.22; }
  mesh(root, new THREE.TorusGeometry(0.17, 0.025, 8, 20), M.red, 'tsuzuri_thread_spool_ring', [0, 1.7, -0.52], [1, 1, 0.55]);
  const sockets = { weapon_primary: addSocket(root, 'socket_weapon_primary', [0.65, 1.42, 0.68]), hand_off: addSocket(root, 'socket_hand_off', [-0.58, 1.1, 0.22]), back_accessory: addSocket(root, 'socket_back_accessory', [0, 1.75, -0.62]), vfx_origin: addSocket(root, 'socket_vfx_origin', [0, 2.25, 0.25]) };
  const pivots = { root: root.name, head: 'pivot_head', torso: 'pivot_torso', pelvis: 'pivot_pelvis', leftShoulder: 'pivot_left_shoulder', rightShoulder: 'pivot_right_shoulder', leftArm: 'pivot_left_arm', rightArm: 'pivot_right_arm', leftLeg: 'pivot_left_leg', rightLeg: 'pivot_right_leg' };
  root.userData.characterModel = { schemaVersion: '1.0.0', heroId: 'tsuzuri', implementation: 'procedural-geometry-kit', coordinateSystem: 'three-y-up-front-positive-z', pivots, sockets: Object.fromEntries(Object.entries(sockets).map(([k, v]) => [k, v.name])), colliderHints: { body: { type: 'capsule', radius: 0.5, height: 2.25 }, spool: { type: 'sphere', radius: 0.2, separate: true } }, performance: { lod0TriangleBudget: 30000, mobileDrawCallBudget: 24 } };
  root.userData.characterModel.performance = { ...root.userData.characterModel.performance, ...measureModelPerformance(root) };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = options.castShadow ?? true; o.receiveShadow = options.receiveShadow ?? true; } });
  return root;
}
