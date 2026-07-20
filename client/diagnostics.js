export const PERFORMANCE_DIAGNOSTICS_KEY = '__KAGARIAI_DIAGNOSTICS__';

const NOOP = () => {};
const EMPTY_SNAPSHOT = Object.freeze({});

export function installPerformanceDiagnostics(globalObject, getPerformanceSnapshot) {
  const objectLike = globalObject !== null
    && (typeof globalObject === 'object' || typeof globalObject === 'function');
  if (!objectLike || typeof getPerformanceSnapshot !== 'function') return NOOP;
  if (PERFORMANCE_DIAGNOSTICS_KEY in globalObject) return NOOP;

  const diagnostics = Object.freeze({
    performance: () => getPerformanceSnapshot() || EMPTY_SNAPSHOT,
  });

  try {
    Object.defineProperty(globalObject, PERFORMANCE_DIAGNOSTICS_KEY, {
      configurable: true,
      enumerable: false,
      writable: false,
      value: diagnostics,
    });
  } catch {
    return NOOP;
  }

  return () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalObject, PERFORMANCE_DIAGNOSTICS_KEY);
    if (descriptor?.configurable && descriptor.value === diagnostics) {
      delete globalObject[PERFORMANCE_DIAGNOSTICS_KEY];
    }
  };
}
