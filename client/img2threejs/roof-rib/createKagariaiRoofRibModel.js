import * as THREE_DEFAULT from 'three';
import { createGeometryKit } from '../runtime/geometry_kit.js';

const SOURCE_SHA256 = '526A593493B80B371F91115916432E7C93B89795E520FA44FF0FD347625B10C7';

export function setKagariaiRoofRibFinialDetached(root, detached) {
  const finial = root.getObjectByName('finial_pivot');
  if (!finial) throw new Error('ROOF_RIB_FINIAL_MISSING');
  const attached = finial.userData.attachedLocalPosition;
  if (!Array.isArray(attached) || attached.length !== 3) throw new Error('ROOF_RIB_FINIAL_ATTACHMENT_STATE_MISSING');
  if (detached) {
    finial.position.fromArray(attached);
    finial.position.x += 0.28;
    finial.position.y += 0.2;
    finial.position.z += 0.22;
    finial.userData.interactionState = 'detached-preview';
  } else {
    finial.position.fromArray(attached);
    finial.userData.interactionState = 'attached';
  }
  return root;
}

export function disposeKagariaiRoofRibModel(root, options = {}) {
  if (!root?.isObject3D) throw new Error('ROOF_RIB_DISPOSE_ROOT_INVALID');
  if (root.userData.disposed === true) return false;

  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry?.dispose) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material?.dispose) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && value.dispose) textures.add(value);
      }
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  const ownsTextures = root.userData.assetModel?.resourceOwnership?.textures === 'factory-owned';
  if (options.disposeTextures ?? ownsTextures) {
    for (const texture of textures) texture.dispose();
  }
  root.clear();
  root.userData.materials = [];
  root.userData.disposed = true;
  root.userData.disposal = {
    geometries: geometries.size,
    materials: materials.size,
    textures: (options.disposeTextures ?? ownsTextures) ? textures.size : 0,
  };
  return true;
}

export function createKagariaiRoofRibModel(options = {}) {
  const THREE = options.THREE ?? THREE_DEFAULT;
  const { measureModelPerformance } = createGeometryKit(THREE);
  const root = new THREE.Group();
  root.name = 'kagariai_roof_rib_root';
  root.userData.collision = false;

  const materialFromMaps = (fallbackSettings, maps, settings) => {
    if (!maps) return new THREE.MeshStandardMaterial(fallbackSettings);
    return new THREE.MeshStandardMaterial({
      color: settings.color ?? 0xffffff,
      map: maps.albedo,
      normalMap: maps.normal,
      roughnessMap: maps.roughness,
      aoMap: maps.ao,
      normalScale: new THREE.Vector2(settings.normalScale, settings.normalScale),
      roughness: settings.roughness,
      metalness: settings.metalness,
      envMapIntensity: settings.envMapIntensity,
    });
  };
  const addLocalSurfaceTreatment = (material, profile, maps) => {
    if (!maps) return material;
    const profileFragments = {
      ceramic: `
        float roofEdge = min(min(vMapUv.x, 1.0 - vMapUv.x), min(vMapUv.y, 1.0 - vMapUv.y));
        float roofChipNoise = fract(sin(dot(floor(vMapUv * vec2(91.0, 67.0)), vec2(12.9898, 78.233))) * 43758.5453);
        float roofSeam = 1.0 - smoothstep(0.018, 0.075, roofEdge);
        float roofWear = smoothstep(0.018, 0.055, roofEdge) * (1.0 - smoothstep(0.055, 0.11, roofEdge));
        float roofChippedEdge = roofWear * smoothstep(0.68, 0.9, roofChipNoise);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.55, 0.59, 0.63), roofSeam * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.68, 0.61, 0.51), roofChippedEdge * 0.50);
      `,
      copper: `
        float roofPatinaFlow = 0.5 + 0.5 * sin(vMapUv.y * 19.0 + sin(vMapUv.x * 11.0) * 2.3);
        float roofPatina = smoothstep(0.58, 0.86, roofPatinaFlow) * smoothstep(0.08, 0.52, vMapUv.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.56, 1.05, 0.88), roofPatina * 0.28);
      `,
      iron: `
        float roofIronEdge = min(min(vMapUv.x, 1.0 - vMapUv.x), min(vMapUv.y, 1.0 - vMapUv.y));
        float roofIronPolish = 1.0 - smoothstep(0.018, 0.085, roofIronEdge);
        diffuseColor.rgb *= mix(vec3(0.78), vec3(1.12, 1.10, 1.06), roofIronPolish * 0.35);
      `,
      brass: `
        float roofBrassEdge = min(min(vMapUv.x, 1.0 - vMapUv.x), min(vMapUv.y, 1.0 - vMapUv.y));
        float roofBrassPolish = 1.0 - smoothstep(0.02, 0.1, roofBrassEdge);
        diffuseColor.rgb *= vec3(1.45, 1.24, 0.90);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.2, 1.08, 0.78), roofBrassPolish * 0.24);
      `,
    };
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n#ifdef USE_MAP\n${profileFragments[profile]}\n#endif`,
      );
    };
    material.customProgramCacheKey = () => `kagariai-roof-rib-surface-v1-${profile}`;
    material.userData.surfaceProfile = profile;
    return material;
  };
  const ceramicMaterial = addLocalSurfaceTreatment(materialFromMaps(
    { color: 0x8e969b, roughness: 0.82, metalness: 0 },
    options.pbrTextures?.ceramic, {
    color: 0x8390b0, normalScale: 0.62, roughness: 0.72, metalness: 0.02, envMapIntensity: 0.75,
  }), 'ceramic', options.pbrTextures?.ceramic);
  const ironMaterial = addLocalSurfaceTreatment(materialFromMaps(
    { color: 0x525a5f, roughness: 0.86, metalness: 0 },
    options.pbrTextures?.iron, {
    normalScale: 0.5, roughness: 0.68, metalness: 0.82, envMapIntensity: 0.9,
  }), 'iron', options.pbrTextures?.iron);
  const copperMaterial = addLocalSurfaceTreatment(materialFromMaps(
    { color: 0xa28f79, roughness: 0.72, metalness: 0 },
    options.pbrTextures?.copper, {
    normalScale: 0.48, roughness: 0.52, metalness: 0.72, envMapIntensity: 1.0,
  }), 'copper', options.pbrTextures?.copper);
  const brassMaterial = addLocalSurfaceTreatment(materialFromMaps(
    { color: 0xa28f79, roughness: 0.72, metalness: 0 },
    options.pbrTextures?.brass, {
    color: 0xffffff, normalScale: 0.42, roughness: 0.45, metalness: 0.76, envMapIntensity: 1.0,
  }), 'brass', options.pbrTextures?.brass);
  const materials = [ceramicMaterial, ironMaterial, copperMaterial, brassMaterial];
  const unitShape = new THREE.Shape();
  unitShape.moveTo(-0.47, -0.47);
  unitShape.lineTo(0.47, -0.47);
  unitShape.lineTo(0.47, 0.47);
  unitShape.lineTo(-0.47, 0.47);
  unitShape.closePath();
  const beveledUnitGeometry = new THREE.ExtrudeGeometry(unitShape, {
    depth: 0.94,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.03,
    bevelThickness: 0.03,
  });
  beveledUnitGeometry.translate(0, 0, -0.47);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const compose = (p, s, euler = [0, 0, 0]) => matrix.compose(
    position.fromArray(p),
    quaternion.setFromEuler(new THREE.Euler(...euler)),
    scale.fromArray(s),
  );
  const coolTint = (index) => {
    const wave = Math.sin(index * 2.17) * 0.045;
    return new THREE.Color().setRGB(0.94 + wave, 0.97 + wave * 0.6, 1.0 - wave * 0.35);
  };
  const warmTint = (index) => {
    const wave = Math.sin(index * 1.73 + 0.4) * 0.05;
    return new THREE.Color().setRGB(1.0, 0.94 + wave, 0.88 + wave * 0.45);
  };

  const tileShell = new THREE.Group();
  tileShell.name = 'tile_shell';
  tileShell.userData.collision = false;
  root.add(tileShell);
  const courseSpecs = [
    { name: 'lower_tile_course', y: 0.17, depth: 0.31, height: 0.1, z: 0.23, pitch: 0.3, sides: true },
    { name: 'middle_tile_course', y: 0.22, depth: 0.21, height: 0.065, z: 0.115, pitch: 0.24, sides: true },
    { name: 'upper_tile_course', y: 0.28, depth: 0.14, height: 0.055, z: 0.055, pitch: 0.18, sides: true },
    { name: 'ridge_cap_course', y: 0.335, depth: 0.11, height: 0.055, z: 0, pitch: 0, sides: false },
  ];
  const tileInstances = new THREE.InstancedMesh(beveledUnitGeometry, ceramicMaterial, 70);
  tileInstances.name = 'tile_instances';
  tileInstances.userData.collision = false;
  let courseStart = 0;
  for (const course of courseSpecs) {
    const count = course.sides ? 20 : 10;
    const courseMarker = new THREE.Object3D();
    courseMarker.name = course.name;
    courseMarker.userData.collision = false;
    courseMarker.userData.instanceRange = { start: courseStart, count };
    tileShell.add(courseMarker);
    for (let index = 0; index < 10; index += 1) {
      const x = -1.08 + index * 0.24;
      const sag = 0.045 * (Math.abs(x) / 1.08) ** 2;
      if (course.sides) {
        tileInstances.setMatrixAt(courseStart + index, compose(
          [x, course.y + sag, course.z],
          [0.225, course.height, course.depth],
          [course.pitch, 0, 0],
        ));
        tileInstances.setMatrixAt(courseStart + index + 10, compose(
          [x, course.y + sag, -course.z],
          [0.225, course.height, course.depth],
          [-course.pitch, 0, 0],
        ));
        tileInstances.setColorAt(courseStart + index, coolTint(index));
        tileInstances.setColorAt(courseStart + index + 10, coolTint(index + 5));
      } else {
        tileInstances.setMatrixAt(courseStart + index, compose([x, course.y + sag, 0], [0.225, course.height, course.depth]));
        tileInstances.setColorAt(courseStart + index, coolTint(index + 11));
      }
    }
    courseStart += count;
  }
  tileInstances.instanceMatrix.needsUpdate = true;
  if (tileInstances.instanceColor) tileInstances.instanceColor.needsUpdate = true;
  tileInstances.castShadow = options.castShadow ?? true;
  tileInstances.receiveShadow = options.receiveShadow ?? true;
  tileShell.add(tileInstances);

  const copperSpine = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), copperMaterial, 10);
  copperSpine.name = 'copper_spine';
  copperSpine.userData.collision = false;
  copperSpine.castShadow = options.castShadow ?? true;
  for (let index = 0; index < 10; index += 1) {
    const x = -1.08 + index * 0.24;
    const sag = 0.045 * (Math.abs(x) / 1.08) ** 2;
    const slope = Math.atan((0.09 * x) / (1.08 ** 2));
    copperSpine.setMatrixAt(index, compose([x, 0.385 + sag, 0], [0.225, 0.06, 0.13], [0, 0, slope]));
    copperSpine.setColorAt(index, warmTint(index));
  }
  copperSpine.instanceMatrix.needsUpdate = true;
  if (copperSpine.instanceColor) copperSpine.instanceColor.needsUpdate = true;
  root.add(copperSpine);

  const hardwareParts = [
    { p: [0, 0.105, 0], s: [2.38, 0.07, 0.62] },
  ];
  for (const x of [-1.27, 1.27]) {
    hardwareParts.push(
      { p: [x, 0.27, 0], s: [0.18, 0.36, 0.18] },
      { p: [x, 0.15, -0.31], s: [0.18, 0.16, 0.18] },
      { p: [x, 0.15, 0.31], s: [0.18, 0.16, 0.18] },
      { p: [x, 0.215, -0.19], s: [0.18, 0.13, 0.16] },
      { p: [x, 0.215, 0.19], s: [0.18, 0.13, 0.16] },
      { p: [x, 0.37, 0], s: [0.22, 0.1, 0.22] },
    );
  }
  const hardware = new THREE.InstancedMesh(beveledUnitGeometry, ironMaterial, hardwareParts.length);
  hardware.name = 'modular_iron_hardware';
  hardware.userData.collision = false;
  hardwareParts.forEach((part, index) => {
    hardware.setMatrixAt(index, compose(part.p, part.s));
    const value = 0.92 + Math.sin(index * 1.31) * 0.035;
    hardware.setColorAt(index, new THREE.Color().setRGB(value, value * 0.985, value * 0.97));
  });
  hardware.instanceMatrix.needsUpdate = true;
  if (hardware.instanceColor) hardware.instanceColor.needsUpdate = true;
  hardware.castShadow = options.castShadow ?? true;
  hardware.receiveShadow = options.receiveShadow ?? true;
  root.add(hardware);
  const leftCap = new THREE.Object3D();
  leftCap.name = 'end_cap_left';
  leftCap.position.set(-1.27, 0.27, 0);
  leftCap.userData.collision = false;
  root.add(leftCap);
  const rightCap = new THREE.Object3D();
  rightCap.name = 'end_cap_right';
  rightCap.position.set(1.27, 0.27, 0);
  rightCap.userData.collision = false;
  root.add(rightCap);

  const makeSocket = (name, x) => {
    const socket = new THREE.Object3D();
    socket.name = name;
    socket.position.set(x, 0.45, 0);
    socket.userData.socket = true;
    socket.userData.collision = false;
    root.add(socket);
    return socket;
  };
  const leftFinialSocket = makeSocket('socket_finial_left', -1.27);
  const rightFinialSocket = makeSocket('socket_finial_right', 1.27);
  const attachments = [];

  const finialSide = options.finial === 'left' ? 'left' : options.finial === 'none' ? 'none' : 'right';
  if (finialSide !== 'none') {
    const finial = new THREE.Group();
    finial.name = 'finial_pivot';
    finial.position.set(0, -0.04, 0);
    finial.userData.detachable = true;
    finial.userData.attachedLocalPosition = [0, -0.04, 0];
    finial.userData.interactionState = 'attached';
    finial.userData.parentSocket = `socket_finial_${finialSide}`;
    finial.userData.collision = false;
    finial.userData.attachmentContract = {
      parentSocket: `socket_finial_${finialSide}`,
      localStart: [0, -0.04, 0],
      localEnd: [0, 0.35, 0],
      contactType: 'socketed',
      embedDepth: 0.04,
      overlap: 0.02,
      gapTolerance: 0.005,
    };
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.12, 12), brassMaterial);
    collar.name = 'finial_collar';
    collar.position.y = 0.03;
    collar.userData.collision = false;
    finial.add(collar);
    const shape = new THREE.Shape();
    shape.moveTo(-0.025, 0);
    shape.lineTo(-0.046, 0.036);
    shape.lineTo(-0.021, 0.074);
    shape.lineTo(-0.049, 0.108);
    shape.lineTo(-0.015, 0.123);
    shape.lineTo(0, 0.3);
    shape.lineTo(0.015, 0.123);
    shape.lineTo(0.049, 0.108);
    shape.lineTo(0.021, 0.074);
    shape.lineTo(0.046, 0.036);
    shape.lineTo(0.025, 0);
    shape.closePath();
    const spearGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false });
    const spears = new THREE.InstancedMesh(spearGeometry, copperMaterial, 2);
    spears.name = 'finial_spear';
    spears.position.set(0, 0.07, -0.0225);
    spears.setMatrixAt(0, new THREE.Matrix4());
    spears.setMatrixAt(1, new THREE.Matrix4().makeRotationY(Math.PI / 2));
    spears.instanceMatrix.needsUpdate = true;
    spears.userData.collision = false;
    finial.add(spears);
    const targetSocket = finialSide === 'left' ? leftFinialSocket : rightFinialSocket;
    targetSocket.add(finial);
    attachments.push({ child: 'finial_pivot', ...finial.userData.attachmentContract });
  }

  root.traverse((object) => {
    if (object.isMesh || object.isInstancedMesh) {
      object.castShadow = options.castShadow ?? true;
      object.receiveShadow = options.receiveShadow ?? true;
    }
  });
  const performance = { ...measureModelPerformance(root) };
  root.traverse((object) => {
    if (!object.isInstancedMesh || !object.geometry || object.count <= 1) return;
    const index = object.geometry.index;
    const perInstance = (index ? index.count : object.geometry.attributes.position?.count || 0) / 3;
    performance.triangles += perInstance * (object.count - 1);
  });
  root.userData.assetModel = {
    schemaVersion: '1.0.0',
    assetId: 'prop-kagariai-roof-rib-01',
    candidateOnly: true,
    collision: 'none',
    sourceReferenceSha256: SOURCE_SHA256,
    dimensionsM: { length: 2.4, height: 0.72, depth: 0.76 },
    resourceOwnership: {
      geometry: 'factory-owned',
      materials: 'factory-owned',
      textures: options.ownsPbrTextures === true ? 'factory-owned' : 'borrowed',
    },
    performance,
    optimization: {
      pass: 'optimization-pass',
      fpsTarget: 60,
      budgets: { triangles: 5000, drawCalls: 8, textures: 16 },
      measured: performance,
      instancing: { tileInstances: 70, tileDrawCalls: 1, spineInstances: 10, hardwareInstances: 13 },
      lodStrategy: {
        status: 'documented-not-runtime-admitted',
        tiers: [
          { id: 'lod0', maxDistanceM: 12, materialMode: 'full-pbr' },
          { id: 'lod1', maxDistanceM: 28, materialMode: 'shared-pbr-reduced-anisotropy' },
          { id: 'cull', minDistanceM: 45 },
        ],
      },
    },
    surface: {
      pass: 'surface-pass',
      materialFeatureGroups: {
        ceramic: {
          evidenceRefs: ['ceramic-edge-chips', 'ceramic-micro-crazing', 'seam-cavity-dirt'],
          treatments: ['uv-edge-wear', 'uv-seam-dirt', 'normal-highlight-breakup'],
        },
        copper: {
          evidenceRefs: ['copper-verdigris', 'copper-spine-segments'],
          treatments: ['directional-verdigris', 'roughness-breakup'],
        },
        iron: {
          evidenceRefs: ['hidden-end-joint', 'seam-cavity-dirt'],
          treatments: ['recess-darkening', 'edge-polish'],
        },
        brass: {
          evidenceRefs: ['finial-spear-profile'],
          treatments: ['collar-edge-polish', 'oxidized-blade-separation'],
        },
      },
      reviewViews: ['grazing-closeup'],
    },
  };
  root.userData.sculptRuntime = {
    pivots: {
      root: 'kagariai_roof_rib_root',
      tileShell: 'tile_shell',
      finial: finialSide === 'none' ? null : 'finial_pivot',
      endCaps: ['end_cap_left', 'end_cap_right'],
    },
    sockets: { finialLeft: 'socket_finial_left', finialRight: 'socket_finial_right' },
    detachable: finialSide === 'none' ? [] : ['finial_pivot'],
    attachments,
    colliders: {},
    colliderProxies: { policy: 'presentation-only', enabled: false, proxies: [] },
    destructionGroups: {
      tileShell: {
        members: ['lower_tile_course', 'middle_tile_course', 'upper_tile_course', 'ridge_cap_course'],
        mode: 'visual-fracture-only',
        runtimeAdmissionRequired: true,
      },
      spine: { members: ['copper_spine'], mode: 'segment-release', runtimeAdmissionRequired: true },
      hardware: { members: ['modular_iron_hardware'], mode: 'visual-fracture-only', runtimeAdmissionRequired: true },
      finial: {
        members: finialSide === 'none' ? [] : ['finial_pivot'],
        mode: 'socket-detach',
        runtimeAdmissionRequired: true,
      },
    },
  };
  root.userData.materials = materials;
  return root;
}

const LIGHTING_MODES = {
  neutral: {
    hemisphere: 1.25, key: 2.8, keyPosition: [-3, 5, 4], rim: 1.05, rimPosition: [4, 2, -3],
  },
  grazing: {
    hemisphere: 0.58, key: 4.4, keyPosition: [-4.5, 0.82, 1.3], rim: 0.42, rimPosition: [3.2, 1.1, -2.6],
  },
  reference: {
    hemisphere: 0.88, key: 3.25, keyPosition: [-3.8, 4.2, 3.1], rim: 0.72, rimPosition: [3.8, 1.65, -2.7],
  },
};

export function applyKagariaiRoofRibLightingMode(group, mode) {
  const profile = LIGHTING_MODES[mode];
  if (!profile) throw new Error(`ROOF_RIB_LIGHTING_UNKNOWN:${mode}`);
  const hemisphere = group.getObjectByName('lookdev_hemisphere');
  const key = group.getObjectByName('lookdev_key');
  const rim = group.getObjectByName('lookdev_rim');
  if (!hemisphere || !key || !rim) throw new Error('ROOF_RIB_LIGHTING_RIG_INCOMPLETE');
  hemisphere.intensity = profile.hemisphere;
  key.intensity = profile.key;
  key.position.fromArray(profile.keyPosition);
  rim.intensity = profile.rim;
  rim.position.fromArray(profile.rimPosition);
  group.userData.activeLightingMode = mode;
  return group;
}

export function createKagariaiRoofRibLookDevLights({ THREE = THREE_DEFAULT } = {}) {
  const group = new THREE.Group();
  group.name = 'roof_rib_lookdev_lights';
  group.userData.lightingProfile = {
    toneMapping: 'ACESFilmicToneMapping',
    exposure: { neutral: 1.18, grazing: 1.18, reference: 1.05 },
    background: { neutral: 0xc9cbc8, grazing: 0xc9cbc8, reference: 0xb0a49c },
    contactShadow: { receiver: 'matte-floor', softness: 'PCFSoftShadowMap' },
    modes: ['neutral', 'grazing', 'reference'],
  };
  const hemisphere = new THREE.HemisphereLight(0xd7e4ec, 0x34302c, 1.25);
  hemisphere.name = 'lookdev_hemisphere';
  group.add(hemisphere);
  const key = new THREE.DirectionalLight(0xfff1dc, 2.8);
  key.name = 'lookdev_key';
  key.position.set(-3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.018;
  key.shadow.camera.left = -3.2;
  key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 2.4;
  key.shadow.camera.bottom = -1.2;
  group.add(key);
  const rim = new THREE.DirectionalLight(0x81a9c9, 1.05);
  rim.name = 'lookdev_rim';
  rim.position.set(4, 2, -3);
  group.add(rim);
  return applyKagariaiRoofRibLightingMode(group, 'neutral');
}
