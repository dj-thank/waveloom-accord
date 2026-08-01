import * as THREE from '/vendor/three.module.js';
import { createGeometryKit } from '../runtime/geometry_kit.js';

const { addMesh, addTube, addTaperedTube, addRivet, addSocket, measureModelPerformance } = createGeometryKit(THREE);
const mat = (color, roughness = .48, metalness = .12, emissive = 0) => new THREE.MeshPhysicalMaterial({ color, roughness, metalness, clearcoat: .18, emissive, emissiveIntensity: emissive ? 2.2 : 0 });

function buildMaterials() {
  return { red: mat(0xdb5537, .42, .16), coal: mat(0x272425, .7, .25), amber: mat(0xf6aa45, .24, .28, 0xf06b16), ember: mat(0xff7a22, .18, .2, 0xff3b0b), wrap: mat(0x61362e, .82, .05) };
}
function addPaddedArm(parent, side, m) {
  const s = side === 'left' ? -1 : 1;
  const g = new THREE.Group(); g.name = `pivot_${side}_arm`; parent.add(g);
  addTaperedTube(g, `${side}_upperarm`, [s*.55,2.62,0], [s*.8,2.0,.04], .28, .23, m.coal, 16);
  addMesh(g, new THREE.SphereGeometry(.34,24,16), m.red, `${side}_padded_forearm`, [s*.9,1.83,.2], [0,0,s*.18], [1.05,.86,1.25]);
  addMesh(g, new THREE.BoxGeometry(.38,.5,.52), m.coal, `${side}_knuckle_guard`, [s*1.02,1.62,.48], [0,0,s*.1]);
  addRivet(g, `${side}_brass_stud`, [s*1.03,1.78,.48], m.amber, .055);
  addSocket(g, `socket_${side}_hand`, [s*1.08,1.5,.5]);
  g.userData.semanticPivot = `${side}_arm`;
}
function addLeg(parent, side, m) {
  const s = side === 'left' ? -1 : 1; const g = new THREE.Group(); g.name=`pivot_${side}_leg`; parent.add(g);
  addTaperedTube(g, `${side}_thigh`, [s*.34,1.35,0], [s*.4,.65,.02], .31,.24,m.coal,16);
  addMesh(g,new THREE.CylinderGeometry(.25,.3,.62,12),m.wrap,`${side}_charred_shin_wrap`,[s*.4,.39,0],[0,0,.08]);
  addMesh(g,new THREE.BoxGeometry(.5,.2,.72),m.coal,`${side}_boot`,[s*.4,.1,.18],[0,0,0]);
  addTube(g,`${side}_wrap_band`,[s*.2,.48,.23],[s*.6,.48,.23],.025,m.amber,8);
  g.userData.semanticPivot=`${side}_leg`;
}
export function createHokuchiPlayableHeroModel(options={}) {
  const root = new THREE.Group(); root.name='hokuchi_playable_hero'; root.userData.heroId='hokuchi';
  const m=buildMaterials();
  const torso=new THREE.Group(); torso.name='pivot_torso'; torso.userData.semanticPivot='torso'; root.add(torso);
  addMesh(torso,new THREE.CapsuleGeometry(.62,.85,12,24),m.coal,'wrapped_torso',[0,2.25,0],[0,0,0],[1.08,1,.72]);
  addMesh(torso,new THREE.SphereGeometry(.64,28,18),m.red,'sleeveless_chest',[0,2.58,.06],[0,0,0],[1.18,.72,.82]);
  addTube(torso,'chest_wrap_upper',[-.56,2.75,.5],[.56,2.75,.5],.035,m.amber,8);
  addTube(torso,'chest_wrap_lower',[-.48,2.25,.52],[.48,2.25,.52],.03,m.wrap,8);
  const head=new THREE.Group(); head.name='pivot_head'; head.userData.semanticPivot='head'; root.add(head);
  addMesh(head,new THREE.SphereGeometry(.43,28,20),m.coal,'ember_mask',[0,3.45,.08],[0,0,0],[1.05,.9,.88]);
  addMesh(head,new THREE.BoxGeometry(.42,.12,.12),m.ember,'mask_visor',[0,3.48,.46]);
  addMesh(head,new THREE.SphereGeometry(.12,16,12),m.amber,'cheek_vent_l',[-.34,3.34,.31],[0,0,0],[.6,1,1]);
  addMesh(head,new THREE.SphereGeometry(.12,16,12),m.amber,'cheek_vent_r',[.34,3.34,.31],[0,0,0],[.6,1,1]);
  addTube(head,'mask_crown',[-.22,3.78,.02],[0,4.04,.04],.025,m.amber,8); addTube(head,'mask_crown_r',[.22,3.78,.02],[0,4.04,.04],.025,m.amber,8);
  addPaddedArm(root,'left',m); addPaddedArm(root,'right',m); addLeg(root,'left',m); addLeg(root,'right',m);
  const can=new THREE.Group(); can.name='pivot_back_accessory'; can.userData.semanticPivot='back_accessory'; root.add(can);
  addMesh(can,new THREE.CylinderGeometry(.27,.27,.74,20),m.coal,'fuel_canister',[-.63,2.1,-.38],[0,0,.16]); addTube(can,'canister_strap',[-.82,2.4,-.22],[-.5,1.8,-.42],.035,m.amber,8);
  const weapon=new THREE.Group(); weapon.name='pivot_weapon_primary'; weapon.userData.semanticPivot='weapon_primary'; root.add(weapon);
  addMesh(weapon,new THREE.CylinderGeometry(.17,.22,.7,16),m.coal,'oil_torch_gauntlet',[1.12,1.72,.52],[Math.PI/2,0,0]); addMesh(weapon,new THREE.CylinderGeometry(.12,.12,.12,16),m.ember,'torch_muzzle',[1.12,1.72,.9],[Math.PI/2,0,0]);
  addSocket(weapon,'socket_muzzle_vfx',[1.12,1.72,1.02]);
  const pelvis=new THREE.Group(); pelvis.name='pivot_pelvis'; pelvis.userData.semanticPivot='pelvis'; root.add(pelvis); addMesh(pelvis,new THREE.SphereGeometry(.52,24,16),m.coal,'pelvis_core',[0,1.55,0],[0,0,0],[1.1,.65,.75]);
  addSocket(root,'socket_hand_off',[-1.08,1.5,.5]); addSocket(root,'socket_back_accessory',[-.63,2.1,-.6]); addSocket(root,'socket_vfx_origin',[0,2.5,.5]);
  const pivots={root:root.name,head:head.name,torso:torso.name,pelvis:pelvis.name,leftShoulder:'pivot_left_arm',rightShoulder:'pivot_right_arm',leftArm:'pivot_left_arm',rightArm:'pivot_right_arm',leftLeg:'pivot_left_leg',rightLeg:'pivot_right_leg'};
  const sockets={weapon_primary:'socket_muzzle_vfx',hand_off:'socket_hand_off',back_accessory:'socket_back_accessory',vfx_origin:'socket_vfx_origin'};
  const colliderHints={body:{type:'capsule',radius:.68,height:3.35},head:{type:'sphere',radius:.43},weapon:{type:'box',size:[.42,.45,.9]},accessory:{type:'capsule',radius:.3,height:.8}};
  const performance=measureModelPerformance(root); performance.lod0TriangleBudget=30000; performance.mobileDrawCallBudget=36; root.userData.characterModel={schemaVersion:'1.0.0',heroId:'hokuchi',implementation:'handcrafted-img2threejs',coordinateSystem:'three-y-up-front-positive-z',pivots,sockets,colliderHints,performance,optimization:{strategy:'semantic-pivot compaction',preservedAnchors:Object.values(sockets)},palette:['#db5537','#272425','#f6aa45']}; root.userData.sculptRuntime={pivots,sockets,colliderHints};
  root.traverse(o=>{if(o.isMesh){o.castShadow=options.castShadow??true;o.receiveShadow=options.receiveShadow??true;}}); return root;
}
export function createHokuchiPlayableHeroLookDevLights(){ const g=new THREE.Group(); g.name='hokuchi_lights'; g.add(new THREE.HemisphereLight(0xffc59b,0x1b1820,1.5)); const k=new THREE.DirectionalLight(0xffd1a1,3); k.position.set(-3,6,5); g.add(k); const r=new THREE.DirectionalLight(0xff6338,2); r.position.set(3,3,-4); g.add(r); return g; }
