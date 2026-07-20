// World: サーバー権威シミュレーションの統合。63Hz固定tick。
// ヘッドレス（tools/headless.js）・専用サーバー（server/）の双方から使用する。

import { Collider } from './collision.js';
import { makeMoveState, step as moveStep } from './movement.js';
import { ShiouraObjective, updateEffectivePresence } from './objective.js';
import { RespawnSystem } from './respawn.js';
import { MatchFlow } from './match.js';
import {
  makeWeaponState, tickWeaponState, tryBeginFire, fireDirection, hitscan, damageAtRange,
  eyePosition, weaponMuzzlePosition,
} from './combat.js';
import { makeRng } from './rng.js';
import { HERO_BY_ID } from '../data/heroes.js';
import {
  makeAbilityState, tickAbilityState, processAbilityInputs, tickWorldAbilityEffects,
  movementMultiplier, outgoingDamageMultiplier, incomingDamageMultiplier, redirectStatus,
  barrierHit, deployableHit, snapshotZone, snapshotBarrier, storeHeal, applyStatus, interruptAbility,
} from './abilities.js';
import { spawnWeaponProjectile, tickProjectiles, snapshotProjectile } from './projectiles.js';
import { selectSafeSpawn } from './spawn.js';

export const EMPTY_INPUT = Object.freeze({
  f: false, b: false, l: false, r: false, jump: false, crouch: false,
  fire: false, secondary: false, ability1: false, ability2: false, ultimate: false,
  reload: false, moveX: null, moveY: null,
  yaw: 0, pitch: 0, seq: 0, interpMs: 100,
});

export const INPUT_COMMAND_QUEUE_CAPACITY = 32;
export const INPUT_LEASE_MS = 250;
export const INPUT_REORDER_WINDOW = 32;
export const INPUT_REORDER_WAIT_MS = 32;
export const SPAWN_PROTECTION_SEC = 1.25;
const WEAPON_TRACE_EPSILON_M = 1e-5;

export class World {
  constructor(map, mode, combat, seed = 1) {
    this.map = map;
    this.mode = mode;
    this.combat = combat;
    this.mv = combat.movement;
    this.rng = makeRng(seed);
    this.seed = seed;
    this.collider = new Collider(map.solids);
    this.objective = new ShiouraObjective(mode);
    this.respawn = new RespawnSystem(mode.respawn);
    this.flow = new MatchFlow(mode, this.rng);
    this.players = new Map();
    this.pickups = map.pickups.map(p => ({ ...p, active: true, respawnAt: 0 }));
    this.events = [];           // スナップショット間のイベント（キル・目標遷移等）
    this.log = [{               // 全試合ログ（§9。リプレイ/分析の一次データ）
      tick: 0, t: 0, type: 'match_start', seed, round: 1, sides: [...this.flow.sides],
    }];
    this.tickCount = 0;
    this.t = 0;                 // 試合通算秒
    this.dt = 1 / combat.tickRateHz;
    this.history = [];          // 遅延補償用の位置履歴
    this.nextId = 1;
    this.nextEffectId = 1;
    this.nextAttackId = 1;
    this.zones = [];
    this.barriers = [];
    this.projectiles = [];
    this.inputCommandMetrics = {
      accepted: 0,
      applied: 0,
      rejectedInvalid: 0,
      rejectedStale: 0,
      rejectedOverflow: 0,
      rejectedReorderWindow: 0,
      leaseExpirations: 0,
      discardedOnLease: 0,
      discardedOnNeutralize: 0,
      reorderedAccepted: 0,
      reorderGapsSkipped: 0,
      reorderMissingSequences: 0,
      highWatermark: 0,
    };
    this.collider.dynamic = map.setupDoors; // SETUPは扉閉鎖から開始
  }

  addPlayer(name, isBot, forceTeam = -1, heroId = null) {
    const id = 'p' + this.nextId++;
    let team = forceTeam;
    if (team < 0) {
      const c = [0, 0];
      for (const p of this.players.values()) c[p.team]++;
      team = c[0] <= c[1] ? 0 : 1;
    }
    const hero = heroId ? HERO_BY_ID[heroId] : null;
    const maxHp = hero?.maxHp ?? this.combat.health.trainingBodyHp;
    const activeWeapon = hero?.weapon ?? this.combat.trainingWeapon;
    const resourceDef = hero?.passive?.resource;
    const pl = {
      id, name, team, isBot,
      move: makeMoveState([0, 0, 0], 0),
      heroId: hero?.id ?? null,
      maxHp,
      hp: maxHp,
      shield: 0,
      alive: true,
      flags: { invulnerable: false, intangible: false },
      weapon: makeWeaponState(activeWeapon),
      abilities: makeAbilityState(),
      resource: resourceDef ? {
        id: resourceDef.id,
        name: resourceDef.name,
        value: resourceDef.initial ?? 0,
        max: resourceDef.max,
      } : null,
      input: { ...EMPTY_INPUT },
      inputCommandState: { ...EMPTY_INPUT },
      pendingActionInputs: [],
      inputQueue: [],
      lastAcceptedInputSeq: 0,
      lastAckSeq: 0,
      lastRetiredInputSeq: 0,
      inputLeaseExpiresAtMs: null,
      inputLeaseNeutralized: true,
      appliedRewindMs: 0,
      historyGeneration: 0,
      spawnProtected: false,
      spawnProtectionEndsAt: 0,
      insideObjective: false,
      ultGauge: 0, // Phase 4で使用。ラウンド間50%減衰の枠のみ確保
      stats: { kills: 0, deaths: 0, dmg: 0, healing: 0, objectiveSec: 0 },
      spawnIndex: (this.nextId + 3) % 5,
      lastResourcePos: [0, 0, 0],
      lastResourceSpendT: Number.NEGATIVE_INFINITY,
      setupUltGauge: 0,
    };
    this.players.set(id, pl);
    this.spawnAtBase(pl);
    return pl;
  }

  selectHero(id, heroId) {
    const pl = this.players.get(id);
    const hero = HERO_BY_ID[heroId];
    if (!pl || !hero) return false;
    if (this.flow.state !== 'SETUP' && pl.alive) return false;
    pl.heroId = hero.id;
    pl.maxHp = hero.maxHp;
    pl.hp = hero.maxHp;
    pl.shield = 0;
    pl.weapon = makeWeaponState(hero.weapon);
    pl.abilities = makeAbilityState();
    const resourceDef = hero.passive?.resource;
    pl.resource = resourceDef ? {
      id: resourceDef.id,
      name: resourceDef.name,
      value: resourceDef.initial ?? 0,
      max: resourceDef.max,
    } : null;
    pl.lastResourcePos = [...pl.move.pos];
    pl.lastResourceSpendT = Number.NEGATIVE_INFINITY;
    this.bumpHistoryGeneration(pl);
    this.events.push({ type: 'hero_selected', player: pl.id, heroId: hero.id });
    return true;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.respawn.cancel(id);
  }

  sideOf(team) { return this.flow.sides[team]; }

  spawnAtBase(pl, { safe = false, protect = false } = {}) {
    const pts = this.map.spawns[this.sideOf(pl.team)];
    const resolved = pts.map(point => this.resolveSpawnPoint(point));
    const valid = resolved.filter(Boolean);
    if (valid.length === 0) {
      pl.alive = false;
      pl.hp = 0;
      pl.shield = 0;
      pl.insideObjective = false;
      pl.move.grounded = false;
      pl.spawnProtected = false;
      pl.spawnProtectionEndsAt = this.t;
      this.respawn.onDeath(pl.id, this.objective.time);
      this.events.push({
        type: 'spawn_failed', player: pl.id, reason: 'no_walkable_surface',
      });
      return false;
    }
    const preferredIndex = pl.spawnIndex % pts.length;
    const sp = safe
      ? this.selectSafeSpawn(pl, valid)
      : resolved.slice(preferredIndex).concat(resolved.slice(0, preferredIndex)).find(Boolean);
    pl.move = makeMoveState(sp.pos, sp.yaw);
    pl.move.grounded = true;
    pl.hp = pl.maxHp;
    pl.shield = 0;
    pl.alive = true;
    pl.flags.invulnerable = false;
    pl.flags.intangible = false;
    pl.insideObjective = false;
    const hero = pl.heroId ? HERO_BY_ID[pl.heroId] : null;
    pl.weapon = makeWeaponState(hero?.weapon ?? this.combat.trainingWeapon);
    pl.abilities.cast = null;
    pl.abilities.previous = { secondary: false, ability1: false, ability2: false, ultimate: false };
    pl.input = {
      ...pl.input, fire: false, secondary: false, ability1: false,
      ability2: false, ultimate: false, reload: false,
    };
    pl.inputCommandState = { ...pl.input };
    pl.pendingActionInputs.length = 0;
    pl.lastResourcePos = [...pl.move.pos];
    this.bumpHistoryGeneration(pl);
    pl.spawnProtected = !!protect;
    pl.spawnProtectionEndsAt = protect ? this.t + SPAWN_PROTECTION_SEC : this.t;
    return true;
  }

  resolveSpawnPoint(point) {
    const [x, y, authoredZ] = point?.pos || [];
    if (![x, y, authoredZ].every(Number.isFinite)) return null;
    const radius = this.mv.capsuleRadiusM;
    const height = this.mv.standHeightM;
    const maxStep = Number.isFinite(this.mv.stepUpM) ? Math.max(0, this.mv.stepUpM) : 0;
    const floorZ = this.collider.groundHeight(x, y, authoredZ, radius, maxStep);
    if (!Number.isFinite(floorZ)) return null;
    if (this.collider.overlapsCylinder(x, y, floorZ, radius, height)) return null;
    return { ...point, pos: [x, y, floorZ] };
  }

  bumpHistoryGeneration(pl) {
    pl.historyGeneration = (pl.historyGeneration || 0) + 1;
  }

  clearSpawnProtection(pl, reason = 'expired') {
    if (!pl?.spawnProtected) return false;
    pl.spawnProtected = false;
    pl.spawnProtectionEndsAt = this.t;
    this.events.push({ type: 'spawn_protection_ended', player: pl.id, reason });
    return true;
  }

  updateSpawnProtection(pl) {
    if (pl.spawnProtected && this.t + 1e-9 >= pl.spawnProtectionEndsAt) this.clearSpawnProtection(pl, 'expired');
  }

  selectSafeSpawn(pl, points) {
    return selectSafeSpawn({
      player: pl,
      points,
      players: this.players.values(),
      collider: this.collider,
      movement: this.mv,
    });
  }

  queueInput(id, input) {
    return this.queueInputResult(id, input).ok;
  }

  queueInputResult(id, input, receivedAtMs) {
    const pl = this.players.get(id);
    if (!pl || !input || typeof input !== 'object' || Array.isArray(input)) {
      this.noteInputRejection('invalid_input');
      return { ok: false, code: 'invalid_input' };
    }
    if (input.seq === undefined) {
      // Trusted simulation fixtures may set a partial state directly. WebSocket input
      // always has a sanitized seq and therefore cannot bypass the bounded FIFO.
      pl.input = { ...pl.input, ...input };
      pl.inputCommandState = { ...pl.inputCommandState, ...input };
      if (!pl.isBot && (input.appliedRewindMs !== undefined || input.interpMs !== undefined)) {
        const requested = input.appliedRewindMs ?? input.interpMs;
        pl.appliedRewindMs = Math.min(
          Math.round(this.combat.lagComp.maxRewindSec * 1000),
          Math.max(0, Math.round(Number.isFinite(requested) ? requested : 0)),
        );
      }
      return { ok: true };
    }
    if (!Number.isSafeInteger(input.seq)) {
      this.noteInputRejection('invalid_input');
      return { ok: false, code: 'invalid_input' };
    }
    if (pl.isBot) {
      if (input.seq <= pl.lastAcceptedInputSeq) {
        this.noteInputRejection('stale_input');
        return { ok: false, code: 'stale_input' };
      }
      pl.lastAcceptedInputSeq = input.seq;
      pl.lastAckSeq = input.seq;
      pl.lastRetiredInputSeq = input.seq;
      pl.input = { ...pl.input, ...input };
      pl.inputCommandState = { ...pl.inputCommandState, ...input };
      return { ok: true };
    }
    const resolvedThroughSeq = Math.max(pl.lastAckSeq, pl.lastRetiredInputSeq);
    if (
      input.seq <= resolvedThroughSeq
      || pl.inputQueue.some(entry => entry.input.seq === input.seq)
    ) {
      this.noteInputRejection('stale_input');
      return { ok: false, code: 'stale_input' };
    }
    if (pl.inputQueue.length >= INPUT_COMMAND_QUEUE_CAPACITY) {
      this.noteInputRejection('input_queue_full');
      return { ok: false, code: 'input_queue_full' };
    }
    if (input.seq > resolvedThroughSeq + INPUT_REORDER_WINDOW) {
      this.noteInputRejection('input_seq_out_of_window');
      return { ok: false, code: 'input_seq_out_of_window' };
    }
    let nextContiguousSeq = resolvedThroughSeq + 1;
    for (const queued of pl.inputQueue) {
      if (queued.input.seq !== nextContiguousSeq) break;
      nextContiguousSeq++;
    }
    const acceptedAtMs = Number.isFinite(receivedAtMs) ? receivedAtMs : this.t * 1000;
    const entry = { input: { ...input }, receivedAtMs: acceptedAtMs };
    const insertAt = pl.inputQueue.findIndex(candidate => candidate.input.seq > input.seq);
    if (insertAt < 0) pl.inputQueue.push(entry);
    else pl.inputQueue.splice(insertAt, 0, entry);
    if (input.seq !== nextContiguousSeq) this.inputCommandMetrics.reorderedAccepted++;
    pl.lastAcceptedInputSeq = Math.max(pl.lastAcceptedInputSeq, input.seq);
    pl.inputLeaseExpiresAtMs = acceptedAtMs + INPUT_LEASE_MS;
    pl.inputLeaseNeutralized = false;
    this.inputCommandMetrics.accepted++;
    this.inputCommandMetrics.highWatermark = Math.max(
      this.inputCommandMetrics.highWatermark,
      pl.inputQueue.length,
    );
    return { ok: true };
  }

  applyQueuedInputs(pl, nowMs) {
    pl.input = { ...pl.input, ...pl.inputCommandState };
    pl.pendingActionInputs.length = 0;
    const first = pl.inputQueue[0];
    if (!first || first.receivedAtMs > nowMs + 1e-9) return false;

    let expectedSeq = Math.max(pl.lastAckSeq, pl.lastRetiredInputSeq) + 1;
    if (first.input.seq > expectedSeq) {
      if (nowMs - first.receivedAtMs + 1e-9 < INPUT_REORDER_WAIT_MS) return false;
      this.inputCommandMetrics.reorderGapsSkipped++;
      this.inputCommandMetrics.reorderMissingSequences += first.input.seq - expectedSeq;
      pl.lastRetiredInputSeq = first.input.seq - 1;
      expectedSeq = first.input.seq;
    }

    const batch = [];
    while (pl.inputQueue.length > 0) {
      const entry = pl.inputQueue[0];
      if (entry.receivedAtMs > nowMs + 1e-9 || entry.input.seq !== expectedSeq) break;
      batch.push(pl.inputQueue.shift());
      expectedSeq++;
    }
    if (batch.length === 0) return false;

    let commandState = { ...pl.inputCommandState };
    let jumpPressed = false;
    for (const { input } of batch) {
      if (input.jump && !commandState.jump) jumpPressed = true;
      commandState = { ...commandState, ...input };
    }
    pl.inputCommandState = commandState;
    pl.input = { ...pl.input, ...commandState, jump: jumpPressed || commandState.jump };
    pl.pendingActionInputs = batch.map(entry => ({ ...entry.input }));
    pl.appliedRewindMs = pl.isBot ? 0 : Math.max(0, Math.round(commandState.appliedRewindMs || 0));
    pl.lastAckSeq = batch.at(-1).input.seq;
    pl.lastRetiredInputSeq = Math.max(pl.lastRetiredInputSeq, pl.lastAckSeq);
    this.inputCommandMetrics.applied += batch.length;
    return true;
  }

  expireInputLease(pl, nowMs) {
    if (
      pl.isBot
      || pl.inputLeaseNeutralized
      || pl.inputLeaseExpiresAtMs === null
      || nowMs + 1e-9 < pl.inputLeaseExpiresAtMs
    ) return false;
    const discarded = pl.inputQueue.length;
    const discardedThroughSeq = pl.inputQueue.at(-1)?.input.seq ?? pl.lastRetiredInputSeq;
    this.setNeutralInputState(pl, pl.lastAckSeq);
    pl.lastRetiredInputSeq = Math.max(pl.lastRetiredInputSeq, discardedThroughSeq);
    pl.inputLeaseExpiresAtMs = null;
    pl.inputLeaseNeutralized = true;
    this.inputCommandMetrics.leaseExpirations++;
    this.inputCommandMetrics.discardedOnLease += discarded;
    return true;
  }

  neutralizeInput(id, options = {}) {
    const pl = this.players.get(id);
    if (!pl) return false;
    const discarded = pl.inputQueue.length;
    const discardedThroughSeq = pl.inputQueue.at(-1)?.input.seq ?? pl.lastRetiredInputSeq;
    this.setNeutralInputState(pl, options.resetSequence ? 0 : pl.lastAckSeq);
    this.inputCommandMetrics.discardedOnNeutralize += discarded;
    pl.inputLeaseExpiresAtMs = null;
    pl.inputLeaseNeutralized = true;
    if (options.resetSequence) {
      const sequenceBase = Number.isSafeInteger(options.sequenceBase) && options.sequenceBase >= 0
        ? options.sequenceBase
        : 0;
      pl.lastAcceptedInputSeq = sequenceBase;
      pl.lastAckSeq = sequenceBase;
      pl.lastRetiredInputSeq = sequenceBase;
    } else if (options.acceptedToApplied) {
      pl.lastAcceptedInputSeq = pl.lastAckSeq;
      pl.lastRetiredInputSeq = pl.lastAckSeq;
    } else {
      pl.lastRetiredInputSeq = Math.max(pl.lastRetiredInputSeq, discardedThroughSeq);
    }
    return true;
  }

  setNeutralInputState(pl, seq) {
    pl.inputQueue.length = 0;
    pl.input = {
      ...EMPTY_INPUT,
      yaw: pl.move.yaw,
      pitch: pl.move.pitch,
      seq,
      interpMs: pl.input.interpMs,
    };
    pl.inputCommandState = { ...pl.input };
    pl.pendingActionInputs.length = 0;
    for (const slot of ['secondary', 'ability1', 'ability2', 'ultimate']) {
      pl.abilities.previous[slot] = false;
    }
    pl.weapon.chargeStartedAt = null;
  }

  noteInputRejection(code) {
    if (code === 'stale_input') this.inputCommandMetrics.rejectedStale++;
    else if (code === 'input_queue_full') this.inputCommandMetrics.rejectedOverflow++;
    else if (code === 'input_seq_out_of_window') this.inputCommandMetrics.rejectedReorderWindow++;
    else this.inputCommandMetrics.rejectedInvalid++;
  }

  inputCommandHealth() {
    let queued = 0;
    for (const player of this.players.values()) queued += player.inputQueue.length;
    const metrics = this.inputCommandMetrics;
    return {
      capacityPerPlayer: INPUT_COMMAND_QUEUE_CAPACITY,
      leaseMs: INPUT_LEASE_MS,
      queued,
      accepted: metrics.accepted,
      applied: metrics.applied,
      rejected: {
        invalid: metrics.rejectedInvalid,
        stale: metrics.rejectedStale,
        overflow: metrics.rejectedOverflow,
        outOfWindow: metrics.rejectedReorderWindow,
      },
      leaseExpirations: metrics.leaseExpirations,
      discardedOnLease: metrics.discardedOnLease,
      discardedOnNeutralize: metrics.discardedOnNeutralize,
      reorder: {
        window: INPUT_REORDER_WINDOW,
        waitMs: INPUT_REORDER_WAIT_MS,
        bufferedOutOfOrder: metrics.reorderedAccepted,
        gapsSkipped: metrics.reorderGapsSkipped,
        missingSequences: metrics.reorderMissingSequences,
      },
      highWatermark: metrics.highWatermark,
    };
  }

  eliminatePlayer(target, {
    source = null,
    headshot = false,
    abilityId = null,
    cause = null,
    environment = null,
  } = {}) {
    if (!target?.alive) return false;
    target.hp = 0;
    target.alive = false;
    target.insideObjective = false;
    target.shield = 0;
    target.spawnProtected = false;
    target.spawnProtectionEndsAt = this.t;
    interruptAbility(this, target, 'death');
    target.abilities.statuses = [];
    target.abilities.heroState = {};
    if (target.resource?.id === 'pain') target.resource.value = 0;
    target.stats.deaths++;
    if (source) source.stats.kills++;
    this.respawn.onDeath(target.id, this.objective.time);
    const event = {
      type: 'kill', target: target.id, source: source?.id,
      headshot: !!headshot, abilityId: abilityId || null,
    };
    if (cause) event.cause = cause;
    if (environment) event.environment = environment;
    this.events.push(event);
    this.logEvent({
      type: 'kill', target: target.id, source: source?.id,
      abilityId: abilityId || null,
      ...(cause ? { cause } : {}),
      ...(environment ? { environment } : {}),
    });
    return true;
  }

  applyDamage(target, amount, source, headshot, meta = {}) {
    if (!target.alive || this.flow.state !== 'ACTIVE') return;
    if (target.flags.invulnerable || target.flags.intangible || target.spawnProtected) return;
    let finalAmount = Math.max(0, amount);
    if (source) finalAmount *= outgoingDamageMultiplier(source);
    finalAmount *= incomingDamageMultiplier(target);

    if (!meta.redirected) {
      const redirect = redirectStatus(target);
      const redirectTarget = redirect ? this.players.get(redirect.redirectTo) : null;
      if (redirectTarget?.alive && redirectTarget.id !== target.id) {
        const redirected = finalAmount * Math.max(0, Math.min(0.8, redirect.redirectPct));
        finalAmount -= redirected;
        this.applyDamage(redirectTarget, redirected, source, false, { ...meta, redirected: true });
        if (redirectTarget.resource?.id === 'pain') {
          redirectTarget.resource.value = Math.min(redirectTarget.resource.max, redirectTarget.resource.value + redirected * 0.5);
        }
      }
    }

    const shieldAbsorb = Math.min(target.shield || 0, finalAmount);
    target.shield = Math.max(0, (target.shield || 0) - shieldAbsorb);
    finalAmount -= shieldAbsorb;
    const healthDamage = Math.min(target.hp, finalAmount);
    target.hp -= healthDamage;
    if (healthDamage > 0 && target.abilities.heroState.transit?.kind === 'rewind') {
      target.abilities.heroState.transit.endsAt += 0.3;
    }
    if (source) {
      source.stats.dmg += healthDamage;
      source.ultGauge = Math.min(100, source.ultGauge + healthDamage / 21);
    }
    if (target.resource?.id === 'forge') target.resource.value = Math.min(target.resource.max, target.resource.value + healthDamage * 0.2);
    if (target.resource?.id === 'momentum' && healthDamage + shieldAbsorb > 0) {
      target.resource.value = Math.max(0, target.resource.value - 12);
    }
    const damageOrigin = finiteVector3(meta.damageOrigin);
    const damageDirection = damageOrigin
      ? roundVec(damageOrigin.map((value, index) => value - target.move.pos[index]), 1000)
      : finiteVector3(meta.damageDirection);
    this.events.push({
      type: 'hit', target: target.id, source: source?.id,
      amount: Math.round((healthDamage + shieldAbsorb) * 10) / 10,
      healthDamage: Math.round(healthDamage * 10) / 10,
      shieldDamage: Math.round(shieldAbsorb * 10) / 10,
      headshot: !!headshot, abilityId: meta.abilityId || null,
      damageOrigin,
      damageDirection,
    });
    if (target.hp <= 0) {
      this.eliminatePlayer(target, {
        source, headshot, abilityId: meta.abilityId || null,
      });
    }
  }

  healPlayer(target, amount, source = null, abilityId = null) {
    if (!target?.alive || amount <= 0) return 0;
    const healed = Math.min(amount, target.maxHp - target.hp);
    if (healed <= 0) return 0;
    target.hp += healed;
    if (source) {
      source.stats.healing += healed;
      source.ultGauge = Math.min(100, source.ultGauge + healed / 23);
    }
    this.events.push({ type: 'heal', target: target.id, source: source?.id, amount: Math.round(healed * 10) / 10, abilityId });
    return healed;
  }

  logEvent(e) {
    this.log.push({ tick: this.tickCount, t: Math.round(this.t * 100) / 100, ...e });
  }

  // 遅延補償: interpMs+片道遅延ぶん過去の位置で判定（上限maxRewindSec）
  targetsAt(rewindSec) {
    const maxRewind = this.combat.lagComp.maxRewindSec;
    const requested = Number.isFinite(rewindSec) && rewindSec >= 0 && rewindSec <= maxRewind
      ? rewindSec
      : 0;
    const ticksBack = Math.min(
      Math.round(requested / this.dt),
      Math.round(maxRewind / this.dt),
      this.history.length,
    );
    const snap = ticksBack > 0 ? this.history[this.history.length - ticksBack] : null;
    const out = [];
    for (const pl of this.players.values()) {
      if (!pl.alive || pl.flags.invulnerable || pl.flags.intangible || pl.spawnProtected) continue;
      const h = snap?.get(pl.id);
      out.push({
        id: pl.id, team: pl.team,
        pos: h && (h.generation === undefined || h.generation === pl.historyGeneration) ? h.pos : [...pl.move.pos],
        crouch: h && (h.generation === undefined || h.generation === pl.historyGeneration) ? h.crouch : pl.move.crouch,
      });
    }
    return out;
  }

  processFire(pl) {
    const w = this.weaponDefinitionFor(pl);
    if (!pl.alive) return;
    if (
      pl.abilities.cast
      || pl.abilities.heroState.transit
      || pl.abilities.heroState.anchorRecall
      || pl.abilities.statuses.some(status => status.attackLocked)
    ) return;
    if (w.type === 'charge') {
      this.processChargeWeapon(pl, w);
      return;
    }
    if (!pl.input.reload && !pl.input.fire) return;
    if (!tryBeginFire(pl, w, this.t, pl.input.reload && !pl.input.fire)) return;
    if (pl.resource?.id === 'needles') pl.resource.value = pl.weapon.ammo;
    if (!pl.input.fire) return;
    this.emitWeaponAttack(pl, w);
  }

  weaponDefinitionFor(pl) {
    const weapon = pl.heroId ? HERO_BY_ID[pl.heroId].weapon : this.combat.trainingWeapon;
    if (pl.heroId !== 'tsubakuro' || pl.resource?.id !== 'momentum') return weapon;
    const ratio = Math.max(0, Math.min(1, pl.resource.value / Math.max(1, pl.resource.max)));
    return {
      ...weapon,
      damage: lerp(weapon.damage, weapon.maxDamage || weapon.damage, ratio),
      rps: lerp(weapon.rps, weapon.maxRps || weapon.rps, ratio),
      reloadSec: lerp(weapon.reloadSec, weapon.minReloadSec ?? 0.9, ratio),
    };
  }

  applyAsagiMark(source, target, amount) {
    if (!source?.alive || source.heroId !== 'asagi' || !target?.alive) return null;
    const id = `asagi_mark:${source.id}`;
    const existing = target.abilities.statuses.find(status => status.id === id && status.sourceId === source.id);
    const stacks = Math.min(5, (existing?.stacks || 0) + Math.max(0, amount || 0));
    const revealed = stacks >= 5 || !!existing?.revealed;
    const status = applyStatus(this, target, {
      id, kind: 'reveal', stacks, revealed, negative: true,
      lastHitAt: this.t,
      nextDecayAt: revealed ? Number.POSITIVE_INFINITY : this.t + 1.5,
    }, revealed ? 4 : 6, source);
    if (source.resource?.id === 'mark') source.resource.value = Math.max(source.resource.value, stacks);
    return status;
  }

  closestWeaponCollision(origin, dir, maxDist, targets, shooter, targetMode = 'enemy', includeCover = true, radiusM = 0) {
    const hit = hitscan(
      this.collider, this.mv, this.combat.headHitbox, origin, dir, maxDist,
      targets, shooter.id, shooter.team, targetMode, radiusM,
    );
    if (!includeCover) return hit;
    const barrier = barrierHit(this, origin, dir, hit.dist, shooter.team);
    const deployable = deployableHit(this, origin, dir, hit.dist, shooter.team);
    if (deployable && (!barrier || deployable.dist < barrier.dist)) {
      return { type: 'deployable', dist: deployable.dist, zone: deployable.zone };
    }
    if (barrier) return { type: 'barrier', dist: barrier.dist, barrier: barrier.barrier };
    return hit;
  }

  weaponShotPath(player, weapon, eyeDir, maxDist, targets, targetMode = 'enemy', includeCover = true, radiusM = 0) {
    const eye = eyePosition(player, this.mv);
    const muzzle = weaponMuzzlePosition(eye, player.move.yaw, player.move.pitch, weapon);
    const eyeTrace = this.trimmedWeaponCollision(
      eye, eyeDir, maxDist, targets, player, targetMode, includeCover, 0, false,
    );
    const aimDist = eyeTrace?.dist ?? maxDist;
    const aimPoint = pointAlong(eye, eyeDir, aimDist);

    const bridgeVector = muzzle.map((value, index) => value - eye[index]);
    const bridge = normalizedVector(bridgeVector);
    if (bridge.length > WEAPON_TRACE_EPSILON_M * 2) {
      const obstruction = this.trimmedWeaponCollision(
        eye, bridge.dir, bridge.length, targets, player, targetMode,
        includeCover, radiusM, true,
      );
      if (obstruction) {
        return {
          origin: eye, dir: bridge.dir,
          maxDist: Math.min(maxDist, obstruction.dist + WEAPON_TRACE_EPSILON_M),
          collision: obstruction, bridgeObstructed: true,
        };
      }
    }

    const muzzleToAim = aimPoint.map((value, index) => value - muzzle[index]);
    const physical = normalizedVector(muzzleToAim);
    const forwardProgress = muzzleToAim.reduce((sum, value, index) => sum + value * eyeDir[index], 0);
    const dir = physical.length > WEAPON_TRACE_EPSILON_M && forwardProgress > WEAPON_TRACE_EPSILON_M
      ? physical.dir
      : eyeDir;
    const collision = this.trimmedWeaponCollision(
      muzzle, dir, maxDist, targets, player, targetMode, includeCover, radiusM, false,
    );
    return { origin: muzzle, dir, maxDist, collision, bridgeObstructed: false };
  }

  trimmedWeaponCollision(origin, dir, maxDist, targets, shooter, targetMode, includeCover, radiusM, trimEnd) {
    const startOffset = Math.min(WEAPON_TRACE_EPSILON_M, Math.max(0, maxDist / 4));
    const endOffset = trimEnd ? startOffset : 0;
    const traceDistance = Math.max(0, maxDist - startOffset - endOffset);
    if (traceDistance <= 0) return null;
    const traceOrigin = pointAlong(origin, dir, startOffset);
    const collision = this.closestWeaponCollision(
      traceOrigin, dir, traceDistance, targets, shooter, targetMode, includeCover, radiusM,
    );
    if (!collision || collision.type === 'none') return null;
    return { ...collision, dist: collision.dist + startOffset };
  }

  precisionAbilityShot(player, definition) {
    if (player.weapon.ammo <= 0) return false;
    const eyeDir = fireDirection(player.move.yaw, player.move.pitch, 0, this.rng);
    const path = this.weaponShotPath(
      player, this.weaponDefinitionFor(player), eyeDir, definition.rangeM || 55,
      this.targetsAt(0), 'enemy', true,
    );
    const hit = path.collision || { type: 'none', dist: path.maxDist };
    player.weapon.ammo--;
    this.events.push({
      type: 'shot', source: player.id, origin: roundVec(path.origin), dir: roundVec(path.dir, 1000),
      dist: round1(hit.dist), weaponId: definition.id,
      attackId: this.nextAttackId++, pelletIndex: 0, pelletCount: 1,
    });
    if (hit.type === 'deployable') {
      this.damageDeployable(hit.zone, definition.damage || 50, player, definition.id);
      return true;
    }
    if (hit.type === 'barrier') {
      const damage = definition.damage || 50;
      hit.barrier.hp -= damage;
      this.events.push({ type: 'barrier_hit', source: player.id, barrier: hit.barrier.id, amount: round1(damage), abilityId: definition.id });
      return true;
    }
    if (hit.type !== 'player') return false;
    const target = this.players.get(hit.target.id);
    if (!target) return false;
    const damage = hit.headshot ? (definition.headshotDamage || (definition.damage || 50) * 2) : (definition.damage || 50);
    this.applyDamage(target, damage, player, hit.headshot, {
      abilityId: definition.id, ...weaponDamageMeta(path.origin, target),
    });
    this.applyAsagiMark(player, target, 2);
    return true;
  }

  damageDeployable(zone, amount, source, abilityId = null, projectileId = null) {
    if (!zone || zone.hp === undefined || zone.hp <= 0) return false;
    const dealt = Math.max(0, amount || 0);
    zone.hp -= dealt;
    this.events.push({
      type: 'deployable_hit', source: source?.id, zone: zone.id,
      amount: round1(dealt), hp: Math.max(0, round1(zone.hp)), abilityId, projectileId,
    });
    if (zone.hp <= 0) this.events.push({ type: 'deployable_destroyed', zone: zone.id, source: source?.id, abilityId, projectileId });
    return true;
  }

  processChargeWeapon(pl, weapon) {
    if (pl.input.reload) {
      pl.weapon.chargeStartedAt = null;
      tryBeginFire(pl, weapon, this.t, true);
      return;
    }
    if (pl.input.fire && pl.weapon.chargeStartedAt === null) {
      if (this.t < pl.weapon.nextFireT) return;
      if (weapon.resourceCost && (!pl.resource || pl.resource.value < weapon.resourceCost)) return;
      pl.weapon.chargeStartedAt = this.t;
      this.events.push({ type: 'weapon_charge', source: pl.id, weaponId: weapon.id, chargeSec: weapon.chargeSec });
      return;
    }
    if (pl.weapon.chargeStartedAt === null) return;
    const heldSec = Math.max(0, this.t - pl.weapon.chargeStartedAt);
    if (pl.input.fire && heldSec + 1e-9 < weapon.chargeSec) return;

    let ratio = Math.max(0, Math.min(1, heldSec / Math.max(0.01, weapon.chargeSec)));
    const resourceCost = lerp(weapon.resourceCost || 0, weapon.maxResourceCost || weapon.resourceCost || 0, ratio);
    if (resourceCost && (!pl.resource || pl.resource.value + 1e-9 < resourceCost)) {
      const availableRatio = (pl.resource.value - (weapon.resourceCost || 0))
        / Math.max(0.01, (weapon.maxResourceCost || weapon.resourceCost) - (weapon.resourceCost || 0));
      ratio = Math.max(0, Math.min(ratio, availableRatio));
    }
    const actualCost = lerp(weapon.resourceCost || 0, weapon.maxResourceCost || weapon.resourceCost || 0, ratio);
    if (actualCost && pl.resource) {
      pl.resource.value = Math.max(0, pl.resource.value - actualCost);
      pl.lastResourceSpendT = this.t;
    }
    pl.weapon.chargeStartedAt = null;
    if (!tryBeginFire(pl, weapon, this.t, false)) return;
    const charged = {
      ...weapon,
      damage: lerp(weapon.damage, weapon.maxDamage || weapon.damage, ratio),
      projectileSpeedMps: lerp(weapon.projectileSpeedMps || 35, weapon.maxProjectileSpeedMps || weapon.projectileSpeedMps || 35, ratio),
      splashDamage: (weapon.splashDamage || 0) * ratio,
      splashRadiusM: (weapon.splashRadiusM || 0) * ratio,
    };
    this.emitWeaponAttack(pl, charged, { chargeRatio: ratio });
  }

  emitWeaponAttack(pl, weapon, metadata = {}) {
    this.clearSpawnProtection(pl, 'attack');
    const attackId = this.nextAttackId++;
    const rewind = pl.isBot ? 0 : pl.appliedRewindMs / 1000;
    const targets = this.targetsAt(rewind);
    const statusMultiShot = pl.abilities.statuses.reduce((value, status) => Math.max(value, status.multiShot || 1), 1);
    const finiteAmmo = weapon.reloadSec > 0 && weapon.magSize > 0;
    const burstRounds = weapon.burstCount
      ? (finiteAmmo ? Math.min(weapon.burstCount, Math.max(1, pl.weapon.ammo + 1)) : weapon.burstCount)
      : 1;
    const perTrigger = Math.max(1, weapon.pellets || burstRounds);
    const shotCount = Math.max(1, perTrigger * statusMultiShot);
    if (weapon.burstCount && finiteAmmo) {
      pl.weapon.ammo = Math.max(0, pl.weapon.ammo - (burstRounds - 1));
    }
    const canAffectAllies = !!(weapon.allyHealStored || weapon.allyHeal);
    for (let shot = 0; shot < shotCount; shot++) {
      const eyeDir = fireDirection(pl.move.yaw, pl.move.pitch, weapon.spreadDeg || 0, this.rng);
      if (weapon.type === 'hybrid_melee_projectile') {
        const meleePath = this.weaponShotPath(
          pl, weapon, eyeDir, weapon.meleeRangeM, targets, 'enemy', true,
        );
        const meleeHit = meleePath.collision;
        if (meleeHit?.type === 'player') {
          const target = this.players.get(meleeHit.target.id);
          this.events.push({ type: 'shot', source: pl.id, origin: roundVec(meleePath.origin), dir: roundVec(meleePath.dir, 1000), dist: round1(meleeHit.dist), weaponId: weapon.id, melee: true, attackId, pelletIndex: shot, pelletCount: shotCount });
          if (target) this.applyDamage(target, weapon.meleeDamage, pl, false, {
            abilityId: weapon.id, ...weaponDamageMeta(meleePath.origin, target),
          });
          continue;
        }
      }

      if (weapon.projectileSpeedMps) {
        const path = this.weaponShotPath(
          pl, weapon, eyeDir, weapon.maxRangeM, targets,
          canAffectAllies ? 'any' : 'enemy', true, weapon.projectileRadiusM,
        );
        spawnWeaponProjectile(this, pl, weapon, path.origin, path.dir, {
          maxRangeM: path.bridgeObstructed ? path.maxDist : weapon.maxRangeM,
        });
        this.events.push({
          type: 'shot', source: pl.id, origin: roundVec(path.origin), dir: roundVec(path.dir, 1000),
          dist: path.maxDist, weaponId: weapon.id, projectile: true,
          chargeRatio: metadata.chargeRatio ?? null, attackId, pelletIndex: shot, pelletCount: shotCount,
        });
        continue;
      }

      const path = this.weaponShotPath(
        pl, weapon, eyeDir, weapon.maxRangeM, targets,
        canAffectAllies ? 'any' : 'enemy', !canAffectAllies,
      );
      const hit = path.collision || { type: 'none', dist: path.maxDist };
      if (hit.type === 'deployable') {
        const dealt = damageAtRange(weapon, hit.dist, false);
        this.damageDeployable(hit.zone, dealt, pl, weapon.id);
        this.events.push({
          type: 'shot', source: pl.id, origin: roundVec(path.origin), dir: roundVec(path.dir, 1000),
          dist: round1(hit.dist), weaponId: weapon.id, attackId, pelletIndex: shot, pelletCount: shotCount,
        });
        continue;
      }
      if (hit.type === 'barrier') {
        const dealt = damageAtRange(weapon, hit.dist, false);
        hit.barrier.hp -= dealt;
        this.events.push({ type: 'barrier_hit', source: pl.id, barrier: hit.barrier.id, amount: round1(dealt) });
        if (hit.barrier.hp <= 0) this.events.push({ type: 'barrier_destroyed', barrier: hit.barrier.id, source: pl.id });
        this.events.push({ type: 'shot', source: pl.id, origin: roundVec(path.origin), dir: roundVec(path.dir, 1000), dist: round1(hit.dist), weaponId: weapon.id, attackId, pelletIndex: shot, pelletCount: shotCount });
        continue;
      }
      this.events.push({ type: 'shot', source: pl.id, origin: roundVec(path.origin), dir: roundVec(path.dir, 1000), dist: round1(hit.dist), weaponId: weapon.id, attackId, pelletIndex: shot, pelletCount: shotCount });
      if (hit.type !== 'player') continue;
      const target = this.players.get(hit.target.id);
      if (!target) continue;
      if (target.team === pl.team) {
        if (weapon.allyHealStored) storeHeal(this, target, weapon.allyHealStored, pl, weapon.id);
        if (weapon.allyHeal) this.healPlayer(target, weapon.allyHeal, pl, weapon.id);
        continue;
      }
      this.applyDamage(target, damageAtRange(weapon, hit.dist, hit.headshot), pl, hit.headshot, {
        abilityId: weapon.id, ...weaponDamageMeta(path.origin, target),
      });
      if (pl.heroId === 'asagi') {
        this.applyAsagiMark(pl, target, 1);
      }
    }
    if (pl.resource?.id === 'heat') pl.resource.value = Math.min(pl.resource.max, pl.resource.value + 8);
  }

  tick(inputNowMs) {
    this.tickCount++;
    this.t += this.dt;
    const leaseNowMs = Number.isFinite(inputNowMs) ? inputNowMs : this.t * 1000;
    const state = this.flow.state;
    const frozen = state === 'ROUND_END' || state === 'MATCH_END';
    tickWorldAbilityEffects(this);
    if (!frozen) tickProjectiles(this, this.dt);

    // 扉: SETUP中のみ有効
    this.collider.dynamic = state === 'SETUP' ? this.map.setupDoors : [];

    // 移動と射撃
    for (const pl of this.players.values()) {
      if (!this.expireInputLease(pl, leaseNowMs)) this.applyQueuedInputs(pl, leaseNowMs);
      this.updateSpawnProtection(pl);
      if (!pl.alive || frozen) {
        pl.pendingActionInputs.length = 0;
        pl.input = { ...pl.inputCommandState };
        continue;
      }
      tickWeaponState(pl, this.weaponDefinitionFor(pl), this.t);
      tickAbilityState(this, pl, this.dt);
      const speedMult = movementMultiplier(pl);
      const moveConfig = speedMult === 1 ? this.mv : { ...this.mv, baseSpeedMps: this.mv.baseSpeedMps * speedMult };
      if (!pl.abilities.heroState.transit) moveStep(pl.move, pl.input, this.dt, this.collider, moveConfig);
      if (
        state === 'ACTIVE'
        && Number.isFinite(this.map.killZ)
        && pl.move.pos[2] < this.map.killZ
      ) {
        pl.move.grounded = false;
        this.eliminatePlayer(pl, { cause: 'environment', environment: 'void_fall' });
        pl.pendingActionInputs.length = 0;
        pl.input = { ...pl.inputCommandState };
        continue;
      }
      this.updatePassiveResource(pl);
      if (state === 'ACTIVE' || state === 'SETUP') {
        const eventCount = this.events.length;
        const actionInputs = pl.pendingActionInputs.length > 0
          ? pl.pendingActionInputs
          : [pl.inputCommandState];
        for (const actionInput of actionInputs) {
          pl.input = { ...pl.inputCommandState, ...actionInput };
          pl.move.yaw = pl.input.yaw;
          pl.move.pitch = pl.input.pitch;
          pl.appliedRewindMs = pl.isBot ? 0 : Math.max(0, Math.round(pl.input.appliedRewindMs || 0));
          processAbilityInputs(this, pl);
          this.processFire(pl);
        }
        pl.pendingActionInputs.length = 0;
        pl.input = { ...pl.inputCommandState };
        pl.move.yaw = pl.input.yaw;
        pl.move.pitch = pl.input.pitch;
        pl.appliedRewindMs = pl.isBot ? 0 : Math.max(0, Math.round(pl.input.appliedRewindMs || 0));
        if (this.events.slice(eventCount).some(event => (
          event.player === pl.id && (event.type === 'ability_windup' || event.type === 'ability_used' || event.type === 'ultimate_used')
        ))) this.clearSpawnProtection(pl, 'ability');
      }
    }

    // 回復灯珠
    for (const pk of this.pickups) {
      if (!pk.active) {
        if (this.t >= pk.respawnAt) pk.active = true;
        continue;
      }
      for (const pl of this.players.values()) {
        if (!pl.alive || pl.hp >= pl.maxHp) continue;
        const dx = pl.move.pos[0] - pk.pos[0], dy = pl.move.pos[1] - pk.pos[1];
        if (dx * dx + dy * dy < 1.44 && Math.abs(pl.move.pos[2] - pk.pos[2]) < 2) {
          pl.hp = Math.min(pl.maxHp, pl.hp + pk.heal);
          pk.active = false;
          pk.respawnAt = this.t + pk.respawnSec;
          this.events.push({ type: 'pickup', player: pl.id, pickup: pk.id });
          break;
        }
      }
    }

    // 目標とリスポーン（ACTIVE中のみ進む）
    let objectivePresence = [0, 0];
    let objectiveOccupants = [];
    if (state === 'ACTIVE') {
      objectiveOccupants = [];
      objectivePresence = updateEffectivePresence([...this.players.values()], this.map.objective, this.mode, objectiveOccupants);
      const evBefore = this.events.length;
      this.objective.tick(this.dt, objectivePresence, this.events);
      // 480秒同点のサドンデス突入は同tickの復帰判定より先に確定する。
      if (
        this.objective.roundWinner < 0
        && !this.objective.suddenDeath
        && !this.objective.ot.active
        && !this.objective.hasFullPot()
        && this.objective.time + 1e-9 >= this.mode.roundCapSec
      ) {
        this.objective.resolveByCap(this.events);
        if (this.objective.suddenDeath) this.events.push({ type: 'sudden_death', round: this.flow.round });
      }
      for (let i = evBefore; i < this.events.length; i++) this.logEvent({
        ...this.events[i],
        gauge: [...this.objective.gauge].map(g => Math.round(g)),
        pot: [...this.objective.pot],
        presence: objectivePresence,
        occupants: objectiveOccupants.map(p => ({ ...p })),
      });
      for (const pl of this.players.values()) {
        if (pl.insideObjective && pl.alive) pl.stats.objectiveSec += this.dt;
      }
      const spawned = this.respawn.tick(this.objective.time, this.objective.respawnPenaltySec());
      for (const pid of spawned) {
        const pl = this.players.get(pid);
        if (pl && this.spawnAtBase(pl, { safe: true, protect: true })) {
          this.events.push({ type: 'respawn', player: pid });
        }
      }
    }

    // 試合フロー
    const evBefore = this.events.length;
    this.flow.tick(this.dt, this.objective, this.events, {
      onNewRound: () => {
        this.objective.resetRound();
        this.respawn.resetRound();
        for (const pl of this.players.values()) {
          pl.ultGauge *= this.mode.ultCarryoverMult; // §4 持ち越し50%減衰（Phase 4で実効化）
          pl.setupUltGauge = pl.ultGauge;
          pl.abilities = makeAbilityState();
          this.spawnAtBase(pl);
        }
        this.zones = [];
        this.barriers = [];
        this.projectiles = [];
      },
    });
    if (state === 'SETUP' && this.flow.state === 'ACTIVE') {
      for (const pl of this.players.values()) this.resetSetupConsumption(pl);
      this.collider.dynamic = [];
      this.zones = [];
      this.barriers = [];
      this.projectiles = [];
    }
    for (let i = evBefore; i < this.events.length; i++) {
      const event = this.events[i];
      if (event.type.startsWith('obj_')) {
        this.logEvent({
          ...event,
          gauge: [...this.objective.gauge].map(g => Math.round(g)),
          pot: [...this.objective.pot],
          presence: objectivePresence,
          occupants: objectiveOccupants.map(p => ({ ...p })),
        });
      } else {
        this.logEvent(event);
      }
    }

    // 遅延補償履歴
    const hist = new Map();
    for (const pl of this.players.values()) {
      if (pl.alive) hist.set(pl.id, {
        pos: [...pl.move.pos], crouch: pl.move.crouch, generation: pl.historyGeneration,
      });
    }
    this.history.push(hist);
    const maxHist = Math.round(this.combat.lagComp.historySec / this.dt);
    if (this.history.length > maxHist) this.history.shift();
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  updatePassiveResource(pl) {
    if (!pl.resource || !pl.heroId) return;
    const hero = HERO_BY_ID[pl.heroId];
    const dx = pl.move.pos[0] - pl.lastResourcePos[0];
    const dy = pl.move.pos[1] - pl.lastResourcePos[1];
    const travelled = Math.hypot(dx, dy);
    const kind = hero.passive.kind;
    let gain = 0;
    if (kind === 'distance_resource') gain = travelled * (pl.resource.id === 'chain' ? 2 : pl.resource.id === 'wave' ? 3 : 4);
    else if (kind === 'hit_streak_mark') {
      let shownStacks = 0;
      for (const target of this.players.values()) {
        for (const status of target.abilities.statuses) {
          if (status.id !== `asagi_mark:${pl.id}` || status.sourceId !== pl.id) continue;
          if (!status.revealed && Number.isFinite(status.nextDecayAt) && this.t + 1e-9 >= status.nextDecayAt) {
            const steps = 1 + Math.floor((this.t - status.nextDecayAt + 1e-9) / 0.5);
            status.stacks = Math.max(0, status.stacks - steps);
            status.nextDecayAt += steps * 0.5;
            if (status.stacks <= 0) status.expiresAt = this.t;
          }
          shownStacks = Math.max(shownStacks, status.stacks || 0);
        }
      }
      pl.resource.value = Math.min(pl.resource.max, shownStacks);
    }
    else if (kind === 'momentum_resource') {
      const state = pl.abilities.heroState;
      if (!Number.isFinite(state.lastFastMoveT)) state.lastFastMoveT = this.t;
      const speed = travelled / Math.max(this.dt, 1e-6);
      if (speed >= 4) {
        state.lastFastMoveT = this.t;
        gain = travelled * 6;
      } else if (this.t - state.lastFastMoveT >= 0.5 - 1e-9) {
        gain = -this.dt * 15;
      }
    }
    else if (kind === 'time_resource') {
      if (pl.resource.id === 'pressure') {
        if (this.t - pl.lastResourceSpendT >= 0.8 - 1e-9) gain = this.dt * 12;
      } else {
        gain = this.dt * 3;
      }
    }
    else if (kind === 'guard_resource') gain = this.dt * 8;
    if (gain) pl.resource.value = Math.max(0, Math.min(pl.resource.max, pl.resource.value + gain));
    pl.lastResourcePos = [...pl.move.pos];
  }

  resetSetupConsumption(pl) {
    const hero = pl.heroId ? HERO_BY_ID[pl.heroId] : null;
    pl.weapon = makeWeaponState(hero?.weapon ?? this.combat.trainingWeapon);
    pl.abilities = makeAbilityState();
    pl.shield = 0;
    pl.ultGauge = pl.setupUltGauge ?? pl.ultGauge;
    const resourceDef = hero?.passive?.resource;
    pl.resource = resourceDef ? {
      id: resourceDef.id,
      name: resourceDef.name,
      value: resourceDef.initial ?? 0,
      max: resourceDef.max,
    } : null;
    pl.lastResourceSpendT = Number.NEGATIVE_INFINITY;
    pl.input = { ...pl.input, fire: false, secondary: false, ability1: false, ability2: false, ultimate: false, reload: false };
    pl.inputCommandState = { ...pl.input };
    pl.pendingActionInputs.length = 0;
  }

  snapshot() {
    const players = [];
    for (const pl of this.players.values()) {
      const hero = pl.heroId ? HERO_BY_ID[pl.heroId] : null;
      const abilitySnapshot = {};
      for (const slot of ['secondary', 'ability1', 'ability2', 'ultimate']) {
        const definition = hero?.abilities?.[slot];
        if (!definition) continue;
        const cooldownRemaining = slot === 'ultimate' ? 0 : Math.max(0, pl.abilities.cooldowns[slot] || 0);
        const castRemaining = pl.abilities.cast?.definition?.slot === slot
          ? Math.max(0, pl.abilities.cast.readyAt - this.t)
          : 0;
        const activeRemaining = Math.max(0,
          ...pl.abilities.statuses.filter(status => status.id === definition.id || status.id?.startsWith(`${definition.id}:`)).map(status => status.expiresAt - this.t),
          ...this.zones.filter(zone => zone.ownerId === pl.id && zone.abilityId === definition.id).map(zone => zone.expiresAt - this.t),
          ...this.barriers.filter(barrier => barrier.ownerId === pl.id && barrier.abilityId === definition.id).map(barrier => barrier.expiresAt - this.t),
        );
        let abilityState = 'ready';
        if (castRemaining > 0) abilityState = 'windup';
        else if (activeRemaining > 0) abilityState = 'active';
        else if (cooldownRemaining > 0) abilityState = 'cooldown';
        else if (slot === 'ultimate' && pl.ultGauge < (definition.ultCost || 100)) abilityState = 'charging';
        abilitySnapshot[slot] = {
          id: definition.id, name: definition.name, state: abilityState,
          cooldownRemaining: round1(cooldownRemaining),
          cooldownTotal: definition.cooldownSec || 0,
          castRemaining: round1(castRemaining),
          activeRemaining: round1(activeRemaining),
        };
      }
      players.push({
        id: pl.id, name: pl.name, team: pl.team, bot: pl.isBot,
        heroId: pl.heroId,
        heroName: hero?.name || '訓練織身',
        role: hero?.role || null,
        roleLabel: hero?.roleLabel || null,
        maxHp: pl.maxHp,
        pos: pl.move.pos.map(v => Math.round(v * 1000) / 1000),
        vel: pl.move.vel.map(v => Math.round(v * 100) / 100),
        yaw: Math.round(pl.move.yaw * 1000) / 1000,
        pitch: Math.round(pl.move.pitch * 1000) / 1000,
        crouch: pl.move.crouch,
        grounded: pl.move.grounded,
        moveSpeedMultiplier: movementMultiplier(pl),
        hp: Math.round(pl.hp),
        shield: Math.round(pl.shield || 0),
        alive: pl.alive,
        spawnProtected: pl.spawnProtected,
        spawnProtectionRemaining: pl.spawnProtected ? round1(Math.max(0, pl.spawnProtectionEndsAt - this.t)) : 0,
        onPoint: pl.insideObjective,
        ammo: pl.weapon.ammo,
        maxAmmo: hero?.weapon?.magSize ?? this.combat.trainingWeapon.magSize,
        weaponId: hero?.weapon?.id ?? this.combat.trainingWeapon.id,
        weaponName: hero?.weapon?.displayName ?? this.combat.trainingWeapon.displayName,
        resource: pl.resource ? { ...pl.resource, value: Math.round(pl.resource.value * 10) / 10 } : null,
        abilities: abilitySnapshot,
        cooldowns: { ...pl.abilities.cooldowns },
        cast: pl.abilities.cast ? {
          abilityId: pl.abilities.cast.definition.id,
          slot: pl.abilities.cast.definition.slot,
          remaining: Math.max(0, Math.round((pl.abilities.cast.readyAt - this.t) * 10) / 10),
        } : null,
        ultGauge: Math.round(pl.ultGauge * 10) / 10,
        reloading: this.t < pl.weapon.reloadUntil,
        reloadRemainingSec: pl.weapon.reloadStartedAt === null ? 0 : round1(Math.max(0, pl.weapon.reloadUntil - this.t)),
        reloadProgress: reloadProgress(pl.weapon, this.t),
        respawnIn: pl.alive ? 0 : Math.round(this.respawn.timeUntilSpawn(pl.id, this.objective.time, this.objective.respawnPenaltySec()) * 10) / 10,
        kills: pl.stats.kills, deaths: pl.stats.deaths, dmg: Math.round(pl.stats.dmg), healing: Math.round(pl.stats.healing),
        statuses: pl.abilities.statuses.map(status => ({
          id: status.id, kind: status.kind || null, revealed: !!status.revealed,
          hudSuppressed: !!status.hudSuppressed,
          remaining: Math.max(0, Math.round((status.expiresAt - this.t) * 10) / 10),
        })),
        ack: pl.lastAckSeq,
        retired: Math.max(pl.lastAckSeq, pl.lastRetiredInputSeq),
        rewindMs: pl.isBot ? 0 : pl.appliedRewindMs,
      });
    }
    return {
      tick: this.tickCount,
      t: Math.round(this.t * 100) / 100,
      match: this.flow.snapshot(),
      objective: this.objective.snapshot(),
      pickups: this.pickups.map(p => ({ id: p.id, active: p.active })),
      zones: this.zones.map(zone => snapshotZone(zone, this.t)),
      barriers: this.barriers.map(barrier => snapshotBarrier(barrier, this.t)),
      projectiles: this.projectiles.map(snapshotProjectile),
      players,
    };
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function pointAlong(origin, dir, distance) {
  return origin.map((value, index) => value + dir[index] * distance);
}
function normalizedVector(vector) {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length <= 1e-12) return { dir: [0, 0, 0], length: 0 };
  return { dir: vector.map(value => value / length), length };
}
function weaponDamageMeta(origin, target) {
  const damageOrigin = roundVec(origin);
  return {
    damageOrigin,
    damageDirection: roundVec(
      damageOrigin.map((value, index) => value - target.move.pos[index]),
      1000,
    ),
  };
}
function finiteVector3(vector) {
  if (!Array.isArray(vector) || vector.length < 3 || !vector.slice(0, 3).every(Number.isFinite)) return undefined;
  return vector.slice(0, 3);
}
function round1(value) { return Math.round(value * 10) / 10; }
function roundVec(vector, scale = 100) { return vector.map(value => Math.round(value * scale) / scale); }
function reloadProgress(weapon, now) {
  if (weapon.reloadStartedAt === null || weapon.reloadUntil <= weapon.reloadStartedAt) return 0;
  return Math.max(0, Math.min(1, (now - weapon.reloadStartedAt) / (weapon.reloadUntil - weapon.reloadStartedAt)));
}
