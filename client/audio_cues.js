import { HEROES } from '../shared/data/heroes.js';

const FAMILY_BY_TYPE = Object.freeze({
  hybrid_melee_projectile: 'anchor',
  melee: 'melee',
  charge: 'precision',
  hitscan: 'rifle',
  burst: 'rifle',
  explosive: 'explosive',
  ricochet_projectile: 'blade',
  shotgun: 'shotgun',
  guided_projectile: 'guided',
  healing_projectile: 'needle',
  deploy: 'deploy',
  beam: 'beam',
  explosive_heal: 'flare',
});

const FAMILY_PROFILES = Object.freeze({
  anchor: Object.freeze({ family: 'anchor', wave: 'square', bodyHz: 82, crackHz: 720, noise: 0.52, duration: 0.24 }),
  melee: Object.freeze({ family: 'melee', wave: 'triangle', bodyHz: 96, crackHz: 420, noise: 0.46, duration: 0.2 }),
  precision: Object.freeze({ family: 'precision', wave: 'sine', bodyHz: 188, crackHz: 1540, noise: 0.32, duration: 0.2 }),
  rifle: Object.freeze({ family: 'rifle', wave: 'sawtooth', bodyHz: 132, crackHz: 1180, noise: 0.42, duration: 0.14 }),
  explosive: Object.freeze({ family: 'explosive', wave: 'square', bodyHz: 62, crackHz: 360, noise: 0.78, duration: 0.34 }),
  blade: Object.freeze({ family: 'blade', wave: 'triangle', bodyHz: 260, crackHz: 2100, noise: 0.2, duration: 0.16 }),
  shotgun: Object.freeze({ family: 'shotgun', wave: 'square', bodyHz: 74, crackHz: 640, noise: 0.9, duration: 0.28 }),
  guided: Object.freeze({ family: 'guided', wave: 'sine', bodyHz: 108, crackHz: 520, noise: 0.35, duration: 0.3 }),
  needle: Object.freeze({ family: 'needle', wave: 'triangle', bodyHz: 330, crackHz: 2400, noise: 0.18, duration: 0.12 }),
  deploy: Object.freeze({ family: 'deploy', wave: 'sine', bodyHz: 145, crackHz: 790, noise: 0.24, duration: 0.22 }),
  beam: Object.freeze({ family: 'beam', wave: 'sine', bodyHz: 220, crackHz: 880, noise: 0.08, duration: 0.11 }),
  flare: Object.freeze({ family: 'flare', wave: 'triangle', bodyHz: 165, crackHz: 1260, noise: 0.38, duration: 0.2 }),
});

const WEAPON_PROFILE_BY_ID = new Map();
for (const hero of HEROES) {
  const family = FAMILY_BY_TYPE[hero.weapon.type] || 'rifle';
  WEAPON_PROFILE_BY_ID.set(hero.weapon.id, FAMILY_PROFILES[family]);
}

function safePosition(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const pos = value.slice(0, 3).map(Number);
  return pos.every(Number.isFinite) ? pos : null;
}

export function weaponSoundProfile(weaponId) {
  return WEAPON_PROFILE_BY_ID.get(weaponId) || FAMILY_PROFILES.rifle;
}

export function describeCombatCue(event, context = {}) {
  if (!event || typeof event !== 'object') return null;
  const type = String(event.type || '');
  const myId = context.myId ?? null;

  if (type === 'shot') {
    const profile = weaponSoundProfile(event.weaponId);
    const local = event.source === myId;
    return {
      kind: 'weapon',
      priority: local ? 'high' : 'normal',
      spatial: !local,
      position: local ? null : safePosition(event.origin),
      gain: local ? 0.74 : 0.46,
      pitch: 1,
      profile,
      source: event.source ?? null,
    };
  }
  if (type === 'hit' && event.source === myId) {
    return { kind: 'hit_confirm', priority: 'high', spatial: false, position: null, gain: 0.34, pitch: event.headshot ? 1.34 : 1 };
  }
  if (type === 'hit' && event.target === myId) {
    return { kind: 'damaged', priority: 'critical', spatial: false, position: null, gain: 0.62, pitch: 0.88 };
  }
  if (type === 'heal' && event.target === myId) {
    return { kind: 'healed', priority: 'normal', spatial: false, position: null, gain: 0.35, pitch: 1.05 };
  }
  if (type === 'ultimate_used') {
    const source = event.player ?? event.source;
    const local = source === myId;
    return {
      kind: 'ultimate', priority: 'critical', spatial: !local,
      position: local ? null : safePosition(event.pos ?? event.position ?? event.origin),
      gain: local ? 0.78 : 0.66, pitch: local ? 1.08 : 0.92,
    };
  }
  if (type === 'ability_windup') {
    const source = event.player ?? event.source;
    const local = source === myId;
    const kind = local ? 'ability_ready' : 'cast_warning';
    return {
      kind,
      priority: kind === 'cast_warning' ? 'high' : 'normal',
      spatial: !local,
      position: local ? null : safePosition(event.pos ?? event.origin ?? event.target),
      gain: local ? 0.28 : 0.42,
      pitch: local ? 1.15 : 0.78,
    };
  }
  if (type === 'kill') {
    return {
      kind: event.source === myId ? 'elimination' : event.target === myId ? 'eliminated' : 'distant_elimination',
      priority: event.source === myId || event.target === myId ? 'critical' : 'normal',
      spatial: false, position: null, gain: 0.5, pitch: event.source === myId ? 1.15 : 0.82,
    };
  }
  if (type === 'pickup' && event.player === myId) {
    return { kind: 'pickup', priority: 'normal', spatial: false, position: null, gain: 0.3, pitch: 1.1 };
  }
  if (type === 'obj_captured' || type === 'obj_retake' || type === 'round_active') {
    return { kind: 'objective', priority: 'high', spatial: false, position: null, gain: 0.48, pitch: type === 'obj_retake' ? 1.12 : 1 };
  }
  if (type === 'barrier_hit' || type === 'deployable_hit' || type === 'barrier_destroyed' || type === 'deployable_destroyed') {
    const isHit = type === 'barrier_hit' || type === 'deployable_hit';
    return {
      kind: isHit ? 'barrier_hit' : 'break', priority: 'normal', spatial: true,
      position: safePosition(event.pos ?? event.position ?? event.center), gain: 0.34, pitch: isHit ? 0.86 : 0.62,
    };
  }
  return null;
}

export { FAMILY_PROFILES };
