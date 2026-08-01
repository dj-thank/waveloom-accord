// Flashpoint snapshots add the five-site lifecycle envelope. Version 6 keeps
// v5 clients from treating a transition's null scalar objective as corruption.
export const PROTOCOL_VERSION = 6;

export const LAG_COMPENSATION_POLICY = Object.freeze({
  displayInterpolationBaseMs: 100,
  absoluteMaxMs: 220,
});

export function isSupportedProtocolVersion(value) {
  return value === PROTOCOL_VERSION;
}
