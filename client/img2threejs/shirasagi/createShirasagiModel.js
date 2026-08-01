import * as THREE from '/vendor/three.module.js';
import { createGeometryKit } from '/client/img2threejs/runtime/geometry_kit.js';
const { addMesh, addSocket, rebasePivot, measureModelPerformance } = createGeometryKit(THREE);
const mat = (color, roughness=.55, metalness=0) => new THREE.MeshStandardMaterial({color, roughness, metalness});
const white=mat(0xf2f5f2,.62), feather=mat(0xdbe4e2,.78), navy=mat(0x203653,.5,.15), gold=mat(0xd4a64b,.3,.72), red=mat(0x9f3f3f,.4), dark=mat(0x152132,.3,.3);
function mesh(p,g,m,n,pos,scale=[1,1,1]){const x=addMesh(p,g,m,n,pos);x.scale.set(...scale);return x;}
function tube(p,n,a,b,r,m){const d=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));const mid=new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5);const x=mesh(p,new THREE.CylinderGeometry(r,r,d.length(),8),m,n,mid.toArray());x.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return x;}
function pivot(root,key,pos){const g=new THREE.Group();g.name=`pivot_${key}`;g.userData.pivotRestPosition=[...pos];root.add(g);return g;}
function create(){const root=new THREE.Group();root.name='shirasagi_playable_hero';root.userData.heroId='shirasagi';
 const torso=pivot(root,'torso',[0,1.95,0]); mesh(torso,new THREE.CapsuleGeometry(.46,.75,8,16),white,'torso_body',[0,1.95,0],[1.05,1,0.72]); mesh(torso,new THREE.SphereGeometry(.5,16,10),feather,'torso_bib',[0,2.18,.28],[1.2,.8,.38]);
 const pelvis=pivot(root,'pelvis',[0,1.25,0]);mesh(pelvis,new THREE.SphereGeometry(.42,16,10),navy,'pelvis_wrap',[0,1.3,0],[1.05,.55,.78]);
 const head=pivot(root,'head',[0,2.9,0]);mesh(head,new THREE.SphereGeometry(.34,20,14),white,'head',[0,3.05,.02],[.9,1.1,.9]);mesh(head,new THREE.ConeGeometry(.12,.48,12),gold,'beak',[0,3.02,.37],[1,.7,1]);mesh(head,new THREE.SphereGeometry(.045,10,8),dark,'eye_l',[-.15,3.13,.29]);mesh(head,new THREE.SphereGeometry(.045,10,8),dark,'eye_r',[.15,3.13,.29]);
 const shoulderL=pivot(root,'shoulder_l',[-.5,2.45,0]), shoulderR=pivot(root,'shoulder_r',[.5,2.45,0]);
 for(const [g,s,sgn] of [[shoulderL,'l',-1],[shoulderR,'r',1]]){mesh(g,new THREE.SphereGeometry(.25,14,10),white,`shoulder_${s}`,[sgn*.5,2.45,0],[1,.8,.8]);}
 const armL=pivot(root,'arm_l',[-.65,2.12,0]), armR=pivot(root,'arm_r',[.65,2.12,0]);
 tube(armL,'arm_l_upper',[-.65,2.35,0],[-.8,1.75,.05],.13,white);tube(armR,'arm_r_upper',[.65,2.35,0],[.8,1.75,.05],.13,white);mesh(armL,new THREE.SphereGeometry(.15,12,8),gold,'hand_l',[-.8,1.68,.08]);mesh(armR,new THREE.SphereGeometry(.15,12,8),gold,'hand_r',[.8,1.68,.08]);
 const legL=pivot(root,'leg_l',[-.25,1.15,0]), legR=pivot(root,'leg_r',[.25,1.15,0]);tube(legL,'leg_l',[-.25,1.2,0],[-.28,.45,.08],.16,navy);tube(legR,'leg_r',[.25,1.2,0],[.28,.45,.08],.16,navy);mesh(legL,new THREE.CapsuleGeometry(.18,.38,6,10),gold,'foot_l',[-.28,.2,.18],[1,.5,1.4]);mesh(legR,new THREE.CapsuleGeometry(.18,.38,6,10),gold,'foot_r',[.28,.2,.18],[1,.5,1.4]);
 // Distinctive folded crane wings and compact longbow.
 for(const [s,sgn] of [['l',-1],['r',1]]){const w=pivot(root,`wing_${s}`,[sgn*.42,2.35,-.02]);for(let i=0;i<4;i++){const y=2.4-i*.16, z=-.12-i*.04;mesh(w,new THREE.ConeGeometry(.22,.95-i*.08,6),feather,`wing_${s}_feather_${i}`,[sgn*(.72+i*.1),y,z],[.6,1,.28]);}}
 const bow=pivot(root,'bow',[.96,2.05,.2]);tube(bow,'bow_grip',[0,0,0],[0,.9,0],.045,gold);tube(bow,'bow_upper',[0,.9,0],[.18,1.42,0],.035,navy);tube(bow,'bow_lower',[0,0,0],[.18,-.52,0],.035,navy);tube(bow,'bow_string',[.18,1.42,0],[.18,-.52,0],.012,white);addSocket(bow,'socket_weapon_primary',[0,.45,.08]);
 addSocket(armL,'socket_hand_off',[0,0,.15]);addSocket(root,'socket_back_accessory',[0,2.55,-.35]);addSocket(root,'socket_vfx_origin',[0,1.8,.35]);
 const pivots={root:root.name,head:head.name,torso:torso.name,pelvis:pelvis.name,leftShoulder:shoulderL.name,rightShoulder:shoulderR.name,leftArm:armL.name,rightArm:armR.name,leftLeg:legL.name,rightLeg:legR.name,shoulder_l:shoulderL.name,shoulder_r:shoulderR.name,arm_l:armL.name,arm_r:armR.name,leg_l:legL.name,leg_r:legR.name};const sockets={weapon_primary:'socket_weapon_primary',hand_off:'socket_hand_off',back_accessory:'socket_back_accessory',vfx_origin:'socket_vfx_origin'};
 root.userData.characterModel={schemaVersion:'1.0.0',heroId:'shirasagi',implementation:'handcrafted-img2threejs',coordinateSystem:'three-y-up-front-positive-z',pivots,sockets,colliderHints:{torso:{type:'capsule',radius:.52,height:1.7},head:{type:'sphere',radius:.34},height:3.45},performance:{...measureModelPerformance(root),lod0TriangleBudget:45000,mobileDrawCallBudget:24}};
 root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return root; }
export function createShirasagiPlayableHeroModel(options={}){return create(options);}
