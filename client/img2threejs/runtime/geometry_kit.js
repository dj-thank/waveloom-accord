/**
 * Renderer-agnostic static-decoration compaction helpers.
 *
 * Models opt in by passing their THREE.Object3D root. Nodes marked with
 * `userData.semanticPivot`, `userData.socket`, or `userData.collider` are
 * protected; gameplay anchors and bounds therefore survive batching. The kit
 * only plans groups and delegates actual BufferGeometry merging to the caller
 * (`mergeGroup`), keeping Three.js version-specific utilities out of runtime.
 */

function semanticAnchor(node) {
  const data = node?.userData || {};
  if (data.semanticPivot) return `pivot:${data.semanticPivot}`;
  if (data.socket) return `socket:${data.socket}`;
  if (data.collider) return 'collider';
  return 'root';
}

function protectedNode(node) {
  const data = node?.userData || {};
  return Boolean(data.semanticPivot || data.socket || data.collider || data.preserveGeometry);
}

function defaultMaterialKey(material) {
  if (!material) return 'none';
  if (Array.isArray(material)) return material.map(defaultMaterialKey).join(',');
  return material.uuid || material.name || material.type || 'material';
}

/** Build deterministic merge buckets while preserving semantic anchor nodes. */
export function buildCompactionPlan(root, {
  maxDrawCalls = 24,
  isStatic = (node) => node?.userData?.staticDecoration !== false,
  materialKey = defaultMaterialKey,
} = {}) {
  if (!root || typeof root.traverse !== 'function') throw new TypeError('COMPACTION_ROOT_INVALID');
  const buckets = new Map();
  const protectedAnchors = [];
  root.traverse((node) => {
    if (protectedNode(node)) protectedAnchors.push(node);
    if (!node.geometry || !node.material || !isStatic(node) || protectedNode(node)) return;
    const key = `${semanticAnchor(node)}|${materialKey(node.material)}|${node.geometry.index ? 'indexed' : 'plain'}`;
    const list = buckets.get(key) || [];
    list.push(node);
    buckets.set(key, list);
  });
  const groups = [...buckets.entries()].map(([key, nodes]) => ({ key, nodes, mergeable: nodes.length > 1 }));
  // A caller may merge any number of compatible groups; this estimate is
  // conservative and never claims anchors were removed.
  const estimatedDrawCalls = groups.reduce((sum, group) => sum + (group.mergeable ? 1 : group.nodes.length), 0);
  return Object.freeze({
    maxDrawCalls,
    groups: Object.freeze(groups.map((group) => Object.freeze({ ...group, nodes: Object.freeze(group.nodes) }))),
    protectedAnchors: Object.freeze(protectedAnchors),
    estimatedDrawCalls,
    targetMet: estimatedDrawCalls <= maxDrawCalls,
  });
}

/** Apply caller-provided geometry merger to mergeable groups; never merges protected nodes. */
export function applyCompactionPlan(root, plan, { mergeGroup } = {}) {
  if (!plan || !Array.isArray(plan.groups)) throw new TypeError('COMPACTION_PLAN_INVALID');
  if (mergeGroup !== undefined && typeof mergeGroup !== 'function') throw new TypeError('COMPACTION_MERGER_INVALID');
  const merged = [];
  for (const group of plan.groups) {
    if (!group.mergeable || !mergeGroup) continue;
    const replacement = mergeGroup(group.nodes, group.key);
    if (replacement) merged.push({ key: group.key, nodes: group.nodes, replacement });
  }
  if (root?.userData && typeof root.userData === 'object') {
    root.userData.geometryCompaction = { estimatedDrawCalls: plan.estimatedDrawCalls, mergedGroups: merged.length, maxDrawCalls: plan.maxDrawCalls };
  }
  return Object.freeze({ ...plan, merged: Object.freeze(merged) });
}

export function compactStaticDecorations(root, options = {}) {
  const plan = buildCompactionPlan(root, options);
  return applyCompactionPlan(root, plan, options);
}

/** Optional Three.js adapter used by model modules that want eager merging. */
export function createGeometryKit(THREE, { mergeGeometries } = {}) {
  if (!THREE?.Mesh || !THREE?.Group) throw new TypeError('GEOMETRY_THREE_INVALID');
  const asVector3 = (value) => {
    if (value?.isVector3) return value.clone();
    if (Array.isArray(value)) return new THREE.Vector3().fromArray(value);
    throw new TypeError('GEOMETRY_POINT_INVALID');
  };
  const addMesh = (
    parent,
    geometry,
    material,
    name,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.fromArray(position);
    mesh.rotation.set(...rotation);
    if (Array.isArray(scale)) mesh.scale.fromArray(scale);
    else if (Number.isFinite(scale)) mesh.scale.setScalar(scale);
    mesh.userData.staticDecoration = true;
    parent.add(mesh);
    return mesh;
  };
  const place = (mesh, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    mesh.position.fromArray(position);
    mesh.rotation.set(...rotation);
    if (Array.isArray(scale)) mesh.scale.fromArray(scale);
    else if (Number.isFinite(scale)) mesh.scale.setScalar(scale);
    mesh.userData.staticDecoration = true;
    return mesh;
  };
  const addTube = (parent, name, from, to, radius, material, segments = 8) => {
    const a = asVector3(from), b = asVector3(to);
    const delta = b.clone().sub(a), length = delta.length();
    const mesh = addMesh(parent, new THREE.CylinderGeometry(radius, radius, length, segments), material, name);
    mesh.position.copy(a.clone().add(b).multiplyScalar(.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh;
  };
  const addTaperedTube = (parent, name, from, to, r1, r2, material, segments = 8) => {
    const a = asVector3(from), b = asVector3(to), delta = b.clone().sub(a), length = delta.length();
    const mesh = addMesh(parent, new THREE.CylinderGeometry(r2, r1, length, segments), material, name);
    mesh.position.copy(a.clone().add(b).multiplyScalar(.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh;
  };
  const addRivet = (parent, name, position, material, radius = .05) => addMesh(parent, new THREE.SphereGeometry(radius, 8, 6), material, name, position);
  const addRivetRow = (parent, name, points, material, radius = .04) => points.map((point, index) => addRivet(parent, `${name}_${index}`, point, material, radius));
  const addRing = (parent, name, position, radius, tube, material, rotation = [0, 0, 0]) => place(addMesh(parent, new THREE.TorusGeometry(radius, tube, 8, 16), material, name), position, rotation);
  const addCurvedTube = (parent, name, points, radius, material, segments = 8) => {
    if (!Array.isArray(points) || points.length < 2) throw new TypeError('GEOMETRY_CURVE_POINTS_INVALID');
    const curve = new THREE.CatmullRomCurve3(points.map(asVector3));
    return addMesh(parent, new THREE.TubeGeometry(curve, Math.max(4, points.length * 3), radius, segments, false), material, name);
  };
  const addPlate = (
    parent,
    name,
    points,
    depth,
    material,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    bevelSize = 0,
  ) => {
    const shape = new THREE.Shape(); points.forEach((point, index) => index ? shape.lineTo(point[0], point[1]) : shape.moveTo(point[0], point[1])); shape.closePath();
    const bevel = Math.max(0, Number(bevelSize) || 0);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      steps: 1,
      bevelEnabled: bevel > 0,
      bevelSegments: bevel > 0 ? 2 : 0,
      bevelSize: bevel,
      bevelThickness: Math.min(bevel, Math.max(0.001, depth * 0.35)),
    });
    geometry.translate(0, 0, -depth * 0.5);
    return place(addMesh(parent, geometry, material, name), position, rotation);
  };
  const addTrimmedPlate = (
    parent,
    name,
    points,
    depth,
    materials,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    trimScale = 1.035,
  ) => {
    if (materials?.isMaterial) return addPlate(parent, name, points, depth, materials, position, rotation);
    const bodyMaterial = materials?.teal || materials?.body || Object.values(materials || {})[0];
    const trimMaterial = materials?.brass || materials?.trim || bodyMaterial;
    const scaled = points.map(([x, y]) => [x * trimScale, y * trimScale]);
    addPlate(parent, `${name}_trim`, scaled, depth, trimMaterial, position, rotation, Math.min(0.018, depth * 0.08));
    return addPlate(parent, name, points, depth + 0.012, bodyMaterial, position, rotation, Math.min(0.012, depth * 0.06));
  };
  const addOutline = (parent, name, points, z, radius, material, segments = 8) => {
    if (!Array.isArray(points) || points.length < 3) throw new TypeError('GEOMETRY_OUTLINE_POINTS_INVALID');
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y]) => new THREE.Vector3(x, y, z)),
      true,
      'centripetal',
    );
    return addMesh(
      parent,
      new THREE.TubeGeometry(curve, Math.max(12, points.length * 3), radius, segments, true),
      material,
      name,
    );
  };
  const addSocket = (parent, name, position = [0, 0, 0]) => {
    const socket = new THREE.Group();
    socket.name = name;
    socket.position.fromArray(position);
    socket.userData.socket = name;
    parent.add(socket);
    return socket;
  };
  const rebasePivot = (pivot, restPosition = [0, 0, 0]) => {
    // Preserve full world transforms while moving the semantic animation pivot.
    pivot.userData.pivotRestPosition = [...restPosition];
    pivot.updateMatrixWorld(true);
    const childWorld = pivot.children.map((child) => ({ child, world: child.matrixWorld.clone() }));
    pivot.position.fromArray(restPosition);
    pivot.updateMatrixWorld(true);
    const inversePivot = pivot.matrixWorld.clone().invert();
    childWorld.forEach(({ child, world }) => {
      child.matrix.copy(inversePivot).multiply(world);
      child.matrix.decompose(child.position, child.quaternion, child.scale);
    });
    pivot.updateMatrixWorld(true);
    return pivot;
  };
  const measureModelPerformance = (root) => {
    let triangles = 0; let drawCalls = 0;
    const textures = new Set();
    root.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      drawCalls += 1;
      const index = node.geometry.index;
      triangles += (index ? index.count : (node.geometry.attributes.position?.count || 0)) / 3;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) for (const value of Object.values(material || {})) {
        if (value?.isTexture) textures.add(value.uuid || value);
      }
    });
    return { triangles, drawCalls, textures: textures.size };
  };
  const mergeStaticMeshesByMaterial = (parent) => {
    if (typeof mergeGeometries !== 'function') throw new Error('GEOMETRY_MERGER_UNAVAILABLE');
    const meshes = parent.children.filter((node) => node.isMesh && node.geometry && node.userData.staticDecoration !== false);
    const buckets = new Map();
    meshes.forEach((mesh) => {
      const material = mesh.material?.uuid || mesh.material?.name || mesh.material?.type || 'material';
      const attributes = Object.keys(mesh.geometry.attributes || {}).sort().join(',');
      const indexed = mesh.geometry.index ? 'indexed' : 'plain';
      const morph = Object.keys(mesh.geometry.morphAttributes || {}).sort().join(',');
      const key = `${material}|${indexed}|${attributes}|${morph}`;
      const list = buckets.get(key) || [];
      list.push(mesh);
      buckets.set(key, list);
    });
    let sourceMeshes = 0; let mergedMeshes = 0;
    for (const group of buckets.values()) {
      if (group.length < 2) continue;
      const geometries = group.map((mesh) => { parent.updateMatrixWorld(true); const geometry = mesh.geometry.clone(); const local = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(mesh.matrixWorld); geometry.applyMatrix4(local); return geometry; });
      const merged = mergeGeometries(geometries, false);
      if (!merged) continue;
      const replacement = new THREE.Mesh(merged, group[0].material);
      replacement.name = `${group[0].name || 'decor'}-merged`;
      replacement.userData.staticDecoration = true;
      parent.add(replacement);
      group.forEach((mesh) => parent.remove(mesh));
      sourceMeshes += group.length; mergedMeshes += 1;
    }
    return { sourceMeshes, mergedMeshes, drawCallsRemoved: sourceMeshes - mergedMeshes };
  };
  return { addMesh, addPlate, addTrimmedPlate, addOutline, addCurvedTube, addRivet, addRivetRow, addTube, addTaperedTube, addRing, addSocket, rebasePivot, measureModelPerformance, mergeStaticMeshesByMaterial };
}
