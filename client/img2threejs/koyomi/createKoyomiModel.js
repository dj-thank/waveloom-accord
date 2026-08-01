import * as THREE from '/vendor/three.module.js';
import { createGeometryKit } from '/client/img2threejs/runtime/geometry_kit.js';

const { addMesh, addSocket, measureModelPerformance } = createGeometryKit(THREE);
const V = (x,y,z)=>new THREE.Vector3(x,y,z);
function mats(){
  const silk=(c)=>new THREE.MeshPhysicalMaterial({color:c,roughness:.64,metalness:.08,clearcoat:.18,clearcoatRoughness:.4});
  return {ivory:silk(0xe8e1d8), purple:silk(0x4e315e), dark:silk(0x171824), gold:new THREE.MeshPhysicalMaterial({color:0xb28a4c,metalness:.86,roughness:.26}), brass:new THREE.MeshPhysicalMaterial({color:0x7b5b3a,metalness:.9,roughness:.3}), skin:silk(0xd79578), hair:silk(0x171418), glow:new THREE.MeshBasicMaterial({color:0xb078ff}), smoke:new THREE.MeshPhysicalMaterial({color:0xaaa2ba,transparent:true,opacity:.26,roughness:1})};
}
function mesh(p,g,m,n,pos,scale){ const o=addMesh(p,g,m,n,pos); if(scale)o.scale.fromArray(scale); return o; }
function tube(p,a,b,r,m,n){ const d=new THREE.Vector3().subVectors(b,a), g=new THREE.CylinderGeometry(r,r,d.length(),12); const o=mesh(p,g,m,n,a.toArray()); o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()); return o; }
function pivot(root,name,pos){const p=new THREE.Group();p.name=name;p.position.fromArray(pos);p.userData.semanticPivot=name;root.add(p);return p;}
function buildHuman(root,m){
 const pelvis=pivot(root,'pivot_pelvis',[0,1.25,0]); mesh(pelvis,new THREE.CylinderGeometry(.58,.72,.34,16),m.dark,'robe_pelvis',[0,0,0]);
 const torso=pivot(root,'pivot_torso',[0,1.56,0]); mesh(torso,new THREE.CapsuleGeometry(.58,.85,8,20),m.dark,'clockwork_mage_torso',[0,.55,0],[1.15,1.1,.72]);
 mesh(torso,new THREE.ConeGeometry(.62,.72,8),m.ivory,'crossed_haori',[0,.6,.04],[1.45,1,1]);
 mesh(torso,new THREE.TorusGeometry(.44,.045,8,24),m.gold,'torso_belt',[0,.22,.04],[1.25,1,.78]);
 mesh(torso,new THREE.CylinderGeometry(.12,.12,.16,16),m.gold,'chest_clock',[0,.73,.53],[1,1,.35]);
 const head=pivot(root,'pivot_head',[0,3.03,0]); mesh(head,new THREE.SphereGeometry(.42,24,18),m.skin,'face',[0,.18,.04],[.88,1.1,.86]); mesh(head,new THREE.SphereGeometry(.48,24,16),m.hair,'hair_shell',[0,.31,-.02],[1.02,1.1,.9]);
 mesh(head,new THREE.CylinderGeometry(.14,.26,.32,12),m.hair,'topknot',[0,.78,0]); mesh(head,new THREE.ConeGeometry(.46,.16,12),m.gold,'ornate_crown',[0,.92,0]);
 mesh(head,new THREE.BoxGeometry(1.18,.035,.05),m.brass,'hairpin',[0,.74,.02]);
 for(const x of [-.56,.56]) { tube(head,V(x,.74,.01),V(x,0.32,.01),.018,m.gold,`tassel_rod_${x}`); mesh(head,new THREE.CylinderGeometry(.035,.05,.23,8),m.purple,`tassel_${x}`,[x,.2,.01]); }
 for(const side of [-1,1]){
  const s=side<0?'left':'right', sh=pivot(root,`pivot_${s}_shoulder`,[side*.62,2.25,0]); mesh(sh,new THREE.SphereGeometry(.27,16,12),m.gold,`${s}_shoulder_guard`,[0,0,.02],[1.2,.8,.75]);
  const arm=pivot(root,`pivot_${s}_arm`,[side*.7,2.04,0]); tube(arm,V(0,.18,0),V(side*.08,-.65,.04),.18,m.ivory,`${s}_sleeve`); mesh(arm,new THREE.SphereGeometry(.17,16,12),m.skin,`${s}_hand`,[side*.08,-.83,.08]);
 }
 for(const side of [-1,1]){ const s=side<0?'left':'right', leg=pivot(root,`pivot_${s}_leg`,[side*.3,.94,0]); mesh(leg,new THREE.CapsuleGeometry(.16,.55,8,12),m.dark,`${s}_leg` ,[0,0,0]); mesh(leg,new THREE.BoxGeometry(.32,.16,.58),m.brass,`${s}_boot`,[0,-.35,.1],[1,1,.82]); }
 const robe=pivot(root,'pivot_robe',[0,1.4,0]); mesh(robe,new THREE.ConeGeometry(1.0,.95,16),m.purple,'layered_pleated_skirt',[0,.1,0],[1,.8,.72]);
}
function buildIncense(root,m){
 const prop=pivot(root,'pivot_weapon_primary',[-1.15,1.55,.05]); tube(prop,V(0,-.6,0),V(0,1.05,0),.045,m.brass,'incense_staff'); mesh(prop,new THREE.TorusGeometry(.32,.06,10,28),m.gold,'clockwork_ring',[0,1.18,.02]); mesh(prop,new THREE.CylinderGeometry(.24,.32,.34,16),m.brass,'incense_burner',[0,.55,0]); mesh(prop,new THREE.ConeGeometry(.35,.18,16),m.gold,'burner_roof',[0,.78,0]);
 for(const x of [-.2,.2]) { tube(prop,V(x,.55,0),V(x,.08,0),.012,m.brass,`chain_${x}`); mesh(prop,new THREE.CylinderGeometry(.035,.035,.26,8),m.purple,`tassel_${x}`,[x,-.1,0]); }
 const smoke=pivot(root,'pivot_incense_smoke',[-1.15,2.15,.1]); mesh(smoke,new THREE.SphereGeometry(.16,12,8),m.smoke,'smoke_puff',[0,.2,0],[1,.8,1]); mesh(smoke,new THREE.SphereGeometry(.12,12,8),m.smoke,'smoke_puff_2',[.08,.4,0],[.8,1.2,.8]);
}
export function createKoyomiPlayableHeroModel(options={}){
 const root=new THREE.Group();root.name='koyomi_playable_hero';root.userData.heroId='koyomi'; const m=mats(); buildHuman(root,m); buildIncense(root,m);
 const pivots={root:root.name,head:'pivot_head',torso:'pivot_torso',pelvis:'pivot_pelvis',leftShoulder:'pivot_left_shoulder',rightShoulder:'pivot_right_shoulder',leftArm:'pivot_left_arm',rightArm:'pivot_right_arm',leftLeg:'pivot_left_leg',rightLeg:'pivot_right_leg'};
 const sockets={weapon_primary:'socket_weapon_primary',hand_off:'socket_hand_off',back_accessory:'socket_back_accessory',vfx_origin:'socket_vfx_origin'};
 addSocket(root,sockets.weapon_primary,[-1.15,1.7,.18]); addSocket(root,sockets.hand_off,[.72,1.3,.18]); addSocket(root,sockets.back_accessory,[0,2.4,-.32]); addSocket(root,sockets.vfx_origin,[0,2.1,.18]);
 const colliderHints={capsule:{type:'capsule',radius:.62,height:2.65,center:[0,1.5,0]},head:{type:'sphere',radius:.44,center:[0,3.2,0]},weapon:{type:'capsule',radius:.36,height:1.7,center:[-1.15,1.5,0]}};
 root.userData.characterModel={schemaVersion:'1.0.0',heroId:'koyomi',implementation:'procedural-clockwork-mage',coordinateSystem:'three-y-up-front-positive-z',pivots,sockets,colliderHints,performance:{...measureModelPerformance(root),lod0TriangleBudget:30000,mobileDrawCallBudget:26},animation:{mode:'procedural-pivots',locomotion:['idle','walk','run','air','death'],combat:['cast','fire']}};
 root.userData.sculptRuntime={targetName:'Koyomi Clockwork Mage',pivots,sockets,colliderHints}; root.traverse(o=>{if(o.isMesh){o.castShadow=options.castShadow??true;o.receiveShadow=options.receiveShadow??true;}}); root.updateMatrixWorld(true); return root;
}
export function createKoyomiPlayableHeroLookDevLights(){const g=new THREE.Group();g.add(new THREE.HemisphereLight(0xc9d8ff,0x17131e,1.7));const k=new THREE.DirectionalLight(0xffe5c2,3.2);k.position.set(-3,6,5);k.castShadow=true;g.add(k);const r=new THREE.DirectionalLight(0x8b6dff,2);r.position.set(4,3,-4);g.add(r);return g;}
