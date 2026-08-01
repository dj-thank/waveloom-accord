// 『篝合』正典ロスター。サーバーとブラウザが同じ定義を参照する。
// 数値は凍結済みPhase 1仕様を優先し、詳細未定義の12人は正典の中核体験を
// 検証できるプロトタイプ値として同じスキーマへ落としている。

export const ROLE_NAMES = Object.freeze({
  frontline: '篝手（カガリテ）',
  damage: '焔手（ホムラテ）',
  support: '灯手（トモシテ）',
});

const baseWeapon = {
  type: 'hitscan', damage: 30, headshotMult: 1.5, rps: 3,
  magSize: 12, reloadSec: 1.5, falloffStartM: 18, falloffEndM: 36,
  falloffMinMult: 0.65, spreadDeg: 0.4, maxRangeM: 70,
};

function weapon(id, displayName, values = {}) {
  return Object.freeze({ ...baseWeapon, id, displayName, ...values });
}

function action(slot, id, name, behavior, values = {}) {
  return Object.freeze({
    slot, id, name, behavior,
    description: values.description || name,
    cooldownSec: 0,
    castSec: 0,
    rangeM: 0,
    radiusM: 0,
    durationSec: 0,
    ...values,
  });
}

function hero(values) {
  const abilities = Object.freeze(values.abilities);
  return Object.freeze({
    roleLabel: ROLE_NAMES[values.role],
    moveSpeedMult: 1,
    color: '#d9a441',
    ...values,
    teamFunctions: Object.freeze([...(values.teamFunctions || [])]),
    passive: Object.freeze(values.passive),
    weapon: Object.freeze(values.weapon),
    abilities,
  });
}

export const HEROES = Object.freeze([
  hero({
    id: 'zairu', name: 'ザイル', role: 'frontline', teamFunctions: ['space'], subtype: '高機動突入型', maxHp: 575, color: '#ef9d43',
    passive: { name: '鎖長ゲージ／錨脚', kind: 'distance_resource', resource: { id: 'chain', name: '鎖長', max: 100, initial: 45 } },
    weapon: weapon('zairu_chain_spear', '鎖杭スピア', { type: 'hybrid_melee_projectile', damage: 50, meleeDamage: 70, meleeRangeM: 3, headshotMult: 1.5, rps: 1, magSize: 1, reloadSec: 0, maxRangeM: 18, falloffStartM: 18, falloffEndM: 18.01, falloffMinMult: 1, projectileSpeedMps: 35, projectileRadiusM: 0.15 }),
    abilities: {
      secondary: action('secondary', 'taguriyose', '手繰り寄せ', 'anchor_recall', { rangeM: 28, damage: 40, pullM: 2 }),
      ability1: action('ability1', 'toubyou', '投錨', 'anchor_launch', { cooldownSec: 11, castSec: 0.35, rangeM: 28, radiusM: 4, damage: 40, slowMult: 0.7, durationSec: 2.5, shieldDurationSec: 2 }),
      ability2: action('ability2', 'makimodoshi', '巻き戻し', 'rewind_marker', { cooldownSec: 18, durationSec: 5 }),
      ultimate: action('ultimate', 'keiryukan', '大錨「繋留環」', 'ring_barrier', { castSec: 1.2, rangeM: 20, radiusM: 8, durationSec: 5, damage: 60, slowMult: 0.4, ultCost: 100 }),
    },
  }),
  hero({
    id: 'baraga', name: 'バラガ', role: 'frontline', teamFunctions: ['space', 'mitigation'], subtype: '近距離制圧型', maxHp: 700, color: '#c96d3d', moveSpeedMult: 0.94,
    passive: { name: '鋳金', kind: 'damage_taken_resource', resource: { id: 'forge', name: '鋳金', max: 100, initial: 0 } },
    weapon: weapon('baraga_forge_hammer', '溶鎚', { type: 'melee', damage: 85, headshotMult: 1, rps: 0.85, magSize: 1, reloadSec: 0, maxRangeM: 4.8, falloffStartM: 4.8, falloffEndM: 4.81, falloffMinMult: 1, spreadDeg: 0 }),
    abilities: {
      secondary: action('secondary', 'rouke', '炉受け', 'guard', { cooldownSec: 6, durationSec: 2, damageTakenMult: 0.55 }),
      ability1: action('ability1', 'chuzouheki', '鋳造壁', 'barrier', { cooldownSec: 12, rangeM: 12, radiusM: 3, durationSec: 10, barrierHp: 450, resourceCost: 35 }),
      ability2: action('ability2', 'youkaida', '熔解打', 'cone_blast', { cooldownSec: 8, rangeM: 6, radiusM: 4, damage: 75, slowMult: 0.75, durationSec: 1.5 }),
      ultimate: action('ultimate', 'daichukomi', '大鋳込み', 'fortress_buff', { radiusM: 8, durationSec: 10, barrierHp: 700, damageMult: 1.35, ultCost: 100 }),
    },
  }),
  hero({
    id: 'vesta', name: 'ヴェスタ', role: 'frontline', teamFunctions: ['space', 'pressure'], subtype: '中遠距離制御型', maxHp: 550, color: '#e7c95b',
    passive: { name: '灯圧', kind: 'time_resource', resource: { id: 'pressure', name: '灯圧', max: 100, initial: 70 } },
    weapon: weapon('vesta_pressure_cannon', '環天', { type: 'charge', damage: 50, maxDamage: 130, chargeSec: 1.6, headshotMult: 1, rps: 1.25, magSize: 0, reloadSec: 0, maxRangeM: 70, falloffStartM: 45, falloffEndM: 70, falloffMinMult: 0.8, spreadDeg: 0.15, projectileSpeedMps: 55, maxProjectileSpeedMps: 110, resourceCost: 6, maxResourceCost: 25, splashDamage: 40, splashRadiusM: 1.5 }),
    abilities: {
      secondary: action('secondary', 'henkoya', '偏光野', 'projectile_field', { cooldownSec: 2, castSec: 0.6, rangeM: 30, radiusM: 4, durationSec: 8, projectileSpeedMult: 0.45, resourceCost: 10, resourceDrainPerSec: 8 }),
      ability1: action('ability1', 'kussetsusho', '屈折翔', 'dash', { cooldownSec: 12, castSec: 0.3, rangeM: 10, resourceCost: 15 }),
      ability2: action('ability2', 'ranhansha', '乱反射', 'field_detonate', { cooldownSec: 10, castSec: 0.4, radiusM: 5, damage: 40, slowMult: 0.75, durationSec: 1.2, scatterAngleDeg: 25, interruptRefundPct: 1 }),
      ultimate: action('ultimate', 'byakuyatai', '白夜帯', 'projectile_field', { castSec: 1.2, rangeM: 12, radiusM: 12.5, durationSec: 6, projectileSpeedMult: 0.3, allyProjectileSpeedMult: 1.3, ultCost: 100 }),
    },
  }),
  hero({
    id: 'nuedori', name: 'ヌエドリ', role: 'frontline', teamFunctions: ['space'], subtype: '妨害・変則型', maxHp: 525, color: '#755b9c',
    passive: { name: '夜目', kind: 'hud_immunity' },
    weapon: weapon('nuedori_twin_needles', '連装灯針', { damage: 10, rps: 12, magSize: 36, reloadSec: 1.7, falloffStartM: 16, falloffEndM: 34, spreadDeg: 0.65 }),
    abilities: {
      secondary: action('secondary', 'tobariwatari', '帳渡り', 'dash', { cooldownSec: 8, rangeM: 8 }),
      ability1: action('ability1', 'shotoucho', '消灯帳', 'hud_suppress_zone', { cooldownSec: 13, rangeM: 16, radiusM: 6, durationSec: 7 }),
      ability2: action('ability2', 'kagenui', '影縫い', 'target_debuff', { cooldownSec: 9, rangeM: 24, damage: 25, slowMult: 0.65, durationSec: 2.5 }),
      ultimate: action('ultimate', 'yoiyami', '宵闇の緞帳', 'hud_suppress_zone', { radiusM: 18, durationSec: 6, revealEnemies: true, ultCost: 100 }),
    },
  }),
  hero({
    id: 'sedora', name: 'セドラ', role: 'frontline', teamFunctions: ['space', 'mitigation'], subtype: '陣地・護送型', maxHp: 650, color: '#8f7b4f', moveSpeedMult: 0.95,
    passive: { name: '担ぐか、据えるか', kind: 'portable_cover' },
    weapon: weapon('sedora_pile_driver', '三点灯杭', { type: 'burst', damage: 22, burstCount: 3, headshotMult: 1.4, rps: 1.7, magSize: 10, reloadSec: 1.8, falloffStartM: 18, falloffEndM: 38, projectileSpeedMps: 50 }),
    abilities: {
      secondary: action('secondary', 'katsugu', '灯柱を担ぐ', 'guard', { cooldownSec: 5, durationSec: 3, damageTakenMult: 0.65, moveSpeedMult: 0.75 }),
      ability1: action('ability1', 'sueru', '灯柱を据える', 'barrier', { cooldownSec: 11, rangeM: 10, radiusM: 2.4, durationSec: 12, barrierHp: 500 }),
      ability2: action('ability2', 'yobimodoshi', '灯柱呼び戻し', 'line_pull', { cooldownSec: 9, rangeM: 20, damage: 50, pullM: 4 }),
      ultimate: action('ultimate', 'sando', '参道', 'barrier_corridor', { rangeM: 20, durationSec: 15, barrierHp: 350, ultCost: 100 }),
    },
  }),
  hero({
    id: 'shiomaneki', name: 'シオマネキ', role: 'frontline', teamFunctions: ['space', 'pressure'], subtype: '波状突撃型', maxHp: 600, color: '#397f9f', moveSpeedMult: 0.92,
    passive: { name: '波高', kind: 'distance_resource', resource: { id: 'wave', name: '波高', max: 100, initial: 35 } },
    weapon: weapon('shiomaneki_water_bomb', '水撃弾', { type: 'explosive', damage: 48, splashDamage: 28, splashRadiusM: 3, rps: 1.3, magSize: 8, reloadSec: 1.9, maxRangeM: 36, falloffStartM: 20, falloffEndM: 36, projectileSpeedMps: 25 }),
    abilities: {
      secondary: action('secondary', 'naminori', '波乗り', 'dash', { cooldownSec: 7, rangeM: 8, shield: 35, shieldDurationSec: 3 }),
      ability1: action('ability1', 'uneri', 'うねり', 'team_wave', { cooldownSec: 13, rangeM: 16, radiusM: 5, durationSec: 4, moveSpeedMult: 1.25, shield: 40, shieldDurationSec: 4, pushM: 3 }),
      ability2: action('ability2', 'shiogaeshi', '潮返し', 'cone_blast', { cooldownSec: 9, rangeM: 8, damage: 45, pushM: 5 }),
      ultimate: action('ultimate', 'michi', '大潮「満ち」', 'team_wave', { rangeM: 24, radiusM: 8, durationSec: 6, moveSpeedMult: 1.35, shield: 75, shieldDurationSec: 6, pushM: 7, ultCost: 100 }),
    },
  }),

  hero({
    id: 'asagi', name: 'アサギ', role: 'damage', teamFunctions: ['pressure', 'sustain'], subtype: '汎用中距離型', maxHp: 250, color: '#4f9dbc',
    passive: { name: '標定／申し送り', kind: 'hit_streak_mark', resource: { id: 'mark', name: '標定', max: 5, initial: 0 } },
    weapon: weapon('asagi_survey_rifle', '淡月', { type: 'burst', damage: 22, burstCount: 3, headshotMult: 2, rps: 2, magSize: 21, reloadSec: 2.8, falloffStartM: 30, falloffEndM: 40, falloffMinMult: 0.6, spreadDeg: 0.22 }),
    abilities: {
      secondary: action('secondary', 'tensei', '点睛', 'precision_shot', { cooldownSec: 0.9, rangeM: 55, damage: 50, headshotDamage: 100, moveSpeedMult: 0.7 }),
      ability1: action('ability1', 'shirubeya', '標矢', 'mark_shot', { cooldownSec: 10, castSec: 0.3, rangeM: 35, damage: 40, markStacks: 3 }),
      ability2: action('ability2', 'tsugiashi', '継ぎ足', 'dash', { cooldownSec: 18, rangeM: 8, durationSec: 0.9, radiusM: 4, healPerSec: 40, fieldDurationSec: 5 }),
      ultimate: action('ultimate', 'sarashibi', '一斉標定「晒し灯」', 'team_reveal', { castSec: 1.2, durationSec: 8, damageMult: 1.28, ultCost: 100 }),
    },
  }),
  hero({
    id: 'shirasagi', name: 'シラサギ', role: 'damage', teamFunctions: ['pressure'], subtype: '長距離精密型', maxHp: 200, color: '#c9e6eb',
    passive: { name: '結露レンズ', kind: 'charge_fog', resource: { id: 'fog', name: '結露', max: 100, initial: 0 } },
    weapon: weapon('shirasagi_crystal_rifle', '結晶灯狙撃銃', { type: 'charge', damage: 50, maxDamage: 199, chargeSec: 1.5, headshotMult: 1.75, rps: 0.65, magSize: 6, reloadSec: 2, falloffStartM: 55, falloffEndM: 80, falloffMinMult: 0.9, spreadDeg: 0.03, maxRangeM: 120 }),
    abilities: {
      secondary: action('secondary', 'fukitoru', '露払い', 'cleanse_mobility', { cooldownSec: 7, durationSec: 2, moveSpeedMult: 1.2 }),
      ability1: action('ability1', 'hakuro', '白露標', 'reveal_trap', { cooldownSec: 12, rangeM: 24, radiusM: 4, durationSec: 8 }),
      ability2: action('ability2', 'hakuyoku', '白翼離脱', 'backstep', { cooldownSec: 11, rangeM: 7 }),
      ultimate: action('ultimate', 'sumiwatari', '澄み渡り', 'self_buff', { durationSec: 12, chargeRateMult: 2, pierce: 1, ultCost: 100 }),
    },
  }),
  hero({
    id: 'tsubakuro', name: 'ツバクロ', role: 'damage', teamFunctions: ['pressure', 'space'], subtype: '高機動遊撃型', maxHp: 200, color: '#53b886', moveSpeedMult: 1.08,
    passive: { name: '勢い', kind: 'momentum_resource', resource: { id: 'momentum', name: '勢い', max: 100, initial: 20 } },
    weapon: weapon('tsubakuro_blade', '飛翔灯刃「燕羽」', { type: 'ricochet_projectile', damage: 28, maxDamage: 44, headshotMult: 1.5, rps: 1.2, maxRps: 3, magSize: 8, reloadSec: 1.4, minReloadSec: 0.9, maxRangeM: 30, falloffStartM: 18, falloffEndM: 30, projectileSpeedMps: 40 }),
    abilities: {
      secondary: action('secondary', 'tsubamegaeshi', '燕返し', 'charged_shot', { cooldownSec: 4, castSec: 0.6, rangeM: 25, damage: 70, resourceCost: 30 }),
      ability1: action('ability1', 'tousan', '灯桟', 'air_dash', { cooldownSec: 9, castSec: 0.4, rangeM: 8, radiusM: 0.75, durationSec: 2.5, resourceGain: 20 }),
      ability2: action('ability2', 'yobibane', '呼び羽', 'blade_recall', { cooldownSec: 8, castSec: 0.3, rangeM: 24, damagePerBlade: 22, maxHitsPerTarget: 3, resourcePerBlade: 5 }),
      ultimate: action('ultimate', 'muretsubame', '群燕', 'self_buff', { castSec: 0.5, durationSec: 8, moveSpeedMult: 1.35, multiShot: 2, resourceFloor: 50, ultCost: 100 }),
    },
  }),
  hero({
    id: 'hokuchi', name: 'ホクチ', role: 'damage', teamFunctions: ['pressure'], subtype: '近距離戦闘型', maxHp: 300, color: '#db5537', moveSpeedMult: 0.98,
    passive: { name: '油量', kind: 'time_resource', resource: { id: 'oil', name: '油量', max: 100, initial: 70 } },
    weapon: weapon('hokuchi_scattergun', '火打ち式散灯銃', { type: 'shotgun', damage: 10, pellets: 9, headshotMult: 1.25, rps: 1.15, magSize: 6, reloadSec: 1.8, maxRangeM: 20, falloffStartM: 6, falloffEndM: 18, falloffMinMult: 0.35, spreadDeg: 4.5 }),
    abilities: {
      secondary: action('secondary', 'hibana', '火花打ち', 'ignite_target', { cooldownSec: 3, rangeM: 15, damage: 30, igniteDamage: 75 }),
      ability1: action('ability1', 'aburadama', '油塊', 'status_blast', { cooldownSec: 8, rangeM: 18, radiusM: 3.5, status: 'oiled', durationSec: 6, resourceCost: 30 }),
      ability2: action('ability2', 'aburasuberi', '油滑り', 'dash', { cooldownSec: 9, rangeM: 9, durationSec: 1 }),
      ultimate: action('ultimate', 'oohimatsuri', '大火祭', 'damage_aura', { durationSec: 8, radiusM: 6, damagePerSec: 45, ultCost: 100 }),
    },
  }),
  hero({
    id: 'botan', name: 'ボタン', role: 'damage', teamFunctions: ['pressure', 'space'], subtype: '範囲制圧型', maxHp: 250, color: '#d75e8e', moveSpeedMult: 0.96,
    passive: { name: '筒温', kind: 'shot_resource', resource: { id: 'heat', name: '筒温', max: 100, initial: 0 } },
    weapon: weapon('botan_bloom_cannon', '曲射灯砲', { type: 'explosive', damage: 52, splashDamage: 38, splashRadiusM: 4, rps: 0.9, magSize: 6, reloadSec: 2, maxRangeM: 48, falloffStartM: 25, falloffEndM: 48, projectileSpeedMps: 22 }),
    abilities: {
      secondary: action('secondary', 'kaika', '任意開花', 'airburst', { cooldownSec: 2, rangeM: 30, radiusM: 5, damage: 55 }),
      ability1: action('ability1', 'shikakehana', '仕掛け花', 'damage_zone', { cooldownSec: 10, rangeM: 24, radiusM: 4, durationSec: 6, damagePerSec: 22 }),
      ability2: action('ability2', 'hanabiashi', '花火足', 'backstep', { cooldownSec: 10, rangeM: 6, damage: 30, radiusM: 3 }),
      ultimate: action('ultimate', 'senrinzaki', '千輪咲き', 'barrage_zone', { castSec: 0.8, rangeM: 32, radiusM: 9, durationSec: 8, damagePerSec: 55, ultCost: 100 }),
    },
  }),
  hero({
    id: 'ankou', name: 'アンコウ', role: 'damage', teamFunctions: ['pressure', 'space'], subtype: '特殊戦術型', maxHp: 250, color: '#4d6a90',
    passive: { name: '誘因', kind: 'enemy_gaze_resource', resource: { id: 'lure', name: '誘因', max: 100, initial: 35 } },
    weapon: weapon('ankou_lure_torpedo', '提灯魚雷', { type: 'guided_projectile', damage: 55, headshotMult: 1, rps: 0.75, magSize: 5, reloadSec: 1.9, maxRangeM: 55, falloffStartM: 40, falloffEndM: 55, projectileSpeedMps: 16, spreadDeg: 0 }),
    abilities: {
      secondary: action('secondary', 'sasou', '誘導灯', 'target_reveal', { cooldownSec: 6, rangeM: 35, durationSec: 4 }),
      ability1: action('ability1', 'tsuridama', '釣り灯', 'seeking_blast', { cooldownSec: 10, rangeM: 35, damage: 70, projectileSpeedMps: 18, projectileRadiusM: 0.25, homingRangeM: 35, resourceCost: 25 }),
      ability2: action('ability2', 'mizuheri', '水辺滑行', 'dash', { cooldownSec: 9, rangeM: 8 }),
      ultimate: action('ultimate', 'shinkainogyoretsu', '深海の行列', 'homing_barrage', { durationSec: 6, rangeM: 45, damage: 45, count: 6, projectileSpeedMps: 18, projectileRadiusM: 0.22, homingRangeM: 45, ultCost: 100 }),
    },
  }),

  hero({
    id: 'tsuzuri', name: 'ツヅリ', role: 'support', teamFunctions: ['sustain', 'continuous_sustain'], subtype: '高出力回復型', maxHp: 225, color: '#e3b34e',
    passive: { name: '繕い針', kind: 'stored_heal', resource: { id: 'needles', name: '針数', max: 12, initial: 12 } },
    weapon: weapon('tsuzuri_light_needle', '灯針', { type: 'healing_projectile', damage: 24, allyHeal: 18, allyHealStored: 42, headshotMult: 1.75, rps: 1.67, magSize: 12, reloadSec: 2.5, maxRangeM: 40, falloffStartM: 30, falloffEndM: 40, projectileSpeedMps: 70 }),
    abilities: {
      secondary: action('secondary', 'itokuri', '糸繰り', 'ammo_restore', { ammoPerSec: 4, moveSpeedMult: 0.8 }),
      ability1: action('ability1', 'tsuzuriwatari', '綴り渡り', 'ally_grapple', { cooldownSec: 11, castSec: 0.25, rangeM: 28, travelSpeedMps: 14, stopDistanceM: 2, storedHeal: 60 }),
      ability2: action('ability2', 'tokito', '解き糸', 'release_stored_heal', { cooldownSec: 12, castSec: 0.2, rangeM: 30, releaseMult: 0.75 }),
      ultimate: action('ultimate', 'senbari', '千針の帳', 'stored_heal_burst', { castSec: 0.8, radiusM: 14, durationSec: 10, conversionRateMult: 2, releaseMult: 1.25, ultCost: 100 }),
    },
  }),
  hero({
    id: 'koyomi', name: 'コヨミ', role: 'support', teamFunctions: ['sustain', 'tempo'], subtype: '戦術ユーティリティ型', maxHp: 200, color: '#9b78c0',
    passive: { name: '刻み香', kind: 'ally_ability_resource', resource: { id: 'koku', name: '刻', max: 100, initial: 70 } },
    weapon: weapon('koyomi_incense_burner', '薫煙香炉', { type: 'deploy', damage: 30, headshotMult: 1, rps: 5, magSize: 2, reloadSec: 6, maxRangeM: 14, falloffStartM: 14, falloffEndM: 14.01, falloffMinMult: 1, projectileSpeedMps: 14, splashDamage: 0, splashRadiusM: 0, zoneRadiusM: 4, zoneDurationSec: 12, zoneDamagePerSec: 16, zoneSlowMult: 0.9, deployableHp: 60 }),
    abilities: {
      secondary: action('secondary', 'kemurio', '煙緒', 'zone_dash', { cooldownSec: 9, castSec: 0.3, rangeM: 22 }),
      ability1: action('ability1', 'hayamawashi', '早回しの香', 'cooldown_zone', { cooldownSec: 6, castSec: 0.7, rangeM: 20, radiusM: 6, durationSec: 5, cooldownRateMult: 2, healPerSec: 12, resourceCost: 35 }),
      ability2: action('ability2', 'chien', '遅延の香', 'cast_delay_zone', { cooldownSec: 14, castSec: 0.5, rangeM: 20, radiusM: 5, durationSec: 4, castTimeMult: 1.5, resourceCost: 35 }),
      ultimate: action('ultimate', 'uruudoki', '閏刻', 'team_cooldown_buff', { castSec: 1.2, durationSec: 6, cooldownRateMult: 3, ultCost: 100 }),
    },
  }),
  hero({
    id: 'karakasa', name: 'カラカサ', role: 'support', teamFunctions: ['mitigation'], subtype: '護衛・防御型', maxHp: 225, color: '#d55454',
    passive: { name: '張り', kind: 'guard_resource', resource: { id: 'tension', name: '張り', max: 100, initial: 100 } },
    weapon: weapon('karakasa_rib_scatter', '傘骨短筒', { type: 'shotgun', damage: 8, pellets: 8, headshotMult: 1.25, rps: 1.25, magSize: 7, reloadSec: 1.7, maxRangeM: 22, falloffStartM: 7, falloffEndM: 20, falloffMinMult: 0.4, spreadDeg: 4 }),
    abilities: {
      secondary: action('secondary', 'ukenagashi', '受け流しの傘', 'projectile_guard', { cooldownSec: 5, durationSec: 2.5, damageTakenMult: 0.35, frontalArcDeg: 120, resourceCost: 25 }),
      ability1: action('ability1', 'kasasuberi', '傘滑り', 'air_dash', { cooldownSec: 9, rangeM: 7, shield: 25, shieldDurationSec: 3 }),
      ability2: action('ability2', 'kasauch', '傘打ち', 'cone_blast', { cooldownSec: 8, rangeM: 5, damage: 45, pushM: 4 }),
      ultimate: action('ultimate', 'senbonkasa', '千本傘', 'team_guard', { castSec: 0.6, durationSec: 4, damageTakenMult: 0.45, frontalArcDeg: 120, ultCost: 100 }),
    },
  }),
  hero({
    id: 'shirabe', name: 'シラベ', role: 'support', teamFunctions: ['amplification'], subtype: '攻撃支援型', maxHp: 225, color: '#a66fc2',
    passive: { name: '調弦', kind: 'linked_ally_resource', harmonyPerLinkedDamagingHit: 5, resource: { id: 'harmony', name: '和音', max: 100, initial: 25 } },
    weapon: weapon('shirabe_string_beam', '弦ビーム', { type: 'beam', damage: 12, headshotMult: 1, rps: 5, magSize: 30, reloadSec: 1.6, maxRangeM: 28, falloffStartM: 20, falloffEndM: 28, spreadDeg: 0 }),
    abilities: {
      secondary: action('secondary', 'chogen', '調弦', 'link_ally', { cooldownSec: 3, rangeM: 30, durationSec: 12 }),
      ability1: action('ability1', 'waon', '和音開放', 'ally_damage_buff', { cooldownSec: 10, rangeM: 30, empoweredHits: 4, damageMult: 1.2, vulnerabilityDamageTakenMult: 1.15, vulnerabilityDurationSec: 1.5, resourceCost: 40 }),
      ability2: action('ability2', 'hikiyose', '弦寄せ', 'ally_grapple', { cooldownSec: 10, rangeM: 25 }),
      ultimate: action('ultimate', 'daigasso', '大合奏', 'team_damage_buff', { castSec: 0.7, durationSec: 6, damageMult: 1.2, projectileSpeedMult: 1.25, ultCost: 100 }),
    },
  }),
  hero({
    id: 'hibari', name: 'ヒバリ', role: 'support', teamFunctions: ['sustain', 'continuous_sustain', 'mobility'], subtype: '高機動支援型', maxHp: 200, color: '#e9a94c', moveSpeedMult: 1.08,
    passive: { name: '渡り距離', kind: 'distance_resource', resource: { id: 'travel', name: '渡り距離', max: 100, initial: 30 } },
    weapon: weapon('hibari_spark_shot', '飛び火弾', { type: 'explosive_heal', damage: 32, allyHeal: 18, splashDamage: 18, splashRadiusM: 3, headshotMult: 1, rps: 1.8, magSize: 10, reloadSec: 1.5, maxRangeM: 35, falloffStartM: 22, falloffEndM: 35, projectileSpeedMps: 38 }),
    abilities: {
      secondary: action('secondary', 'kassho', '短滑翔', 'air_dash', { cooldownSec: 5, rangeM: 6, resourceGain: 10 }),
      ability1: action('ability1', 'wataribi', '渡り火', 'healing_trail', { cooldownSec: 10, rangeM: 10, radiusM: 4, durationSec: 6, trailSpacingM: 4, trailEmitSec: 0.65, healPerSec: 35, damagePerSec: 12 }),
      ability2: action('ability2', 'hibariage', '雲雀上げ', 'leap_heal', { cooldownSec: 9, radiusM: 5, heal: 55 }),
      ultimate: action('ultimate', 'watarinooohi', '渡りの大火', 'healing_trail', { rangeM: 24, radiusM: 4, durationSec: 12, trailSpacingM: 4, trailEmitSec: 0.65, healPerSec: 55, damagePerSec: 20, ultCost: 100 }),
    },
  }),
  hero({
    id: 'kazura', name: 'カズラ', role: 'support', teamFunctions: ['sustain', 'mitigation'], subtype: '回復転換型', maxHp: 250, color: '#679653', moveSpeedMult: 0.97,
    passive: { name: '宿り蔓', kind: 'damage_redirect_resource', resource: { id: 'pain', name: '痛み', max: 100, initial: 0 } },
    weapon: weapon('kazura_vine_beam', '蔓ビーム', { type: 'beam', damage: 11, headshotMult: 1, rps: 5, magSize: 35, reloadSec: 1.7, maxRangeM: 25, falloffStartM: 18, falloffEndM: 25, spreadDeg: 0 }),
    abilities: {
      secondary: action('secondary', 'yadorizuru', '宿り蔓', 'redirect_link', { cooldownSec: 5, rangeM: 25, durationSec: 8, redirectPct: 0.25 }),
      ability1: action('ability1', 'itamikaiho', '痛み開放', 'resource_heal', { cooldownSec: 10, radiusM: 6, heal: 120, resourceCost: 50 }),
      ability2: action('ability2', 'togebaraki', '棘払い', 'damage_aura', { cooldownSec: 9, radiusM: 5, durationSec: 2, damagePerSec: 35 }),
      ultimate: action('ultimate', 'daiukenoootsuru', '代受苦の大蔓', 'team_redirect', { castSec: 0.8, radiusM: 14, durationSec: 8, redirectPct: 0.4, endDamage: 140, ultCost: 100 }),
    },
  }),
]);

export const HERO_BY_ID = Object.freeze(Object.fromEntries(HEROES.map(item => [item.id, item])));
export const DEFAULT_HERO_ID = 'asagi';

export function getHero(id) {
  return HERO_BY_ID[id] || HERO_BY_ID[DEFAULT_HERO_ID];
}

export function heroesForRole(role) {
  return HEROES.filter(item => item.role === role);
}
