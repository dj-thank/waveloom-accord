/**
 * Small, fail-closed runtime for procedural hero models.
 *
 * The manifest is intentionally injected: browser code can pass the generated
 * CHARACTER_MODEL_ASSETS_BY_HERO_ID map, while Node tests can provide a tiny
 * fixture and an importer. Candidate/planned/blocked entries are never loaded
 * unless the caller explicitly changes the admission policy (not supported by
 * the default provider).
 */

const ACCEPTED = 'accepted';
const QUALITY_GATE_IDS = Object.freeze([
  'strictSpec',
  'silhouette',
  'multiAngle',
  'material',
  'runtimeContract',
  'performance',
  'visualReview',
]);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function asEntry(manifest, heroId) {
  if (!manifest || typeof manifest !== 'object') return undefined;
  return manifest instanceof Map ? manifest.get(heroId) : manifest[heroId];
}

/** Validate manifest metadata before any dynamic import is attempted. */
export function validateModelManifestEntry(entry, heroId) {
  if (!entry || typeof entry !== 'object') throw fail('MODEL_UNKNOWN_HERO', `no asset for ${heroId}`);
  if (entry.heroId !== heroId) throw fail('MODEL_MANIFEST_MISMATCH', `manifest heroId does not match ${heroId}`);
  if (entry.status !== ACCEPTED) throw fail('MODEL_NOT_ACCEPTED', `${heroId} status is ${entry.status || 'missing'}`);
  if (entry.runtimeEligible !== true) throw fail('MODEL_QUALITY_INCOMPLETE', `${heroId} is not runtime eligible`);
  const missingQuality = QUALITY_GATE_IDS.filter((id) => entry.quality?.gates?.[id] !== true);
  if (missingQuality.length > 0) {
    throw fail('MODEL_QUALITY_INCOMPLETE', `${heroId} missing quality gates: ${missingQuality.join(', ')}`);
  }
  if (!Array.isArray(entry.quality?.evidence) || entry.quality.evidence.length < QUALITY_GATE_IDS.length) {
    throw fail('MODEL_EVIDENCE_INCOMPLETE', `${heroId} has insufficient quality evidence`);
  }
  if (typeof entry.moduleUrl !== 'string' || !entry.moduleUrl) throw fail('MODEL_MODULE_MISSING', `${heroId} has no moduleUrl`);
  if (typeof entry.factoryExport !== 'string' || !entry.factoryExport) throw fail('MODEL_FACTORY_MISSING', `${heroId} has no factoryExport`);
  return entry;
}

function hasObject3DShape(root) {
  return !!root
    && typeof root === 'object'
    && root.isObject3D === true
    && typeof root.traverse === 'function'
    && typeof root.getObjectByName === 'function'
    && root.position
    && typeof root.position === 'object';
}

export function getCharacterModelMetadata(root) {
  const userData = root?.userData && typeof root.userData === 'object' ? root.userData : {};
  const envelope = userData.characterModel && typeof userData.characterModel === 'object'
    ? userData.characterModel
    : userData.sculptRuntime && typeof userData.sculptRuntime === 'object'
      ? userData.sculptRuntime
      : userData;
  return {
    ...envelope,
    heroId: envelope.heroId || userData.heroId,
  };
}

/** Validate the factory result and the stable gameplay metadata contract. */
export function validateModelRoot(root, heroId, entry = {}) {
  if (!hasObject3DShape(root)) throw fail('MODEL_ROOT_INVALID', `${heroId} factory did not return a THREE.Object3D-like root`);
  const metadata = getCharacterModelMetadata(root);
  if (metadata.heroId !== heroId) throw fail('MODEL_ROOT_HERO_MISMATCH', `${heroId} root userData.heroId mismatch`);
  const contract = entry.contract || entry;
  const requiredPivots = contract.requiredPivots || ['root'];
  const requiredSockets = contract.requiredSockets || [];
  const pivots = metadata.pivots || {};
  const sockets = metadata.sockets || {};
  for (const name of requiredPivots) {
    const objectName = pivots[name];
    if (!objectName || !root.getObjectByName(objectName)) {
      throw fail('MODEL_PIVOT_MISSING', `${heroId} missing pivot ${name}`);
    }
  }
  for (const name of requiredSockets) {
    const objectName = sockets[name];
    if (!objectName || !root.getObjectByName(objectName)) {
      throw fail('MODEL_SOCKET_MISSING', `${heroId} missing socket ${name}`);
    }
  }
  const colliderHints = metadata.colliderHints || metadata.collider;
  if (contract.requireColliderHints !== false
    && (!colliderHints || typeof colliderHints !== 'object' || Object.keys(colliderHints).length === 0)) {
    throw fail('MODEL_COLLIDER_MISSING', `${heroId} missing collider hints`);
  }
  return root;
}

export function createModelProvider({ manifest = {}, importModule = (url) => import(url) } = {}) {
  const moduleCache = new Map();

  async function loadModule(heroId) {
    const entry = validateModelManifestEntry(asEntry(manifest, heroId), heroId);
    if (!moduleCache.has(heroId)) {
      const pending = Promise.resolve().then(() => importModule(entry.moduleUrl)).catch((cause) => {
        moduleCache.delete(heroId);
        throw fail('MODEL_IMPORT_FAILED', `${heroId} module import failed: ${cause?.message || cause}`);
      });
      moduleCache.set(heroId, pending);
    }
    return { entry, module: await moduleCache.get(heroId) };
  }

  return Object.freeze({
    async instantiate(heroId, options = {}) {
      const { entry, module } = await loadModule(heroId);
      const factory = module?.[entry.factoryExport];
      if (typeof factory !== 'function') throw fail('MODEL_FACTORY_INVALID', `${heroId} export ${entry.factoryExport} is not callable`);
      let root;
      try { root = await factory({ heroId, ...options }); }
      catch (cause) { throw fail('MODEL_FACTORY_FAILED', `${heroId} factory failed: ${cause?.message || cause}`); }
      return validateModelRoot(root, heroId, entry);
    },
    clearCache(heroId) { if (heroId === undefined) moduleCache.clear(); else moduleCache.delete(heroId); },
    cacheSize() { return moduleCache.size; },
  });
}

// Descriptive alias for callers that use the domain term rather than the
// implementation-neutral provider name.
export const createCharacterModelProvider = createModelProvider;

export async function instantiateHeroModel(heroId, options = {}) {
  // Keep production wiring lazy so a missing generated manifest fails as a
  // deterministic MODEL_IMPORT_FAILED/MODEL_UNKNOWN_HERO error at call time.
  const { CHARACTER_MODEL_ASSETS_BY_HERO_ID } = await import('../../../shared/data/character_model_assets.js');
  return createModelProvider({ manifest: CHARACTER_MODEL_ASSETS_BY_HERO_ID }).instantiate(heroId, options);
}

export const MODEL_RUNTIME_ERRORS = Object.freeze({ ACCEPTED, UNKNOWN_HERO: 'MODEL_UNKNOWN_HERO' });
