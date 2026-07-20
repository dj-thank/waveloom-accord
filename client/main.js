// 『篝合』潮占 Production Candidate — ブラウザクライアント本体
// - 接続/参加フロー
// - クライアント予測（shared/sim/movement.js と同一コード・固定dt=1/63）とリコンサイル
// - 他プレイヤーの補間表示（interpMs過去の2スナップ間の線形補間）
// - イベント演出（shot/hit/kill 等）と HUD 更新

import { buildMap } from '/shared/data/map_oshioi.js';
import { Collider } from '/shared/sim/collision.js';
import { makeMoveState, step, eyeHeight } from '/shared/sim/movement.js';
import { Net } from '/client/net.js';
import { InputManager } from '/client/input.js';
import { SceneRenderer } from '/client/render.js';
import { Hud } from '/client/hud.js';
import { FrameDriver } from '/client/frame_driver.js';
import { installPerformanceDiagnostics } from '/client/diagnostics.js';
import {
  buildAbilityHudModel,
  interpolateRemotePlayer,
  isHeroRoleSelectable,
  resolveDamageIndicatorAngle,
  resolveDirectionalDamageAngle,
  resolveHeroSelectionContext,
  resolveRespawnPenalty,
  resolveAbilityAttemptFeedback,
} from '/client/presentation.js';
import {
  resolvePredictionMovementConfig, resolveSnapshotGrounded, retirePendingInputs,
} from '/client/prediction.js';
import { buildCombatGuidance } from '/client/combat_guidance.js';
import { CombatAudio } from '/client/combat_audio.js';
import { HEROES, HERO_BY_ID, DEFAULT_HERO_ID, ROLE_NAMES } from '/shared/data/heroes.js';
import { getActionAsset, getHeroAsset, getWeaponAsset } from '/shared/data/hero_assets.js';
import { createVerifiedObjectUrl } from '/client/runtime_asset_integrity.js';
import { ROLE_SLOTS } from '/shared/rules/team_composition.js';

const FIXED_DT = 1 / 63;               // PROTOCOL.md: サーバーと同一の固定ステップ
const NAME_KEY = 'kagariai_name';
const HERO_KEY = 'kagariai_hero';
const ROLE_ORDER = ['frontline', 'damage', 'support'];
const SLOT_LABELS = Object.freeze({
  secondary: '右クリック / LT', ability1: 'Shift / LB', ability2: 'E / RB', ultimate: 'Q / Y',
});
const RENDER_CUE_TYPES = new Set([
  'ability_windup', 'ability_used', 'ultimate_used', 'weapon_charge',
  'projectile_spawned', 'projectile_impact', 'projectile_ricochet',
  'projectile_scattered',
  'barrier_created', 'barrier_hit', 'barrier_destroyed', 'zone_created',
  'deployable_created', 'deployable_consumed', 'deployable_hit', 'deployable_destroyed',
  'blade_embedded', 'blade_returned', 'ability_transit_started', 'ability_transit_ended',
  'ability_interrupted', 'stored_heal_added',
  'hit', 'kill', 'heal',
]);

const ACTION_NAME_BY_ID = new Map();
for (const hero of HEROES) {
  ACTION_NAME_BY_ID.set(hero.weapon.id, hero.weapon.displayName);
  for (const ability of Object.values(hero.abilities)) ACTION_NAME_BY_ID.set(ability.id, ability.name);
}

const WEAPON_TYPE_TEXT = Object.freeze({
  hybrid_melee_projectile: '近接と投射を切り替える武器', melee: '近接武器', charge: '溜め射撃武器',
  hitscan: '即着弾射撃', burst: 'バースト射撃', explosive: '範囲爆発弾',
  ricochet_projectile: '跳弾する投射武器', shotgun: '散弾武器', guided_projectile: '誘導弾',
  healing_projectile: '味方を回復できる投射武器', deploy: '設置型射撃', beam: '持続照射武器',
  explosive_heal: '爆発と回復を兼ねる投射武器',
});

const PASSIVE_TEXT = Object.freeze({
  distance_resource: '移動距離に応じて固有資源を蓄える', damage_taken_resource: '受けた攻撃を固有資源へ変える',
  time_resource: '時間経過で固有資源を回復する', hud_immunity: '視界やHUDへの妨害に耐性を持つ',
  portable_cover: '携行物を遮蔽物として活用する', hit_streak_mark: '連続命中で標的への効果を高める',
  charge_fog: '溜め射撃と霧の状態を連動させる', momentum_resource: '高速移動で勢いを蓄える',
  shot_resource: '射撃に応じて武器の状態が変化する', enemy_gaze_resource: '敵の注目を固有資源へ変える',
  stored_heal: '味方へ後から解放できる回復を蓄える', ally_ability_resource: '味方の能力使用から固有資源を得る',
  guard_resource: '防御に使う固有資源を時間で回復する', linked_ally_resource: '味方との連携で固有資源を高める',
  damage_redirect_resource: '肩代わりした痛みを回復へ転換する',
});

const BEHAVIOR_TEXT = Object.freeze({
  anchor_recall: '錨を0.9秒で手元へ戻し、経路上の敵を引き寄せる', anchor_launch: '錨を投げ、着地点を制圧する',
  rewind_marker: '記録地点へ20m/sで巻き戻って危機を脱する', ring_barrier: '円環状の障壁で範囲を封鎖する',
  guard: '構えて被ダメージを軽減する', barrier: '耐久値を持つ障壁を設置する',
  cone_blast: '前方扇状の敵へ効果を与える', fortress_buff: '周囲の味方を要塞化して攻防を強化する',
  projectile_field: '投射物へ作用する領域を作る', dash: '入力方向へ素早く移動する',
  field_detonate: '0.4秒の予兆後、膜内の敵弾を散乱させて領域を起爆する', hud_suppress_zone: '敵の情報表示を妨げる領域を展開する',
  target_debuff: '単体の敵へ弱体効果を付与する', line_pull: '直線上の対象を引き寄せる',
  barrier_corridor: '味方が進める障壁の通路を作る', team_wave: '波を起こして味方を守り敵を押し返す',
  precision_shot: '精密射撃へ切り替える', precision_stance: '精密射撃の姿勢を取る',
  mark_shot: '命中した敵へ標定を付与する', team_reveal: '敵を可視化し味方の攻撃を支援する',
  cleanse_mobility: '妨害を解除しながら移動性能を高める', reveal_trap: '敵を発見する罠を設置する',
  backstep: '後方へ素早く離脱する', self_buff: '一定時間、自身を強化する',
  charged_shot: '溜めて強力な一撃を放つ', air_dash: '空中でも使える高速移動',
  blade_recall: '飛ばした刃を呼び戻し、復路でも攻撃する', ignite_target: '対象を着火して追加ダメージを与える',
  status_blast: '範囲へ状態異常を付与する', damage_aura: '周囲へ継続ダメージを与える',
  airburst: '飛翔中の弾を任意位置で炸裂させる', damage_zone: '継続ダメージ領域を設置する',
  barrage_zone: '指定範囲へ連続砲撃を行う', target_reveal: '対象を味方に可視化する',
  seeking_blast: '敵を追う攻撃を放つ', homing_barrage: '複数の誘導弾で敵を追い詰める',
  ammo_restore: '長押し中、針を毎秒4本補充する', ally_grapple: '味方へ素早く接近または移動させる',
  release_stored_heal: '蓄積した回復を味方へ解放する', stored_heal_burst: '周囲の蓄積回復を強化して解放する',
  zone_dash: '領域を残しながら高速移動する', cooldown_zone: '味方のクールダウン回復を早める領域を作る',
  cast_delay_zone: '敵の能力発動を遅らせる領域を作る', team_cooldown_buff: '味方全体の能力回転を加速する',
  projectile_guard: '敵の投射物を受け流す', team_guard: '周囲の味方が受けるダメージを軽減する',
  link_ally: '味方と連携リンクを結ぶ', ally_damage_buff: 'リンクした味方の攻撃を強化する',
  team_damage_buff: '味方全体の攻撃を強化する', healing_trail: '移動経路に回復と攻撃の軌跡を残す',
  leap_heal: '跳躍し、着地時に周囲を回復する', redirect_link: '味方が受けるダメージの一部を肩代わりする',
  resource_heal: '蓄えた固有資源を範囲回復へ変える', team_redirect: '味方全体のダメージを肩代わりし、最後に反撃する',
});

// ---- 基盤 ----
const map = buildMap();
const collider = new Collider(map.solids);
const canvas = document.getElementById('gl');
const heroAssetCatalog = Object.freeze({ getActionAsset, getHeroAsset, getWeaponAsset });
const renderer = new SceneRenderer(canvas, map, heroAssetCatalog);
const hud = new Hud();
const net = new Net();
const audio = new CombatAudio(window, heroAssetCatalog);

// ---- 状態 ----
let joined = false;
let protocolMismatchMessage = '';
let myId = null;
let myTeam = 0;
let mode = null;        // welcome.mode
let combat = null;      // welcome.combat
let MV = null;          // combat.movement

let pred = null;        // 予測移動状態（shared/sim/movement.js の state）
let pending = [];       // 未ACK入力（seq付き）
let seq = 0;
let errOff = [0, 0, 0]; // リコンサイル誤差の視覚吸収オフセット

let snapBuf = [];       // [{at(ms), snap}] 補間用リングバッファ
let latest = null;
let latestAt = 0;

let otPenaltyStartT = -1;   // 延長/サドンデス開始のラウンド時刻（イベントから）
let roundEndSub = '';
let transientUntil = 0;
let lastMatchState = '';
let lastFlashT = 0;
let selectedHeroId = HERO_BY_ID[localStorage.getItem(HERO_KEY)] ? localStorage.getItem(HERO_KEY) : DEFAULT_HERO_ID;
let heroPickerContext = 'join';
let lastLocalAlive = null;
let abilityAttemptFeedback = null;
const abilityInputDown = Object.fromEntries(Object.keys(SLOT_LABELS).map(slot => [slot, false]));

// ---- 入力 ----
const input = new InputManager(canvas, {
  onScoreboard: (show) => {
    hud.showScoreboard(show);
    if (show) hud.renderScoreboard(latest, myId, myTeam);
  },
  onLockChange: () => {
    if (joined) hud.showLockHint(!input.captured);
  },
  onCaptureChange: (captured) => {
    if (joined) hud.showLockHint(!captured);
  },
});
input.setUiBlocked(true);

// 操作・音響設定
const sensSlider = document.getElementById('sensSlider');
const sensNumber = document.getElementById('sensNumber');
const gamepadSensNumber = document.getElementById('gamepadSensNumber');
const audioToggle = document.getElementById('audioToggle');
const masterVolume = document.getElementById('masterVolume');
const volumeValue = document.getElementById('volumeValue');
sensSlider.value = String(input.sensValue);
sensNumber.value = String(input.sensValue);
gamepadSensNumber.value = String(input.gamepadLookSensitivity);
const syncSensitivity = value => {
  input.setSensValue(value);
  sensSlider.value = String(input.sensValue);
  sensNumber.value = String(input.sensValue);
};
sensSlider.addEventListener('input', () => syncSensitivity(Number(sensSlider.value)));
sensNumber.addEventListener('input', () => {
  if (sensNumber.value !== '') syncSensitivity(Number(sensNumber.value));
});
sensNumber.addEventListener('change', () => syncSensitivity(Number(sensNumber.value)));
const syncGamepadSensitivity = value => {
  input.setGamepadLookSensitivity(value);
  gamepadSensNumber.value = String(input.gamepadLookSensitivity);
};
gamepadSensNumber.addEventListener('input', () => {
  if (gamepadSensNumber.value !== '') syncGamepadSensitivity(Number(gamepadSensNumber.value));
});
gamepadSensNumber.addEventListener('change', () => syncGamepadSensitivity(Number(gamepadSensNumber.value)));
const syncAudioControls = () => {
  audioToggle.textContent = audio.enabled ? '音響 ON' : '音響 OFF';
  audioToggle.setAttribute('aria-pressed', String(audio.enabled));
  masterVolume.value = String(Math.round(audio.volume * 100));
  volumeValue.textContent = `${Math.round(audio.volume * 100)}%`;
};
syncAudioControls();
audioToggle.addEventListener('click', () => {
  audio.setEnabled(!audio.enabled);
  syncAudioControls();
});
masterVolume.addEventListener('input', () => {
  audio.setVolume(Number(masterVolume.value) / 100);
  syncAudioControls();
});
canvas.addEventListener('pointerdown', () => audio.ensureStarted().catch(() => {}), { passive: true });

// ---- 参加フロー ----
const joinOverlay = document.getElementById('joinOverlay');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const joinCancelBtn = document.getElementById('joinCancelBtn');
const joinStatus = document.getElementById('joinStatus');
const heroRoster = document.getElementById('heroRoster');
const heroDetail = document.getElementById('heroDetail');
const heroChangeBtn = document.getElementById('heroChangeBtn');
const respawnHeroBtn = document.getElementById('respawnHeroBtn');
const joinTitle = document.getElementById('joinTitle');
const roleRule = document.getElementById('roleRule');
const mapStatus = document.getElementById('mapStatus');
nameInput.value = localStorage.getItem(NAME_KEY) || '見習いの篝手';
roleRule.textContent = `固定編成：${compositionLabel()}`;
const updateMapStatus = (status, detail = {}) => {
  if (status === 'loaded' && detail.displayMode === 'verified-reference-hidden') {
    mapStatus.textContent = `${detail.title || '提供3Dマップ'} 検証済み（参照専用・表示OFF）`;
  }
  else if (status === 'loaded') mapStatus.textContent = `${detail.title || '提供3Dマップ'} 読込済み（${Number(detail.meshCount) || 422}メッシュ）`;
  else if (status === 'fallback') mapStatus.textContent = '提供3Dマップを読めないため、安全な簡易表示で継続中';
  else mapStatus.textContent = '提供3Dマップを読み込み中…';
};
window.addEventListener('authored-map-loaded', event => updateMapStatus('loaded', event.detail));
window.addEventListener('authored-map-fallback', event => updateMapStatus('fallback', event.detail));
updateMapStatus(document.documentElement.dataset.authoredMap || 'loading');
const conceptObjectUrls = new Map();
renderHeroRoster();
selectHeroForPicker(selectedHeroId);

function makeElement(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

async function applyConceptAtlas(element, heroId) {
  const visual = getHeroAsset(heroId)?.concept?.visual;
  if (!element || !visual?.runtimeUrl) return false;
  element.dataset.assetSha256 = visual.sha256;
  element.dataset.assetIntegrity = 'verifying';
  const key = `${visual.runtimeUrl}|${visual.sha256}`;
  try {
    if (!conceptObjectUrls.has(key)) {
      conceptObjectUrls.set(key, createVerifiedObjectUrl(visual, {
        host: window,
        expectedContentType: 'image/webp',
        maxBytes: 8 * 1024 * 1024,
      }).catch(error => {
        conceptObjectUrls.delete(key);
        throw error;
      }));
    }
    const verified = await conceptObjectUrls.get(key);
    element.style.backgroundImage = `url("${verified.objectUrl}")`;
    element.dataset.assetIntegrity = 'verified';
    return true;
  } catch (error) {
    element.style.backgroundImage = '';
    element.dataset.assetIntegrity = 'failed';
    element.dataset.assetIntegrityError = String(error?.message || 'verification failed').slice(0, 160);
    return false;
  }
}

function compositionLabel(slots = mode?.roleSlots || ROLE_SLOTS) {
  return ROLE_ORDER.map(role => `${ROLE_NAMES[role] || role} ${slots[role] || 0}`).join(' ／ ');
}

function renderHeroRoster() {
  const fragment = document.createDocumentFragment();
  const teamPlayers = latest?.players?.filter(player => player.team === myTeam) || [];
  const humanRoleCounts = Object.fromEntries(ROLE_ORDER.map(role => [
    role, teamPlayers.filter(player => !player.bot && player.role === role).length,
  ]));
  const currentRole = teamPlayers.find(player => player.id === myId)?.role || null;
  const roleSlots = mode?.roleSlots || ROLE_SLOTS;
  for (const role of ROLE_ORDER) {
    const heroes = HEROES.filter(hero => hero.role === role);
    const section = makeElement('section', 'roleGroup');
    section.setAttribute('aria-labelledby', `role-${role}`);
    section.style.setProperty('--role-color', heroes[0]?.color || '#35d5e8');
    const slotText = heroPickerContext === 'setup' ? ` ／ 枠 ${humanRoleCounts[role] || 0}/${roleSlots[role] || 0}` : '';
    const heading = makeElement('h2', 'roleHeading', `${heroes[0]?.roleLabel || role}（${heroes.length}人${slotText}）`);
    heading.id = `role-${role}`;
    const grid = makeElement('div', 'roleHeroGrid');
    for (const hero of heroes) {
      const option = makeElement('button', 'heroOption');
      option.type = 'button';
      option.dataset.heroId = hero.id;
      option.setAttribute('aria-pressed', 'false');
      const roleSelectable = isHeroRoleSelectable(
        heroPickerContext,
        role,
        currentRole,
        humanRoleCounts[role] || 0,
        roleSlots[role] || 0,
      );
      option.disabled = !roleSelectable;
      if (!roleSelectable) {
        option.title = heroPickerContext === 'respawn'
          ? '戦闘中の復帰変更は同じロール内に限られます'
          : 'このロールの人間枠は埋まっています';
      }
      option.style.setProperty('--hero-color', hero.color);
      const art = makeElement('span', 'heroOptionArt');
      art.setAttribute('aria-hidden', 'true');
      applyConceptAtlas(art, hero.id);
      option.append(
        art,
        makeElement('span', 'heroOptionName', hero.name),
        makeElement('span', 'heroOptionType', `${hero.subtype} ／ HP ${hero.maxHp}`),
        makeElement('span', 'heroOptionMeta', `武器: ${hero.weapon.displayName}`),
        makeElement('span', 'heroOptionMeta', `パッシブ: ${hero.passive.name}`),
      );
      const actions = makeElement('span', 'heroActionList');
      for (const slot of Object.keys(SLOT_LABELS)) {
        actions.appendChild(makeElement('span', '', `${SLOT_LABELS[slot]} ${hero.abilities[slot].name}`));
      }
      option.appendChild(actions);
      option.addEventListener('click', () => selectHeroForPicker(hero.id));
      grid.appendChild(option);
    }
    section.append(heading, grid);
    fragment.appendChild(section);
  }
  heroRoster.replaceChildren(fragment);
}

function selectHeroForPicker(heroId) {
  const hero = HERO_BY_ID[heroId] || HERO_BY_ID[DEFAULT_HERO_ID];
  selectedHeroId = hero.id;
  localStorage.setItem(HERO_KEY, selectedHeroId);
  for (const option of heroRoster.querySelectorAll('.heroOption')) {
    option.setAttribute('aria-pressed', String(option.dataset.heroId === selectedHeroId));
  }
  audio.preloadHero(hero.id).catch(() => {});
  document.documentElement.dataset.abilityAssetIntegrity = `verifying:${hero.id}`;
  renderer.preloadHeroAssets(hero.id).then(results => {
    if (selectedHeroId !== hero.id) return;
    const verified = results.filter(result => result.status === 'fulfilled' && result.value).length;
    document.documentElement.dataset.abilityAssetIntegrity = verified === 4
      ? `verified:${hero.id}:4/4`
      : `failed:${hero.id}:${verified}/4`;
  }).catch(() => {
    if (selectedHeroId === hero.id) {
      document.documentElement.dataset.abilityAssetIntegrity = `failed:${hero.id}:0/4`;
    }
  });
  renderHeroDetail(hero);
}

function renderHeroDetail(hero) {
  const wrapper = makeElement('div');
  wrapper.style.setProperty('--hero-color', hero.color);
  const art = makeElement('div', 'detailHeroArt');
  art.setAttribute('aria-hidden', 'true');
  applyConceptAtlas(art, hero.id);
  wrapper.append(
    art,
    makeElement('div', 'detailName', hero.name),
    makeElement('div', 'detailRole', `${hero.roleLabel} ／ ${hero.subtype}`),
    makeElement('p', 'detailSummary', `${hero.subtype}の${hero.roleLabel}。最大体力 ${hero.maxHp}、移動倍率 ${hero.moveSpeedMult.toFixed(2)}。`),
  );
  const details = makeElement('dl');
  details.append(
    detailItem(`武器 — ${hero.weapon.displayName}`, describeWeapon(hero.weapon)),
    detailItem(`パッシブ — ${hero.passive.name}`, describePassive(hero.passive)),
  );
  wrapper.appendChild(details);
  const actions = makeElement('div', 'detailActions');
  for (const [slot, key] of Object.entries(SLOT_LABELS)) {
    const ability = hero.abilities[slot];
    const action = makeElement('div', 'detailAction');
    action.append(
      makeElement('strong', '', `${key} — ${ability.name}`),
      makeElement('span', '', describeAction(ability)),
    );
    actions.appendChild(action);
  }
  wrapper.appendChild(actions);
  heroDetail.replaceChildren(wrapper);
}

function detailItem(term, description) {
  const wrapper = makeElement('div', 'detailItem');
  wrapper.append(makeElement('dt', '', term), makeElement('dd', '', description));
  return wrapper;
}

function describeWeapon(weapon) {
  const parts = [WEAPON_TYPE_TEXT[weapon.type] || '固有武器'];
  if (weapon.damage) parts.push(`基礎ダメージ ${weapon.damage}`);
  if (weapon.maxDamage && weapon.maxDamage !== weapon.damage) parts.push(`最大 ${weapon.maxDamage}`);
  if (weapon.allyHeal || weapon.allyHealStored) parts.push(`味方回復 ${weapon.allyHeal || weapon.allyHealStored}`);
  if (weapon.rps) parts.push(`毎秒 ${weapon.rps}回`);
  parts.push(weapon.reloadSec > 0 ? `装弾 ${weapon.magSize}、リロード ${weapon.reloadSec}秒` : '弾薬消費なし');
  return parts.join('。') + '。';
}

function describeWeaponTrait(weapon) {
  const type = {
    hybrid_melee_projectile: '近接・投射', melee: '近接', charge: '精密溜め',
    hitscan: '即着弾', burst: 'バースト', explosive: '範囲爆発',
    ricochet_projectile: '跳弾', shotgun: '散弾', guided_projectile: '誘導弾',
    healing_projectile: '回復弾', deploy: '設置型', beam: '持続照射',
    explosive_heal: '爆発・回復',
  }[weapon.type] || '固有武器';
  const falloffStart = Number(weapon.falloffStartM ?? weapon.maxRangeM ?? 20);
  const range = falloffStart <= 10 ? '近距離' : falloffStart <= 30 ? '中距離' : '遠距離';
  const cadence = Number(weapon.rps) > 0 ? ` ／ ${Number(weapon.rps).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}発/秒` : '';
  return `${type}・${range}${cadence}`;
}

function describePassive(passive) {
  const parts = [PASSIVE_TEXT[passive.kind] || '固有の戦闘特性を持つ'];
  if (passive.resource) parts.push(`${passive.resource.name}を最大 ${passive.resource.max}まで管理する`);
  return parts.join('。') + '。';
}

function describeAction(action) {
  const parts = [];
  if (action.description && action.description !== action.name) parts.push(action.description);
  parts.push(BEHAVIOR_TEXT[action.behavior] || '固有効果を発動する');
  if (action.damage) parts.push(`ダメージ ${action.damage}`);
  if (action.heal) parts.push(`回復 ${action.heal}`);
  if (action.healPerSec) parts.push(`毎秒回復 ${action.healPerSec}`);
  if (action.damagePerSec) parts.push(`毎秒ダメージ ${action.damagePerSec}`);
  if (action.rangeM) parts.push(`射程 ${action.rangeM}m`);
  if (action.radiusM) parts.push(`半径 ${action.radiusM}m`);
  if (action.durationSec) parts.push(`持続 ${action.durationSec}秒`);
  if (action.castSec) parts.push(`発動 ${action.castSec}秒`);
  if (action.cooldownSec) parts.push(`CD ${action.cooldownSec}秒`);
  if (action.resourceCost) parts.push(`資源消費 ${action.resourceCost}`);
  return parts.join('。') + '。';
}

function currentHeroSelectionContext(snap = latest) {
  const player = snap?.players?.find(candidate => candidate.id === myId);
  return resolveHeroSelectionContext(joined, snap?.match?.state, player?.alive);
}

function isChangingHero() {
  return heroPickerContext === 'setup' || heroPickerContext === 'respawn';
}

function openHeroPicker(context) {
  if (context !== 'setup' && context !== 'respawn') return;
  heroPickerContext = context;
  input.setUiBlocked(true);
  nameInput.disabled = true;
  joinCancelBtn.hidden = false;
  joinBtn.disabled = false;
  joinTitle.textContent = context === 'respawn' ? '復帰キャラクター選択' : 'キャラクター変更';
  joinBtn.textContent = context === 'respawn' ? '次の復帰に確定' : '変更を確定';
  joinStatus.textContent = context === 'respawn'
    ? '復帰待機中です。同じロール内から選択してください。'
    : '準備中です。固定編成の空き枠内で変更できます。';
  joinOverlay.style.display = 'flex';
  renderHeroRoster();
  const currentHeroId = latest?.players.find(player => player.id === myId)?.heroId;
  if (currentHeroId && HERO_BY_ID[currentHeroId]) selectHeroForPicker(currentHeroId);
  heroRoster.querySelector(`[data-hero-id="${selectedHeroId}"]`)?.focus({ preventScroll: true });
}

function closeHeroPicker() {
  if (!joined) return;
  heroPickerContext = null;
  const player = latest?.players?.find(candidate => candidate.id === myId);
  input.setUiBlocked(player?.alive === false);
  joinOverlay.style.display = 'none';
  nameInput.disabled = false;
  joinStatus.textContent = '';
}

function doJoin() {
  if (isChangingHero()) {
    if (currentHeroSelectionContext() !== heroPickerContext) {
      joinStatus.textContent = '現在は変更できません。復帰後または次の準備時間に選択してください。';
      return;
    }
    joinBtn.disabled = true;
    joinStatus.textContent = heroPickerContext === 'respawn'
      ? '次の復帰キャラクターをサーバーへ確認中…'
      : '変更をサーバーへ確認中…';
    net.sendSelect(selectedHeroId);
    return;
  }
  const name = (nameInput.value.trim() || '見習いの篝手').slice(0, 16);
  localStorage.setItem(NAME_KEY, name);
  joinBtn.disabled = true;
  joinStatus.textContent = '接続中…';
  net.connect(name, selectedHeroId);
}
joinBtn.addEventListener('click', doJoin);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
joinCancelBtn.addEventListener('click', closeHeroPicker);
const openAvailableHeroPicker = () => {
  const context = currentHeroSelectionContext();
  if (context) openHeroPicker(context);
};
heroChangeBtn.addEventListener('click', openAvailableHeroPicker);
respawnHeroBtn.addEventListener('click', openAvailableHeroPicker);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isChangingHero()) closeHeroPicker();
});

document.getElementById('restartBtn').addEventListener('click', () => net.sendRestart());

net.onWelcome = (msg) => {
  const rejoin = joined; // 再試合時は welcome が再送される（idが変わる）
  myId = msg.id;
  myTeam = msg.team;
  mode = msg.mode;
  roleRule.textContent = `固定編成：${compositionLabel(mode?.roleSlots)}`;
  combat = msg.combat;
  MV = combat.movement;
  if (msg.heroId && HERO_BY_ID[msg.heroId]) selectHeroForPicker(msg.heroId);
  joined = true;
  // 新試合: 予測・補間バッファを破棄
  pred = null;
  pending = [];
  errOff = [0, 0, 0];
  snapBuf = [];
  latest = null;
  otPenaltyStartT = -1;
  roundEndSub = '';
  transientUntil = 0;
  lastLocalAlive = null;
  abilityAttemptFeedback = null;
  for (const slot of Object.keys(abilityInputDown)) abilityInputDown[slot] = false;
  if (!rejoin) {
    closeHeroPicker();
    input.setEnabled(true);
    hud.showLockHint(true);
  }
};

net.onProtocolMismatch = ({ expected, received }) => {
  const receivedLabel = Number.isSafeInteger(received) ? `v${received}` : '不明';
  protocolMismatchMessage = `サーバーとの通信規約が一致しません（client v${expected} / server ${receivedLabel}）。ページを更新してください。`;
  joinStatus.textContent = protocolMismatchMessage;
  joinBtn.disabled = true;
};

net.onError = () => {
  joinStatus.textContent = '接続に失敗しました。サーバーが起動しているか確認してください。';
  joinBtn.disabled = false;
};
net.onServerError = (msg) => {
  const message = serverErrorMessage(msg);
  joinStatus.textContent = message;
  joinBtn.disabled = false;
  if (joined) hud.toast(message);
};
net.onSelectResult = (msg) => {
  joinBtn.disabled = false;
  if (!msg.ok) {
    const message = selectionErrorMessage(msg.code);
    joinStatus.textContent = message;
    if (joined) hud.toast(message);
    return;
  }
  if (msg.heroId && HERO_BY_ID[msg.heroId]) selectHeroForPicker(msg.heroId);
  const heroName = HERO_BY_ID[msg.heroId || selectedHeroId]?.name || selectedHeroId;
  closeHeroPicker();
  hud.toast(`${heroName}へ変更しました`);
};
net.onClose = () => {
  const hadJoined = joined;
  joined = false;
  input.setEnabled(false);
  input.setUiBlocked(true);
  heroPickerContext = 'join';
  lastLocalAlive = null;
  joinOverlay.style.display = 'flex';
  joinTitle.textContent = '篝合';
  nameInput.disabled = false;
  joinCancelBtn.hidden = true;
  joinBtn.textContent = 'このキャラクターで接続';
  joinStatus.textContent = protocolMismatchMessage
    || (hadJoined ? '切断されました。再接続してください。' : '接続できませんでした。再試行してください。');
  joinBtn.disabled = Boolean(protocolMismatchMessage);
};

function selectionErrorMessage(code) {
  return ({
    not_joined: '参加が完了していないため変更できません。',
    invalid_hero: 'そのキャラクターは選択できません。',
    role_full: `そのロールの枠は埋まっています。固定編成（${compositionLabel()}）の別枠を選んでください。`,
    role_change_locked: '戦闘中はロールを跨ぐ変更ができません。次の準備時間に変更してください。',
    selection_locked: '現在はキャラクターを変更できません。復帰後または次の準備時間に選択してください。',
  })[code] || 'キャラクター変更が拒否されました。';
}

function serverErrorMessage(msg) {
  const localized = ({
    already_joined: 'すでに参加済みです。', server_full: 'サーバーが満員です。',
    role_full: '選択したロールは両チームで満員です。別のロールを選んでください。',
    invalid_message: 'サーバーへ送信した内容が不正です。', invalid_input: '入力が受理されませんでした。',
    stale_input: '古い入力が破棄されました。',
  })[msg?.code];
  return localized || msg?.message || 'サーバーが要求を拒否しました。';
}

// ---- スナップショット受信 ----
net.onSnap = (snap, events) => {
  const now = performance.now();
  snapBuf.push({ at: now, snap });
  if (snapBuf.length > 64) snapBuf.shift();
  latest = snap;
  latestAt = now;

  if ((snap.objective.ot || snap.objective.suddenDeath) && snap.objective.otPenaltyStartT >= 0) {
    otPenaltyStartT = snap.objective.otPenaltyStartT;
  }

  // 準備扉: SETUP中のみ衝突有効（サーバーと同じ扱い）
  collider.dynamic = snap.match.state === 'SETUP' ? map.setupDoors : [];

  const me = snap.players.find(p => p.id === myId);
  if (me) {
    if (!me.alive && lastLocalAlive !== false) input.setUiBlocked(true);
    if (me.alive && lastLocalAlive === false && !isChangingHero()) input.setUiBlocked(false);
    lastLocalAlive = me.alive;
    reconcile(me, snap.match.state);
    if (me.heroId && HERO_BY_ID[me.heroId] && !isChangingHero() && me.heroId !== selectedHeroId) {
      selectHeroForPicker(me.heroId);
    }
  } else {
    lastLocalAlive = null;
  }

  const selectionContext = currentHeroSelectionContext(snap);
  heroChangeBtn.hidden = !selectionContext;
  heroChangeBtn.textContent = selectionContext === 'respawn' ? '復帰キャラクター変更' : 'キャラクター変更';
  respawnHeroBtn.hidden = selectionContext !== 'respawn';
  if (isChangingHero() && selectionContext !== heroPickerContext) {
    const previousContext = heroPickerContext;
    closeHeroPicker();
    hud.toast(previousContext === 'respawn' ? '復帰待機が終了しました' : '準備時間が終了しました');
  }

  handleEvents(events, snap);

  // 状態遷移
  if (snap.match.state !== lastMatchState) {
    if (snap.match.state === 'MATCH_END') input.releaseLock();
    lastMatchState = snap.match.state;
  }

  if (hud.scoreboardShown) hud.renderScoreboard(snap, myId, myTeam);
};

function inferGrounded(pos, vel) {
  // groundedを持たない旧snapshotだけ、この地形推定へfallbackする。
  if (Math.abs(vel[2]) > 0.01) return false;
  const g = collider.groundHeight(pos[0], pos[1], pos[2] + 0.01, MV.capsuleRadiusM, MV.stepUpM);
  return g > -Infinity && Math.abs(g - pos[2]) <= 0.08;
}

// PROTOCOL.md: 権威状態を起点に seq > ack の入力を再適用。小誤差は指数補間で吸収
function reconcile(me, matchState) {
  const base = makeMoveState(me.pos, me.yaw);
  base.vel = [me.vel[0], me.vel[1], me.vel[2]];
  base.pitch = me.pitch;
  base.crouch = me.crouch;
  base.grounded = resolveSnapshotGrounded(me, inferGrounded);

  pending = retirePendingInputs(pending, me);
  const frozen = matchState === 'ROUND_END' || matchState === 'MATCH_END';
  const predictionMovement = resolvePredictionMovementConfig(MV, me);
  if (me.alive && !frozen) {
    for (const inp of pending) step(base, inp, FIXED_DT, collider, predictionMovement);
  } else {
    pending = [];
  }

  if (!pred) {
    pred = base;
    errOff = [0, 0, 0];
    input.setView(me.yaw, me.pitch); // 初回はサーバーの向きに合わせる
    return;
  }
  if (!me.alive || frozen) {
    pred = base;
    errOff = [0, 0, 0];
    return;
  }
  // 視覚位置の連続性を保つオフセット（大きすぎる誤差は即スナップ）
  const dx = pred.pos[0] + errOff[0] - base.pos[0];
  const dy = pred.pos[1] + errOff[1] - base.pos[1];
  const dz = pred.pos[2] + errOff[2] - base.pos[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  errOff = d2 > 4 || d2 < 1e-8 ? [0, 0, 0] : [dx, dy, dz];
  pred = base;
}

// ---- イベント処理 ----
function handleEvents(events, snap) {
  const nameOf = (id) => snap.players.find(p => p.id === id)?.name ?? '?';
  const teamOf = (id) => snap.players.find(p => p.id === id)?.team ?? -1;
  const relTeam = (t) => (t === myTeam ? '自軍' : '敵軍');
  for (const e of events) {
    audio.handleEvent(e, { myId, rttMs: net.rtt, interpMs: net.interpMs() });
    if (RENDER_CUE_TYPES.has(e.type)) renderer.spawnAbilityCue(e, myTeam);
    switch (e.type) {
      case 'shot':
        if (e.source !== myId && !e.projectile) renderer.spawnTracer(e.origin, e.dir, e.dist);
        break;
      case 'hit':
        if (e.source === myId) hud.hitmarker(e.headshot);
        if (e.target === myId) {
          const source = snap.players.find(player => player.id === e.source);
          const target = snap.players.find(player => player.id === myId);
          const direction = resolveDamageIndicatorAngle(e, target?.pos, input.yaw, source?.pos);
          hud.damagePulse(direction);
        }
        break;
      case 'kill':
        hud.killfeed(
          nameOf(e.source), teamOf(e.source) === myTeam,
          nameOf(e.target), teamOf(e.target) === myTeam,
          e.headshot, e.abilityId ? (ACTION_NAME_BY_ID.get(e.abilityId) || e.abilityId) : '',
        );
        break;
      case 'hero_selected':
        if (e.player === myId && HERO_BY_ID[e.heroId]) hud.toast(`${HERO_BY_ID[e.heroId].name}を選択`);
        break;
      case 'pickup':
        if (e.player === myId) hud.toast('回復灯珠 +75');
        break;
      case 'ability_interrupted':
        if (e.player === myId) hud.toast(`発動中断 — ${Math.round((e.refundPct || 0) * 100)}%返還`);
        break;
      case 'deployable_destroyed':
        if (e.source === myId) hud.toast('敵の設置物を破壊');
        break;
      case 'obj_captured':
        hud.toast(`${relTeam(e.owner)}が潮井を確保`);
        break;
      case 'obj_retake':
        hud.toast(`${relTeam(e.owner)}が潮井を奪還！`);
        break;
      case 'obj_overtime_start':
        otPenaltyStartT = e.t ?? snap.objective.time;
        showTransient('延長戦', '占有陣の勝利目前 — 猶予が尽きる前に奪還せよ', 3000);
        break;
      case 'sudden_death':
        if (otPenaltyStartT < 0) otPenaltyStartT = snap.objective.time;
        showTransient('サドンデス', '甕が同値 — 次に確保した陣が取得', 3200);
        break;
      case 'round_active':
        showTransient('潮井開放', '', 2000);
        break;
      case 'round_setup':
        otPenaltyStartT = -1;
        roundEndSub = '';
        break;
      case 'round_end': {
        const w = e.winner;
        const sc = e.score;
        roundEndSub = w === myTeam
          ? `自軍がラウンド${e.round}を取得（自 ${sc[myTeam]} - ${sc[1 - myTeam]} 敵）`
          : `敵軍がラウンド${e.round}を取得（自 ${sc[myTeam]} - ${sc[1 - myTeam]} 敵）`;
        break;
      }
      case 'match_end':
        break; // バナーはstateから毎フレーム生成
    }
  }
}

function showTransient(main, sub, ms) {
  hud.setBanner(main, sub, false);
  transientUntil = performance.now() + ms;
}

// ---- ローカル射撃演出の可否 ----
function canFlashLocally(me, state, nowSec) {
  const weapon = weaponFor(me);
  const hasAmmo = me?.ammo == null || me.maxAmmo === null || me.ammo > 0;
  if (!me || !me.alive || me.reloading || !hasAmmo) return false;
  if (state !== 'ACTIVE' && state !== 'SETUP') return false;
  return nowSec - lastFlashT >= 1 / Math.max(0.01, weapon.rps || 1);
}

function weaponFor(player) {
  return HERO_BY_ID[player?.heroId]?.weapon || combat?.trainingWeapon || { magSize: 0, rps: 1 };
}

// ---- 他プレイヤーの補間サンプリング ----
function sampleOthers(nowMs) {
  if (snapBuf.length === 0) return [];
  const target = nowMs - net.interpMs();
  let i1 = snapBuf.length - 1;
  for (let i = 0; i < snapBuf.length; i++) {
    if (snapBuf[i].at >= target) { i1 = i; break; }
  }
  const i0 = Math.max(0, i1 - 1);
  const a = snapBuf[i0], b = snapBuf[i1];
  const alpha = b.at > a.at ? Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at))) : 1;
  const prev = new Map(a.snap.players.map(p => [p.id, p]));
  const out = [];
  for (const p of b.snap.players) {
    if (p.id === myId) continue;
    const q = prev.get(p.id) || p;
    const shown = interpolateRemotePlayer(q, p, alpha);
    out.push({
      id: p.id, name: p.name, team: p.team, heroId: p.heroId,
      alive: p.alive, hp: p.hp, shield: p.shield, maxHp: p.maxHp,
      statuses: p.statuses || [], crouch: p.crouch,
      pos: shown.pos,
      yaw: shown.yaw,
    });
  }
  return out;
}

// ---- HUDビュー構築 ----
function buildHudView(now) {
  const s = latest;
  const dts = (now - latestAt) / 1000;
  const st = s.match.state;
  const stateT = s.match.stateT + dts;
  const objTime = s.objective.time + (st === 'ACTIVE' ? dts : 0);
  const me = s.players.find(p => p.id === myId);
  const en = 1 - myTeam;

  let countAlly = 0, countEnemy = 0;
  for (const p of s.players) {
    if (p.onPoint && p.alive) (p.team === myTeam ? countAlly++ : countEnemy++);
  }
  const ownerRel = s.objective.owner < 0 ? 'none' : (s.objective.owner === myTeam ? 'ally' : 'enemy');

  const penalty = resolveRespawnPenalty(s.objective, mode, objTime, otPenaltyStartT);
  const hero = HERO_BY_ID[me?.heroId] || HERO_BY_ID[selectedHeroId];
  const weapon = hero?.weapon || combat?.trainingWeapon || {};
  const rawMaxAmmo = me?.maxAmmo;
  const infiniteAmmo = rawMaxAmmo === null || rawMaxAmmo === 0 || rawMaxAmmo === Infinity
    || rawMaxAmmo === 'infinite' || me?.ammo === null;
  const maxAmmo = infiniteAmmo ? 0 : Number.isFinite(Number(rawMaxAmmo)) ? Number(rawMaxAmmo) : (weapon.magSize || 0);
  const teammates = s.players
    .filter(player => player.team === myTeam && player.id !== myId)
    .map(player => {
      const teammateHero = HERO_BY_ID[player.heroId];
      return {
        id: player.id,
        name: player.name,
        heroName: player.heroName || teammateHero?.name || player.heroId || '',
        hp: Number(player.hp) || 0,
        shield: Number(player.shield) || 0,
        maxHp: Number(player.maxHp) || teammateHero?.maxHp || 1,
        alive: player.alive !== false,
      };
    });
  const view = {
    joined,
    state: st,
    setupLeft: Math.max(0, s.match.setupSec - stateT),
    timeLeft: Math.max(0, s.match.roundCapSec - objTime),
    round: s.match.round,
    scoreAlly: s.match.score[myTeam],
    scoreEnemy: s.match.score[en],
    sideAlly: s.match.sides[myTeam],
    potAlly: s.objective.pot[myTeam],
    potEnemy: s.objective.pot[en],
    gaugeAlly: s.objective.gauge[myTeam],
    gaugeEnemy: s.objective.gauge[en],
    owner: ownerRel,
    sealed: s.objective.sealed,
    contested: countAlly > 0 && countEnemy > 0,
    countAlly, countEnemy,
    ot: s.objective.ot,
    suddenDeath: s.objective.suddenDeath,
    penalty,
    heroId: me?.heroId || hero?.id || selectedHeroId,
    heroName: me?.heroName || hero?.name || '未選択',
    role: me?.role || hero?.role || '',
    roleLabel: me?.roleLabel || hero?.roleLabel || me?.role || '',
    weaponName: me?.weaponName || weapon.displayName || '武器',
    weaponTrait: describeWeaponTrait(weapon),
    hp: me ? me.hp : 0,
    shield: me?.shield || 0,
    maxHp: me?.maxHp || hero?.maxHp || combat?.health.trainingBodyHp || 250,
    ammo: infiniteAmmo ? 0 : (Number(me?.ammo) || 0),
    maxAmmo,
    infiniteAmmo,
    resource: me?.resource || null,
    ultGauge: Math.max(0, Math.min(100, Number(me?.ultGauge) || 0)),
    abilities: normalizeAbilities(me, hero, st),
    statuses: me?.statuses || [],
    teammates,
    aliveAllies: s.players.filter(player => player.team === myTeam && player.alive).length,
    aliveEnemies: s.players.filter(player => player.team === en && player.alive).length,
    reloading: !!me?.reloading,
    reloadRemainingSec: me?.reloadRemainingSec,
    reloadProgress: me?.reloadProgress,
    alive: me ? me.alive : true,
    respawnIn: me ? Math.max(0, me.respawnIn - dts) : 0,
    rtt: net.rttEma || net.rtt || -1,
    interpMs: net.interpMs(),
  };
  if (abilityAttemptFeedback && abilityAttemptFeedback.until <= now) abilityAttemptFeedback = null;
  view.abilityFeedback = view.alive && (st === 'ACTIVE' || st === 'SETUP')
    ? abilityAttemptFeedback
    : null;
  view.guidance = buildCombatGuidance(view);
  return view;
}

function normalizeAbilities(player, hero, matchState = '') {
  const normalized = {};
  for (const slot of Object.keys(SLOT_LABELS)) {
    const definition = hero?.abilities?.[slot] || {};
    const current = player?.abilities?.[slot] || {};
    const cooldownRemaining = Number(current.cooldownRemaining ?? player?.cooldowns?.[slot] ?? 0) || 0;
    const castRemaining = Number(current.castRemaining ?? (player?.cast?.slot === slot ? player.cast.remaining : 0)) || 0;
    const activeRemaining = Number(current.activeRemaining ?? 0) || 0;
    normalized[slot] = buildAbilityHudModel(definition, {
      ...current,
      cooldownRemaining,
      castRemaining,
      activeRemaining,
    }, {
      input: SLOT_LABELS[slot],
      effect: BEHAVIOR_TEXT[definition.behavior] || definition.description || definition.name || '効果説明なし',
      ultGauge: Number(player?.ultGauge) || 0,
      resource: player?.resource || null,
      alive: player?.alive !== false,
      matchState,
    });
  }
  return normalized;
}

function captureAbilityAttemptFeedback(inputFrame, player, matchState, now) {
  const newlyPressed = [];
  for (const slot of Object.keys(SLOT_LABELS)) {
    const pressed = !!inputFrame?.[slot];
    if (pressed && !abilityInputDown[slot]) newlyPressed.push(slot);
    abilityInputDown[slot] = pressed;
  }
  if (newlyPressed.length === 0) return;
  if (!player) return;
  const hero = HERO_BY_ID[player?.heroId] || HERO_BY_ID[selectedHeroId];
  const abilities = normalizeAbilities(player, hero, matchState);
  abilityAttemptFeedback = null;
  for (const slot of newlyPressed) {
    const feedback = resolveAbilityAttemptFeedback(abilities[slot]);
    if (feedback) abilityAttemptFeedback = { ...feedback, until: now + 2200 };
  }
}

function updateBanner(now, view) {
  if (now < transientUntil) return;
  if (!view) { hud.hideBanner(); return; }
  if (view.state === 'SETUP') {
    hud.setBanner('準備', `開戦まで ${Math.ceil(view.setupLeft)} 秒`);
  } else if (view.state === 'ROUND_END') {
    hud.setBanner('ラウンド取得', roundEndSub);
  } else if (view.state === 'MATCH_END') {
    const w = latest.match.matchWinner;
    const sub = w >= 0
      ? `勝者: ${w === myTeam ? '自軍' : '敵軍'}（自 ${latest.match.score[myTeam]} - ${latest.match.score[1 - myTeam]} 敵）`
      : '';
    hud.setBanner('試合終了', sub, true);
  } else {
    hud.hideBanner();
  }
}

// ---- メインループ ----
let lastFrame = performance.now();
let acc = 0;

const frameDriver = new FrameDriver({
  document,
  onFrame: frame,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  setInterval: window.setInterval.bind(window),
  clearInterval: window.clearInterval.bind(window),
});

function frame(now) {
  const rawDt = Math.max(0, (now - lastFrame) / 1000);
  const dt = Math.min(0.1, rawDt);
  lastFrame = now;
  const nowSec = now / 1000;

  const me = latest ? latest.players.find(p => p.id === myId) : null;
  const st = latest ? latest.match.state : '';
  const frozen = st === 'ROUND_END' || st === 'MATCH_END';

  // 固定ステップ: 入力送信 + ローカル予測（dt=1/63アキュムレータ）
  if (joined && MV) {
    acc += dt;
    while (acc >= FIXED_DT) {
      acc -= FIXED_DT;
      const currentWeapon = weaponFor(me);
      // reload可否は入力順を保持したserverが権威判定する。
      const inp = input.buildInput(++seq, net.interpMs(), true, FIXED_DT);
      captureAbilityAttemptFeedback(inp, me, st, now);
      net.sendInput(inp);
      if (pred && me && me.alive && !frozen) {
        const predictionMovement = resolvePredictionMovementConfig(MV, me);
        step(pred, inp, FIXED_DT, collider, predictionMovement);
        pending.push(inp);
        if (pending.length > 260) pending.shift(); // 暴走保険（約4秒分）
        if (inp.fire && canFlashLocally(me, st, nowSec)) {
          lastFlashT = nowSec;
          const eye = [pred.pos[0], pred.pos[1], pred.pos[2] + eyeHeight(pred, MV)];
          renderer.muzzleFlash(eye, pred.yaw, pred.pitch);
          hud.muzzleFlash();
          audio.playLocalShot(currentWeapon.id);
        }
      }
    }
    // 誤差オフセットの指数減衰
    const k = Math.exp(-10 * dt);
    errOff[0] *= k; errOff[1] *= k; errOff[2] *= k;
  }
  // カメラ
  let camPose;
  if (pred && MV) {
    camPose = {
      pos: [pred.pos[0] + errOff[0], pred.pos[1] + errOff[1], pred.pos[2] + errOff[2] + eyeHeight(pred, MV)],
      yaw: input.yaw,
      pitch: input.pitch,
    };
  } else {
    // 未参加/観戦: マップ全景をゆっくり周回
    const t = now / 1000 * 0.06;
    const px = Math.cos(t) * 58, py = Math.sin(t) * 42;
    camPose = { pos: [px, py, 34], yaw: Math.atan2(-py, -px), pitch: -0.52 };
  }
  audio.setListener(camPose);

  // ワールド表示更新
  if (latest) {
    renderer.setPlayers(sampleOthers(now), myTeam, combat ? combat.health.trainingBodyHp : 250);
    renderer.setLocalHero?.(me?.heroId || selectedHeroId);
    renderer.setWorldEffects({
      zones: latest.zones || [],
      barriers: latest.barriers || [],
      projectiles: latest.projectiles || [],
    }, myTeam);
    renderer.updateObjective({
      sealed: latest.objective.sealed,
      owner: latest.objective.owner,
      myTeam,
      contested: countContested(latest),
      tSec: nowSec,
    });
    renderer.updatePickups(latest.pickups, nowSec);
    renderer.setDoorsVisible(st === 'SETUP');
  }
  // Keep simulation catch-up bounded, but record the real browser frame time so
  // long stalls cannot disappear from p95/p99/max production diagnostics.
  renderer.update(rawDt);
  renderer.render(camPose);

  // HUD
  if (latest && joined) {
    const view = buildHudView(now);
    hud.updateFrame(view);
    updateBanner(now, view);
  } else {
    updateBanner(now, null);
  }
}

function countContested(s) {
  let a = 0, b = 0;
  for (const p of s.players) {
    if (p.onPoint && p.alive) (p.team === 0 ? a++ : b++);
  }
  return a > 0 && b > 0;
}

frameDriver.start();

const removePerformanceDiagnostics = installPerformanceDiagnostics(
  globalThis,
  () => renderer.getPerformanceSnapshot(),
);
let clientDisposed = false;
function disposeClient(event) {
  if (event?.persisted || clientDisposed) return;
  clientDisposed = true;
  removePerformanceDiagnostics();
  frameDriver.stop();
  renderer.dispose();
}
window.addEventListener('pagehide', disposeClient);
