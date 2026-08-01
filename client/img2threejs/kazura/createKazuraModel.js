import * as THREE from '/vendor/three.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGeometryKit } from '../runtime/geometry_kit.js';
const { mergeStaticMeshesByMaterial } = createGeometryKit(THREE, { mergeGeometries });

const mat = (color, roughness = .7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const M = { leaf: mat(0x679653,.82), leafLight: mat(0xb2c98a,.62), bark: mat(0x59412e,.9), barkDark: mat(0x35271f,.95), armor: mat(0x354633,.6,.2), metal: mat(0x28342e,.38,.72), leather: mat(0x4a382b,.88), glow: new THREE.MeshStandardMaterial({color:0xb2c98a,emissive:0x7aaa4d,emissiveIntensity:1.8,roughness:.4}), skin: mat(0xc78f70,.78), hair: mat(0x171a17,.7) };

function mesh(parent, geometry, material, name, position=[0,0,0], scale=[1,1,1]) { const o=new THREE.Mesh(geometry,material); o.name=name; o.position.fromArray(position); o.scale.fromArray(scale); o.castShadow=o.receiveShadow=true; parent.add(o); return o; }
function pivot(root, name, pos) { const p=new THREE.Group(); p.name=name; p.position.fromArray(pos); p.userData.semanticPivot=name.replace('pivot_',''); root.add(p); return p; }
function socket(parent, name, pos) { const s=new THREE.Group(); s.name=name; s.position.fromArray(pos); s.userData.socket=name.replace('socket_',''); parent.add(s); return s; }
function vine(parent,name,a,b,r=.035,material=M.bark) { const curve=new THREE.LineCurve3(new THREE.Vector3(...a),new THREE.Vector3(...b)); const g=new THREE.TubeGeometry(curve,8,r,6,false); return mesh(parent,g,material,name); }
function leaf(parent,name,pos,rot=[0,0,0],s=.16) { const g=new THREE.SphereGeometry(1,8,5); return mesh(parent,g,M.leafLight,name,pos,[s*1.8,s*.5,s]); }
function addCrown(head) { for(let i=0;i<7;i++){ const a=(i/7)*Math.PI*2; vine(head,`crown_vine_${i}`,[Math.cos(a)*.16, .35, Math.sin(a)*.08],[Math.cos(a)*(.4+.08*(i%2)), .75+.1*(i%3), Math.sin(a)*.22],.025); leaf(head,`crown_leaf_${i}`,[Math.cos(a)*(.4+.08*(i%2)),.78+.1*(i%3),Math.sin(a)*.22],[0,0,a],.12); } }
function addForearm(parent, side) { const s=side==='l'?-1:1; mesh(parent,new THREE.CapsuleGeometry(.13,.46,5,10),M.armor,`arm_${side}_tendril_core`,[s*.03,-.3,.02],[1,1.25,1]); for(let i=0;i<3;i++) vine(parent,`arm_${side}_vine_${i}`,[s*.08,-.05,0],[s*(.25+.07*i),-.6,.08*(i-1)],.028); mesh(parent,new THREE.TorusGeometry(.17,.035,7,18),M.bark,`arm_${side}_vine_ring`,[s*.18,-.58,.06],[1,1,1]); }

export function createKazuraPlayableHeroModel(options={}) {
  const root=new THREE.Group(); root.name='kazura_playable_hero'; root.userData.heroId='kazura';
  const torso=pivot(root,'pivot_torso',[0,1.3,0]); mesh(torso,new THREE.CapsuleGeometry(.48,.72,6,12),M.armor,'woven_bark_cuirass',[0,.05,0],[1.2,1, .72]); mesh(torso,new THREE.TorusGeometry(.48,.045,8,20),M.leaf,'cuirass_vine_trim',[0,.24,.02],[1,.75,1]);
  const pelvis=pivot(root,'pivot_pelvis',[0,.78,0]); mesh(pelvis,new THREE.SphereGeometry(.45,12,8),M.leather,'root_pelvis',[0,0,0],[1.35,.62,.78]); mesh(pelvis,new THREE.BoxGeometry(.46,.62,.08),M.leaf,'front_leaf_tab',[0,-.38,.38],[1,1,1]);
  const head=pivot(root,'pivot_head',[0,2.16,.02]); mesh(head,new THREE.SphereGeometry(.3,16,12),M.skin,'face',[0,0,.1],[.86,1.06,.7]); mesh(head,new THREE.SphereGeometry(.34,14,10),M.hair,'hair_bun',[0,.25,-.02],[1.05,1.15,.85]); mesh(head,new THREE.ConeGeometry(.42,.22,7),M.leaf,'leaf_mask',[0,-.04,.27],[1,.55,.4]); addCrown(head);
  for(const side of ['l','r']) { const s=side==='l'?-1:1; const shoulder=pivot(root,`pivot_shoulder_${side}`,[s*.55,1.62,0]); mesh(shoulder,new THREE.SphereGeometry(.24,10,8),M.armor,`shoulder_${side}_branch`,[0,0,0],[1.2,.7,1]); for(let i=0;i<3;i++) vine(shoulder,`shoulder_${side}_twig_${i}`,[0,0,0],[s*(.2+.08*i),.2+.08*i,.12*(i-1)],.035); const arm=pivot(root,`pivot_arm_${side}`,[s*.63,1.35,0]); addForearm(arm,side); socket(arm,`socket_hand_${side}`,[s*.12,-.62,.12]); const leg=pivot(root,`pivot_leg_${side}`,[s*.27,.55,0]); mesh(leg,new THREE.CapsuleGeometry(.18,.58,5,10),M.armor,'leg_'+side+'_rooted', [0,-.1,0],[1,.95,.9]); mesh(leg,new THREE.CapsuleGeometry(.22,.34,5,10),M.bark,'boot_'+side,[0,-.47,.14],[1.2,.6,1.45]); for(let i=0;i<2;i++) vine(leg,`leg_${side}_root_vine_${i}`,[s*.11,-.2,.1],[s*(.25+i*.08),-.9,.3],.03); }
  const staff=pivot(root,'pivot_weapon_staff',[.83,1.15,.08]); vine(staff,'vine_staff',[0,-.65,0],[0,1.0,0],.09,M.bark); mesh(staff,new THREE.TorusGeometry(.25,.045,8,24),M.metal,'staff_growth_ring',[0,.86,.02]); mesh(staff,new THREE.SphereGeometry(.13,12,8),M.glow,'staff_seed',[0,.86,.04]); socket(staff,'socket_weapon_primary',[0,1.04,.05]);
  const back=socket(root,'socket_back_accessory',[0,1.55,-.34]); mesh(back,new THREE.TorusGeometry(.34,.075,8,20),M.bark,'back_growth_ring',[0,.1,0],[1,.9,1]); mesh(back,new THREE.SphereGeometry(.2,12,8),M.glow,'back_seed',[0,.1,.02]); for(let i=0;i<6;i++){const a=i*Math.PI/3; vine(back,`back_vine_${i}`,[0,.1,0],[Math.cos(a)*.48,.1+Math.sin(a)*.45,0],.026);}
  socket(root,'socket_hand_off',[-.62,1.05,.15]); socket(root,'socket_vfx_origin',[0,1.35,.45]);
  const pivots={root:root.name,head:'pivot_head',torso:'pivot_torso',pelvis:'pivot_pelvis',shoulder_l:'pivot_shoulder_l',shoulder_r:'pivot_shoulder_r',arm_l:'pivot_arm_l',arm_r:'pivot_arm_r',leg_l:'pivot_leg_l',leg_r:'pivot_leg_r',leftShoulder:'pivot_shoulder_l',rightShoulder:'pivot_shoulder_r',leftArm:'pivot_arm_l',rightArm:'pivot_arm_r',leftLeg:'pivot_leg_l',rightLeg:'pivot_leg_r'};
  const sockets={weapon_primary:'socket_weapon_primary',hand_off:'socket_hand_off',back_accessory:'socket_back_accessory',vfx_origin:'socket_vfx_origin'};
  const optimization=[];
  for (const name of [...new Set(Object.values(pivots))]) { const p=root.getObjectByName(name); if (p) optimization.push({pivot:name,...mergeStaticMeshesByMaterial(p)}); }
  let triangles=0,drawCalls=0; root.traverse(o=>{if(o.isMesh){drawCalls++; const i=o.geometry.index; triangles+=(i?i.count:o.geometry.attributes.position.count)/3;}});
  root.userData.characterModel={schemaVersion:'1.0.0',heroId:'kazura',implementation:'handcrafted-img2threejs-structure-pass',coordinateSystem:'three-y-up-front-positive-z',pivots,sockets,colliderHints:{body:{type:'capsule',radius:.52,height:1.95},backGrowths:{type:'sphere',radius:.48,center:[0,1.65,-.34]}},optimization:{strategy:'per-pivot material merge',pivots:optimization},performance:{triangles,drawCalls,textures:0,lod0TriangleBudget:45000,mobileDrawCallBudget:24},palette:{green:'#679653',bark:'#59412e',moss:'#b2c98a'}};
  root.userData.sculptRuntime={targetName:'Kazura Vined Forest Guardian',pivots,sockets};
  root.traverse(o=>{if(o.isMesh){o.castShadow=options.castShadow??true;o.receiveShadow=options.receiveShadow??true;}}); return root;
}

export function createKazuraPlayableHeroLookDevLights(){ const g=new THREE.Group(); const h=new THREE.HemisphereLight(0xd5e7c4,0x182218,1.7); g.add(h); const k=new THREE.DirectionalLight(0xffe7bd,3.2); k.position.set(-3,5,5); k.castShadow=true; g.add(k); const r=new THREE.DirectionalLight(0x8acb83,2); r.position.set(4,3,-4); g.add(r); return g; }
