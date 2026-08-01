import * as THREE from '/vendor/three.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGeometryKit } from '../runtime/geometry_kit.js';

const { addMesh, addSocket, mergeStaticMeshesByMaterial, measureModelPerformance } = createGeometryKit(THREE, { mergeGeometries });
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .15, ...opts });
const tube = (parent, name, a, b, radius, material, segments = 12) => {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), axis = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, axis.length(), segments), material);
  mesh.name = name; mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()); mesh.userData.staticDecoration = true; parent.add(mesh); return mesh;
};
const socket = (parent, name, p) => addSocket(parent, `socket_${name}`, p);

export function createVestaPlayableHeroModel(options = {}) {
  const root = new THREE.Group(); root.name = 'vesta_playable_hero'; root.userData.heroId = 'vesta';
  const ochre = mat(0xe7c95b), soot = mat(0x3c3b36, { metalness: .45, roughness: .48 });
  const warm = mat(0xfff0b2, { emissive: 0xffb52e, emissiveIntensity: 2.8, roughness: .25 });
  const brass = mat(0xb58a3e, { metalness: .75, roughness: .3 });
  const torso = new THREE.Group(); torso.name = 'pivot_torso'; torso.userData.semanticPivot = 'torso'; root.add(torso);
  addMesh(torso, new THREE.CapsuleGeometry(.48, 1.05, 8, 16), soot, 'coat_trunk', [0, 2.15, 0]);
  addMesh(torso, new THREE.ConeGeometry(.77, 1.55, 6), ochre, 'layered_long_coat', [0, 1.45, -.04]);
  addMesh(torso, new THREE.TorusGeometry(.48, .055, 8, 20), brass, 'chest_trim', [0, 2.48, .15], [Math.PI / 2, 0, 0]);
  const head = new THREE.Group(); head.name = 'pivot_head'; head.userData.semanticPivot = 'head'; root.add(head);
  addMesh(head, new THREE.CylinderGeometry(.43, .52, .38, 10), soot, 'lantern_crown_shell', [0, 3.25, 0]);
  addMesh(head, new THREE.TorusGeometry(.45, .065, 8, 20), brass, 'crown_ring', [0, 3.08, 0]);
  addMesh(head, new THREE.SphereGeometry(.22, 16, 10), warm, 'flame_core', [0, 3.52, .02]);
  addMesh(head, new THREE.ConeGeometry(.13, .52, 8), warm, 'flame_tip', [0, 3.85, .02]);
  addMesh(head, new THREE.TorusGeometry(.66, .026, 6, 32), warm, 'flame_halo', [0, 3.48, 0], [Math.PI / 2, 0, 0]);
  const pelvis = new THREE.Group(); pelvis.name = 'pivot_pelvis'; pelvis.userData.semanticPivot = 'pelvis'; root.add(pelvis);
  addMesh(pelvis, new THREE.SphereGeometry(.48, 12, 8), soot, 'pelvis_core', [0, .92, 0]);
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? -1 : 1;
    const shoulder = new THREE.Group(); shoulder.name = `pivot_${side}_shoulder`; shoulder.userData.semanticPivot = `${side}Shoulder`; root.add(shoulder);
    addMesh(shoulder, new THREE.SphereGeometry(.25, 12, 8), ochre, `${side}_shoulder_pad`, [s * .62, 2.62, 0]);
    const arm = new THREE.Group(); arm.name = `pivot_${side}_arm`; arm.userData.semanticPivot = `${side}Arm`; root.add(arm);
    tube(arm, `${side}_long_bracer`, [s * .67, 2.5, .03], [s * .82, 1.64, .12], .18, soot, 10);
    addMesh(arm, new THREE.TorusGeometry(.2, .045, 6, 14), brass, `${side}_bracer_cuff`, [s * .82, 1.62, .12], [Math.PI / 2, 0, 0]);
    const leg = new THREE.Group(); leg.name = `pivot_${side}_leg`; leg.userData.semanticPivot = `${side}Leg`; root.add(leg);
    tube(leg, `${side}_coat_leg`, [s * .28, .82, 0], [s * .34, .2, .06], .22, soot, 10);
    addMesh(leg, new THREE.BoxGeometry(.42, .18, .68), brass, `${side}_boot`, [s * .34, .1, .18]);
  }
  const staff = new THREE.Group(); staff.name = 'staff_lantern'; root.add(staff);
  tube(staff, 'staff_shaft', [.96, .1, .08], [.96, 3.2, .08], .045, brass, 8);
  addMesh(staff, new THREE.SphereGeometry(.16, 12, 8), warm, 'staff_lantern_glow', [.96, 3.38, .08]);
  socket(staff, 'weapon_primary', [.96, 3.55, .08]); socket(root, 'hand_off', [-.86, 1.62, .12]); socket(root, 'back_accessory', [0, 2.2, -.42]); socket(root, 'vfx_origin', [0, 3.52, .05]);
  const pivots = { root: root.name, head: head.name, torso: torso.name, pelvis: pelvis.name, leftShoulder: 'pivot_left_shoulder', rightShoulder: 'pivot_right_shoulder', leftArm: 'pivot_left_arm', rightArm: 'pivot_right_arm', leftLeg: 'pivot_left_leg', rightLeg: 'pivot_right_leg' };
  const sockets = { weapon_primary: 'socket_weapon_primary', hand_off: 'socket_hand_off', back_accessory: 'socket_back_accessory', vfx_origin: 'socket_vfx_origin' };
  const colliderHints = { torso: { type: 'capsule', radius: .58, height: 2.35 }, head: { type: 'sphere', radius: .48 }, accessory: { type: 'sphere', radius: .72, center: [0, 3.5, 0] } };
  const optimization = Object.values(pivots).filter((n) => n !== root.name).map((n) => ({ pivot: n, ...mergeStaticMeshesByMaterial(root.getObjectByName(n)) }));
  root.userData.characterModel = { schemaVersion: '1.0.0', heroId: 'vesta', implementation: 'handcrafted-img2threejs', coordinateSystem: 'three-y-up-front-positive-z', pivots, sockets, colliderHints, optimization: { strategy: 'per-pivot material merge', pivots: optimization }, performance: { ...measureModelPerformance(root), lod0TriangleBudget: 45000, mobileDrawCallBudget: 24 } };
  root.userData.sculptRuntime = { pivots, sockets, colliderHints };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = options.castShadow ?? true; o.receiveShadow = options.receiveShadow ?? true; } });
  return root;
}

export function createVestaPlayableHeroLookDevLights() { const g = new THREE.Group(); g.add(new THREE.HemisphereLight(0xffe8b0, 0x18202a, 1.5)); const key = new THREE.DirectionalLight(0xffd58a, 3); key.position.set(-3, 6, 5); g.add(key); const rim = new THREE.DirectionalLight(0x7cb5dc, 1.8); rim.position.set(3, 4, -4); g.add(rim); return g; }
