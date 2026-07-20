export const PROTOCOL_VERSION = 5;

export const LAG_COMPENSATION_POLICY = Object.freeze({
  displayInterpolationBaseMs: 100,
  absoluteMaxMs: 220,
});

export function isSupportedProtocolVersion(value) {
  return value === PROTOCOL_VERSION;
}
