import * as THREE from '/vendor/three.module.js';
import { createGeometryKit } from '../runtime/geometry_kit.js';

const { addMesh, addSocket, measureModelPerformance } = createGeometryKit(THREE);
const M = {
  blue: new THREE.MeshStandardMaterial({ color: 0x4d6a90, roughness: 0.72 }),
  navy: new THREE.MeshStandardMaterial({ color: 0x18273b, roughness: 0.82 }),
  cyan: new THREE.MeshStandardMaterial({ color: 0x6ad4dc, emissive: 0x164b59, emissiveIntensity: 2.2, roughness: 0.3 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb68a42, metalness: 0.72, roughness: 0.3 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x101a29, roughness: 0.9 }),
};
function mesh(parent, geometry, material, name, position, scale) {
  const n = addMesh(parent, geometry, material, name, position);
  if (scale) n.scale.fromArray(scale);
  return n;
}
function pivot(root, name, position) { const p = new THREE.Group(); p.name = name; p.position.fromArray(position); p.userData.semanticPivot = name; root.add(p); return p; }
function tube(parent, name, a, b, radius, material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), d = end.clone().sub(start);
  const g = new THREE.CylinderGeometry(radius, radius * 1.08, d.length(), 10); const n = mesh(parent, g, material, name, start.clone().add(end).multiplyScalar(0.5));
  n.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return n;
}
export function createAnkouPlayableHeroModel(options = {}) {
  const root = new THREE.Group(); root.name = 'ankou_playable_hero'; root.userData.heroId = 'ankou';
  const torso = pivot(root, 'pivot_torso', [0, 1.48, 0]);
  mesh(torso, new THREE.CapsuleGeometry(0.5, 0.9, 8, 16), M.blue, 'ankou_diver_harness_torso', [0, 0, 0], [1.18, 1.0, 0.82]);
  mesh(torso, new THREE.BoxGeometry(0.82, 0.1, 0.7), M.brass, 'ankou_harness_chest_plate', [0, 0.25, 0.39]);
  tube(torso, 'ankou_harness_strap_l', [-0.38, 0.35, 0.37], [-0.2, -0.38, 0.37], 0.045, M.brass);
  tube(torso, 'ankou_harness_strap_r', [0.38, 0.35, 0.37], [0.2, -0.38, 0.37], 0.045, M.brass);
  const pelvis = pivot(root, 'pivot_pelvis', [0, 0.92, 0]); mesh(pelvis, new THREE.SphereGeometry(0.46, 16, 10), M.navy, 'ankou_low_pelvis', [0, 0, 0], [1.15, 0.62, 0.88]);
  const head = pivot(root, 'pivot_head', [0, 2.28, 0.02]);
  mesh(head, new THREE.SphereGeometry(0.4, 20, 14), M.navy, 'ankou_low_angler_head', [0, 0, 0], [1.12, 0.82, 0.96]);
  mesh(head, new THREE.SphereGeometry(0.12, 14, 10), M.cyan, 'ankou_glowing_lure', [0, 0.48, 0.46]);
  tube(head, 'ankou_lure_stalk', [0, 0.12, 0.08], [0, 0.48, 0.42], 0.045, M.brass);
  mesh(head, new THREE.ConeGeometry(0.12, 0.38, 8), M.rubber, 'ankou_face_guard', [0, -0.08, 0.35], [1.5, 1, 0.45]);
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? -1 : 1;
    const shoulder = pivot(root, `pivot_${side}_shoulder`, [s * 0.52, 1.82, 0]);
    mesh(shoulder, new THREE.SphereGeometry(0.22, 14, 10), M.blue, `ankou_${side}_shoulder`, [0, 0, 0]);
    const arm = pivot(root, `pivot_${side}_arm`, [s * 0.63, 1.58, 0.04]);
    tube(arm, `ankou_${side}_arm_sleeve`, [0, 0.2, 0], [s * 0.14, -0.52, 0.08], 0.16, M.blue);
    mesh(arm, new THREE.SphereGeometry(0.17, 12, 8), M.rubber, `ankou_${side}_glove`, [s * 0.15, -0.64, 0.12], [1, 0.72, 1.25]);
    if (side === 'left') {
      tube(arm, 'ankou_tether_hook', [s * 0.15, -0.62, 0.16], [s * 0.23, -0.64, 0.38], 0.035, M.brass);
      mesh(arm, new THREE.TorusGeometry(0.13, 0.03, 8, 16, Math.PI * 1.5), M.brass, 'ankou_tethered_hook', [s * 0.25, -0.64, 0.42], [1, 1, 1]);
    }
    const leg = pivot(root, `pivot_${side}_leg`, [s * 0.3, 0.72, 0]);
    tube(leg, `ankou_${side}_leg`, [0, 0.08, 0], [0, -0.55, 0.02], 0.22, M.navy);
    mesh(leg, new THREE.SphereGeometry(0.22, 14, 10), M.blue, `ankou_${side}_flipper_boot`, [0, -0.67, 0.2], [1.0, 0.55, 1.65]);
  }
  mesh(root, new THREE.ConeGeometry(0.16, 0.85, 12), M.brass, 'ankou_lure_harpoon', [0.76, 1.08, 0.48], [1, 1, 1]);
  const sockets = {
    weapon_primary: addSocket(root, 'socket_weapon_primary', [0.76, 1.08, 0.88]),
    hand_off: addSocket(root, 'socket_hand_off', [-0.5, 1.25, 0.2]),
    back_accessory: addSocket(root, 'socket_back_accessory', [0, 1.85, -0.5]),
    vfx_origin: addSocket(root, 'socket_vfx_origin', [0, 2.3, 0.35]),
  };
  const pivots = { root: root.name, head: 'pivot_head', torso: 'pivot_torso', pelvis: 'pivot_pelvis', leftShoulder: 'pivot_left_shoulder', rightShoulder: 'pivot_right_shoulder', leftArm: 'pivot_left_arm', rightArm: 'pivot_right_arm', leftLeg: 'pivot_left_leg', rightLeg: 'pivot_right_leg' };
  root.userData.characterModel = { schemaVersion: '1.0.0', heroId: 'ankou', implementation: 'procedural-geometry-kit', coordinateSystem: 'three-y-up-front-positive-z', pivots, sockets: Object.fromEntries(Object.entries(sockets).map(([k, v]) => [k, v.name])), colliderHints: { body: { type: 'capsule', radius: 0.58, height: 2.35 }, lure: { type: 'sphere', radius: 0.14, separate: true } }, performance: { lod0TriangleBudget: 30000, mobileDrawCallBudget: 24 } };
  root.userData.characterModel.performance = { ...root.userData.characterModel.performance, ...measureModelPerformance(root) };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = options.castShadow ?? true; o.receiveShadow = options.receiveShadow ?? true; } });
  return root;
}
