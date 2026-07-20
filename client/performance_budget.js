export const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({
    dprCap: 1,
    shadows: false,
    shadowMapSize: 0,
    particleBudget: 120,
    tracerBudget: 80,
    targetFrameMs: 33.34,
  }),
  medium: Object.freeze({
    dprCap: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    particleBudget: 260,
    tracerBudget: 140,
    targetFrameMs: 23.34,
  }),
  high: Object.freeze({
    dprCap: 1.75,
    shadows: true,
    shadowMapSize: 2048,
    particleBudget: 420,
    tracerBudget: 200,
    targetFrameMs: 16.7,
  }),
});

const QUALITY_ORDER = Object.freeze(['low', 'medium', 'high']);

function percentile(samples, fraction) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function frozenCopy(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = frozenCopy(child);
  return Object.freeze(copy);
}

/**
 * Keeps quality selection and frame timings independent of the WebGL renderer,
 * so it is deterministic in tests and can be inspected without mutating state.
 */
export class PerformanceBudget {
  constructor({ quality = 'high', sampleSize = 120, fallbackMinSamples = 45 } = {}) {
    this.sampleSize = Math.max(8, Math.floor(sampleSize) || 120);
    this.fallbackMinSamples = Math.max(1, Math.floor(fallbackMinSamples) || 45);
    this.frameMs = [];
    this.maxFrameMs = 0;
    this.quality = QUALITY_PROFILES[quality] ? quality : 'high';
  }

  get profile() {
    return QUALITY_PROFILES[this.quality];
  }

  setQuality(quality) {
    if (!QUALITY_PROFILES[quality]) return false;
    if (quality === this.quality) return false;
    this.quality = quality;
    return true;
  }

  recordFrameMs(value) {
    const frameMs = Number(value);
    if (!Number.isFinite(frameMs) || frameMs < 0) return null;
    this.frameMs.push(frameMs);
    if (this.frameMs.length > this.sampleSize) this.frameMs.shift();
    this.maxFrameMs = Math.max(this.maxFrameMs, frameMs);

    if (this.frameMs.length < this.fallbackMinSamples || this.quality === 'low') return null;
    if (percentile(this.frameMs, 0.95) <= this.profile.targetFrameMs) return null;
    const nextQuality = QUALITY_ORDER[Math.max(0, QUALITY_ORDER.indexOf(this.quality) - 1)];
    return this.setQuality(nextQuality) ? nextQuality : null;
  }

  snapshot({ rendererInfo, pools = {} } = {}) {
    const samples = this.frameMs;
    const average = samples.length === 0 ? 0 : samples.reduce((sum, value) => sum + value, 0) / samples.length;
    return frozenCopy({
      quality: this.quality,
      profile: this.profile,
      frameMs: {
        samples: samples.length,
        average,
        p95: percentile(samples, 0.95),
        p99: percentile(samples, 0.99),
        max: this.maxFrameMs,
      },
      pools,
      renderer: rendererInfo || {},
    });
  }
}

export function copyRendererInfo(info) {
  return {
    memory: {
      geometries: Number(info?.memory?.geometries) || 0,
      textures: Number(info?.memory?.textures) || 0,
    },
    render: {
      calls: Number(info?.render?.calls) || 0,
      triangles: Number(info?.render?.triangles) || 0,
      points: Number(info?.render?.points) || 0,
      lines: Number(info?.render?.lines) || 0,
      frame: Number(info?.render?.frame) || 0,
    },
  };
}
