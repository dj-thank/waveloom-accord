const ROLE_GUIDANCE = Object.freeze({
  frontline: Object.freeze({
    purpose: '空間と時間を作り、敵の射線と注意を引き受ける。',
    setup: '味方が使える前線の入口を一つ決める。',
    neutral: '遮蔽から半歩出て安全な射線を作り、開戦の合図を待つ。',
    contest: '目標上で敵の射線と注意を引き受け、焔手が撃てる空間を保つ。',
    advantage: '敵の退路を狭めるが、味方の射線から外れない。',
  }),
  damage: Object.freeze({
    purpose: '篝手が作った空間を、撃破と継続圧力へ変える。',
    setup: '篝手が選ぶ入口から撃てる交差射線を探す。',
    neutral: '単独で火蓋を切らず、篝手の注意取りに合わせて撃つ。',
    contest: '篝手が見ている敵へ火力を集中し、最初の撃破を作る。',
    advantage: '低体力の敵を追い焚きし、復帰前に目標時間へ変える。',
  }),
  support: Object.freeze({
    purpose: '味方を維持し、能力と位置で集団戦のテンポを管理する。',
    setup: '篝手を視認でき、敵の直線射線から外れる遮蔽を選ぶ。',
    neutral: '篝手の一歩後ろを保ち、防御能力を敵の開戦へ返す。',
    contest: '味方を目標へ送り続け、自分は遮蔽から生存を優先する。',
    advantage: '深追いせず、前線を維持して次の合流を早める。',
  }),
});

function roleFor(value) {
  return ROLE_GUIDANCE[value] ? value : 'damage';
}

function readyAbilityCount(abilities) {
  return Object.values(abilities || {}).filter(ability => {
    const state = String(ability?.state || '').toLowerCase();
    return state === 'ready' || state === 'active';
  }).length;
}

export function buildCombatGuidance(view = {}) {
  const role = roleFor(view.role);
  const profile = ROLE_GUIDANCE[role];
  const hpRatio = Math.max(0, Number(view.hp) || 0) / Math.max(1, Number(view.maxHp) || 1);
  const aliveAllies = Math.max(0, Number(view.aliveAllies) || 0);
  const aliveEnemies = Math.max(0, Number(view.aliveEnemies) || 0);
  const ultimateReady = Number(view.ultGauge) >= 100;
  const checklist = [];
  let phase = '灯見';
  let urgency = 'normal';
  let instruction = profile.neutral;

  if (view.alive === false) {
    phase = '結い直し';
    instruction = '復帰ウェーブで味方と合流し、単独で前線へ戻らない。';
  } else if (view.state === 'SETUP') {
    phase = '結い直し';
    instruction = profile.setup;
    checklist.push('味方5人の位置と進む入口を確認');
  } else if (hpRatio <= 0.3) {
    phase = '退き火';
    urgency = 'danger';
    instruction = role === 'support'
      ? '生存を最優先。遮蔽へ下がり、自分を回復できる味方と合流する。'
      : '遮蔽へ退き、灯手と合流して二人目の撃破を渡さない。';
  } else if (aliveAllies > 0 && aliveEnemies - aliveAllies >= 1) {
    phase = '退き火';
    urgency = 'danger';
    instruction = '人数不利。遮蔽をつないで後退し、復帰した味方と合流する。';
  } else if (view.contested) {
    phase = '帳簿交換';
    urgency = 'focus';
    instruction = profile.contest;
    checklist.push(`目標内 自${Number(view.countAlly) || 0}：敵${Number(view.countEnemy) || 0}`);
  } else if (aliveAllies - aliveEnemies >= 1) {
    phase = '追い焚き';
    urgency = 'focus';
    instruction = profile.advantage;
  } else if (view.owner === 'ally') {
    phase = '薪べ';
    instruction = '占有を時間へ変える。敵の復帰方向を見ながら有利な遮蔽を維持する。';
  } else if (view.owner === 'enemy' || Number(view.countAlly) > 0) {
    phase = '座取り';
    urgency = 'focus';
    instruction = profile.neutral;
  }

  if (ultimateReady) checklist.push('必殺技準備完了 — 味方の火蓋に合わせる');
  const ready = readyAbilityCount(view.abilities);
  if (ready > 0) checklist.push(`使用可能な能力 ${ready}種`);
  if (checklist.length === 0) checklist.push('人数・遮蔽・クールダウンを確認');

  return {
    role,
    rolePurpose: profile.purpose,
    phase,
    urgency,
    instruction,
    checklist: checklist.slice(0, 3),
  };
}

export { ROLE_GUIDANCE };
