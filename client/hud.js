// DOMオーバーレイHUD。表示はすべて「自分のチーム視点」（自軍=シアン / 敵軍=オレンジ）。

import { HERO_BY_ID } from '/shared/data/heroes.js';
import { formatReloadStatus } from '/client/presentation.js';

const $ = (id) => document.getElementById(id);

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor() {
    this.el = {
      topPanel: $('topPanel'),
      potAllyPct: document.querySelector('#potAlly .potPct'),
      potEnemyPct: document.querySelector('#potEnemy .potPct'),
      gaugeAllyFill: $('gaugeAllyFill'),
      gaugeEnemyFill: $('gaugeEnemyFill'),
      roundTime: $('roundTime'),
      objState: $('objState'),
      objCount: $('objCount'),
      matchRow: $('matchRow'),
      otPanel: $('otPanel'),
      otTitle: $('otTitle'),
      otGaugeFill: $('otGaugeFill'),
      otInfo: $('otInfo'),
      banner: $('banner'),
      bannerMain: $('bannerMain'),
      bannerSub: $('bannerSub'),
      restartBtn: $('restartBtn'),
      toasts: $('toasts'),
      hitmarker: $('hitmarker'),
      muzzleGlow: $('muzzleGlow'),
      heroName: $('heroName'),
      heroRole: $('heroRole'),
      statusList: $('statusList'),
      hpNum: $('hpNum'),
      shieldNum: $('shieldNum'),
      maxHpNum: $('maxHpNum'),
      hpFill: $('hpFill'),
      shieldFill: $('shieldFill'),
      weaponName: $('weaponName'),
      ammoNum: $('ammoNum'),
      reloadTxt: $('reloadTxt'),
      weaponTrait: $('weaponTrait'),
      resourceBlock: $('resourceBlock'),
      resourceName: $('resourceName'),
      resourceNum: $('resourceNum'),
      resourceFill: $('resourceFill'),
      deathOverlay: $('deathOverlay'),
      deathTitle: $('deathTitle'),
      respawnTxt: $('respawnTxt'),
      respawnContext: $('respawnContext'),
      respawnHeroBtn: $('respawnHeroBtn'),
      killfeed: $('killfeed'),
      scoreboard: $('scoreboard'),
      sbTitle: $('sbTitle'),
      sbAllyName: $('sbAllyName'),
      sbEnemyName: $('sbEnemyName'),
      sbAllyTable: $('sbAllyTable'),
      sbEnemyTable: $('sbEnemyTable'),
      pingBox: $('pingBox'),
      lockHint: $('lockHint'),
      teamList: $('teamList'),
      guidancePanel: $('guidancePanel'),
      guidanceRolePurpose: $('guidanceRolePurpose'),
      guidancePhase: $('guidancePhase'),
      guidanceInstruction: $('guidanceInstruction'),
      guidanceChecklist: $('guidanceChecklist'),
      tacticalPrompt: $('tacticalPrompt'),
      tacticalPromptLabel: $('tacticalPromptLabel'),
      tacticalPromptText: $('tacticalPromptText'),
      damageVignette: $('damageVignette'),
      damageIndicator: $('damageIndicator'),
      hudDetailToggle: $('hudDetailToggle'),
    };
    this.ability = {
      secondary: abilityElements('abilitySecondary'),
      ability1: abilityElements('abilityAbility1'),
      ability2: abilityElements('abilityAbility2'),
      ultimate: abilityElements('abilityUltimate'),
    };
    this._hmTimer = 0;
    this._flashTimer = 0;
    this.el.muzzleGlow.style.transition = 'opacity 90ms linear';
    this.scoreboardShown = false;
    this._teamSignature = '';
    this._guidanceSignature = '';
    this._tacticalPromptSignature = '';
    this._damageTimer = 0;
    this.detailsExpanded = false;
    this.el.hudDetailToggle?.addEventListener?.('click', () => this.toggleDetails());
    this.setDetailsExpanded(false);
  }

  // ---- 毎フレーム更新 ----
  // v: main.js が組み立てた自分視点のビュー
  updateFrame(v) {
    const e = this.el;

    // 甕（0.1%刻み整数 → %表記）
    e.potAllyPct.textContent = (v.potAlly / 10).toFixed(1) + '%';
    e.potEnemyPct.textContent = (v.potEnemy / 10).toFixed(1) + '%';

    // 争奪ゲージ（争奪中のみ幅を出す。占有側は100のまま出さない）
    e.gaugeAllyFill.style.width = (v.owner === 'ally' ? 0 : v.gaugeAlly) + '%';
    e.gaugeEnemyFill.style.width = (v.owner === 'enemy' ? 0 : v.gaugeEnemy) + '%';

    // 残り時間
    if (v.state === 'SETUP') e.roundTime.textContent = '準備 ' + fmtTime(v.setupLeft);
    else e.roundTime.textContent = fmtTime(v.timeLeft);

    // 目標状態
    let stateTxt = '—', stateColor = '', blink = false;
    if (v.state === 'SETUP' || v.sealed) { stateTxt = '封灯'; stateColor = '#b9c4c8'; }
    else if (v.contested) { stateTxt = '拮抗'; stateColor = '#ffd76e'; blink = true; }
    else if (v.countAlly > 0 && v.owner !== 'ally') { stateTxt = '争奪中（自軍）'; stateColor = 'var(--c-ally)'; }
    else if (v.countEnemy > 0 && v.owner !== 'enemy') { stateTxt = '争奪中（敵軍）'; stateColor = 'var(--c-enemy)'; }
    else if (v.owner === 'ally') { stateTxt = '自軍占有'; stateColor = 'var(--c-ally)'; }
    else if (v.owner === 'enemy') { stateTxt = '敵軍占有'; stateColor = 'var(--c-enemy)'; }
    else { stateTxt = '中立'; stateColor = '#ffffff'; }
    e.objState.textContent = stateTxt;
    e.objState.style.color = stateColor;
    e.objState.classList.toggle('blink', blink);
    e.objCount.textContent = `目標内 自${v.countAlly}：敵${v.countEnemy}`;

    // ラウンド/スコア
    let row = `ラウンド ${v.round} ／ スコア 自 ${v.scoreAlly} - ${v.scoreEnemy} 敵 ／ 自軍サイド: ${v.sideAlly === 'east' ? '東' : '西'}`;
    if (v.suddenDeath) row += ' ／ サドンデス';
    e.matchRow.textContent = row;

    // 延長パネル
    if (v.ot) {
      e.otPanel.style.display = 'block';
      e.otTitle.textContent = v.suddenDeath ? 'サドンデス・延長' : '延長戦';
      e.otGaugeFill.style.width = (100 * v.ot.grace / Math.max(0.01, v.ot.cap)) + '%';
      e.otInfo.textContent =
        `猶予 ${v.ot.grace.toFixed(1)} 秒 ／ 現在上限 ${v.ot.cap.toFixed(0)} 秒 ／ 復帰補正 +${v.penalty} 秒`;
    } else if (v.suddenDeath) {
      e.otPanel.style.display = 'block';
      e.otTitle.textContent = 'サドンデス';
      e.otGaugeFill.style.width = '0%';
      e.otInfo.textContent = `次の確保で決着 ／ 復帰補正 +${v.penalty} 秒`;
    } else {
      e.otPanel.style.display = 'none';
    }

    // キャラクター / HP / シールド / 弾 / 固有資源
    e.heroName.textContent = v.heroName || '未選択';
    e.heroRole.textContent = v.roleLabel || v.role || '—';
    e.weaponName.textContent = v.weaponName || '武器';
    e.statusList.textContent = (v.statuses || [])
      .filter(status => (status.remaining ?? 0) > 0)
      .map(status => `${status.name || status.kind || status.id} ${Number(status.remaining).toFixed(1)}秒`)
      .join(' ／ ');
    e.hpNum.textContent = String(Math.max(0, Math.round(v.hp)));
    e.shieldNum.textContent = `+${Math.max(0, Math.round(v.shield || 0))}`;
    e.maxHpNum.textContent = ` / ${Math.max(1, Math.round(v.maxHp))}`;
    const barMax = Math.max(1, v.maxHp, v.hp + (v.shield || 0));
    const hpRatio = Math.max(0, Math.min(1, v.hp / barMax));
    const shieldRatio = Math.max(0, Math.min(1 - hpRatio, (v.shield || 0) / barMax));
    e.hpFill.style.width = (hpRatio * 100) + '%';
    e.shieldFill.style.left = (hpRatio * 100) + '%';
    e.shieldFill.style.width = (shieldRatio * 100) + '%';
    const healthRatio = Math.max(0, Math.min(1, v.hp / Math.max(1, v.maxHp)));
    e.hpFill.style.background = healthRatio > 0.5 ? 'var(--c-ally)' : healthRatio > 0.25 ? '#ffd76e' : '#ff5a4a';
    e.ammoNum.innerHTML = v.infiniteAmmo
      ? '∞'
      : `${Math.max(0, v.ammo)}<small> / ${Math.max(0, v.maxAmmo)}</small>`;
    e.reloadTxt.textContent = v.reloading
      ? formatReloadStatus(true, v.reloadRemainingSec, v.reloadProgress)
      : (!v.infiniteAmmo && v.ammo === 0 ? '弾切れ' : '');
    e.weaponTrait.textContent = v.weaponTrait || '';

    const resource = v.resource;
    e.resourceBlock.hidden = !resource;
    if (resource) {
      const max = Math.max(1, Number(resource.max) || 1);
      const value = Math.max(0, Number(resource.value) || 0);
      e.resourceName.textContent = resource.name || '固有資源';
      e.resourceNum.textContent = `${formatNumber(value)} / ${formatNumber(max)}`;
      e.resourceFill.style.width = (Math.min(1, value / max) * 100) + '%';
    }

    for (const [slot, elements] of Object.entries(this.ability)) {
      renderAbility(elements, v.abilities?.[slot], slot === 'ultimate' ? v.ultGauge : null);
    }
    this.renderGuidance(v.guidance, v.roleLabel || v.role);
    this.renderTacticalPrompt(v);
    this.renderTeam(v.teammates || []);

    // 死亡表示
    if (v.joined && !v.alive) {
      e.deathOverlay.style.display = 'block';
      const canChangeForRespawn = v.state === 'ACTIVE';
      e.deathTitle.textContent = canChangeForRespawn ? '復帰待機' : '討 死';
      e.respawnTxt.textContent = `復帰まで ${Math.max(0, v.respawnIn).toFixed(1)} 秒`;
      e.respawnContext.hidden = !canChangeForRespawn;
      e.respawnHeroBtn.hidden = !canChangeForRespawn;
    } else {
      e.deathOverlay.style.display = 'none';
      e.respawnContext.hidden = true;
      e.respawnHeroBtn.hidden = true;
    }

    // ping
    e.pingBox.textContent = `RTT ${v.rtt >= 0 ? Math.round(v.rtt) : '--'} ms ／ 補間 ${v.interpMs} ms`;
  }

  // ---- バナー ----
  setBanner(main, sub = '', showRestart = false) {
    this.el.banner.style.display = 'block';
    this.el.bannerMain.textContent = main;
    this.el.bannerSub.textContent = sub;
    this.el.restartBtn.style.display = showRestart ? 'inline-block' : 'none';
  }

  setBannerSub(sub) { this.el.bannerSub.textContent = sub; }

  hideBanner() {
    this.el.banner.style.display = 'none';
    this.el.restartBtn.style.display = 'none';
  }

  // ---- トースト ----
  toast(msg, ms = 2600) {
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    this.el.toasts.appendChild(div);
    this.el.toasts.appendChild(document.createElement('br'));
    setTimeout(() => {
      div.nextSibling?.remove();
      div.remove();
    }, ms);
  }

  // ---- キルフィード ----
  killfeed(sourceName, sourceAlly, targetName, targetAlly, headshot, abilityId = '') {
    const row = document.createElement('div');
    row.className = 'kfRow';
    const s = document.createElement('span');
    s.className = sourceAlly ? 'kfAlly' : 'kfEnemy';
    s.textContent = sourceName;
    const arrow = document.createElement('span');
    arrow.className = 'kfArrow';
    arrow.textContent = '⚔';
    const t = document.createElement('span');
    t.className = targetAlly ? 'kfAlly' : 'kfEnemy';
    t.textContent = targetName;
    row.append(s, arrow, t);
    if (abilityId) {
      const ability = document.createElement('span');
      ability.className = 'kfAbility';
      ability.textContent = `［${abilityId}］`;
      row.appendChild(ability);
    }
    if (headshot) {
      const hs = document.createElement('span');
      hs.className = 'kfHs';
      hs.textContent = 'HS';
      row.appendChild(hs);
    }
    this.el.killfeed.prepend(row);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => row.remove(), 6500);
  }

  renderTeam(teammates) {
    const signature = teammates
      .map(player => `${player.id}:${Math.round(player.hp)}:${Math.round(player.shield || 0)}:${player.alive}:${player.heroName}`)
      .join('|');
    if (signature === this._teamSignature) return;
    this._teamSignature = signature;
    this.el.teamList.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const player of teammates) {
      const row = document.createElement('div');
      row.className = 'teamMate' + (player.alive ? '' : ' dead');
      const name = document.createElement('span');
      name.className = 'teamMateName';
      name.textContent = player.name;
      const hero = document.createElement('span');
      hero.className = 'teamMateHero';
      hero.textContent = player.heroName ? `・${player.heroName}` : '';
      name.appendChild(hero);
      const hp = document.createElement('span');
      hp.className = 'teamMateHp';
      hp.textContent = player.alive ? `${Math.max(0, Math.round(player.hp))}+${Math.max(0, Math.round(player.shield || 0))}` : '復帰待ち';
      const bar = document.createElement('div');
      bar.className = 'teamMateBar';
      const fill = document.createElement('div');
      fill.className = 'teamMateFill';
      fill.style.width = (100 * Math.max(0, Math.min(1, player.hp / Math.max(1, player.maxHp)))) + '%';
      bar.appendChild(fill);
      row.append(name, hp, bar);
      fragment.appendChild(row);
    }
    this.el.teamList.appendChild(fragment);
  }

  // ---- 射撃演出（DOM側） ----
  hitmarker(headshot) {
    const hm = this.el.hitmarker;
    hm.classList.toggle('hs', !!headshot);
    hm.style.opacity = '1';
    clearTimeout(this._hmTimer);
    this._hmTimer = setTimeout(() => { hm.style.opacity = '0'; }, 130);
  }

  muzzleFlash() {
    const g = this.el.muzzleGlow;
    g.style.opacity = '0.8';
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { g.style.opacity = '0'; }, 50);
  }

  damagePulse(direction = null) {
    const vignette = this.el.damageVignette;
    const indicator = this.el.damageIndicator;
    if (!vignette && !indicator) return;
    clearTimeout(this._damageTimer);
    if (Number.isFinite(direction) && indicator) {
      if (vignette) vignette.style.opacity = '0';
      indicator.style.transform = `translate(-50%, -50%) rotate(${direction}rad)`;
      indicator.style.opacity = '1';
      this._damageTimer = setTimeout(() => { indicator.style.opacity = '0'; }, 180);
      return;
    }
    if (indicator) indicator.style.opacity = '0';
    if (vignette) vignette.style.opacity = '0.72';
    this._damageTimer = setTimeout(() => { if (vignette) vignette.style.opacity = '0'; }, 90);
  }

  renderGuidance(guidance = {}, roleLabel = '') {
    const checklist = Array.isArray(guidance.checklist) ? guidance.checklist.slice(0, 3) : [];
    const signature = [
      roleLabel, guidance.rolePurpose, guidance.phase, guidance.urgency, guidance.instruction, ...checklist,
    ].join('|');
    if (signature === this._guidanceSignature) return;
    this._guidanceSignature = signature;
    this.el.guidancePanel.dataset.urgency = guidance.urgency || 'normal';
    const purpose = guidance.rolePurpose || '味方と役割を合わせる。';
    this.el.guidanceRolePurpose.textContent = `${roleLabel || '現在のロール'}の責務：${purpose}`;
    this.el.guidancePhase.textContent = guidance.phase || '灯見';
    this.el.guidanceInstruction.textContent = `前線・目標：${guidance.instruction || '人数・遮蔽・クールダウンを確認する。'}`;
    const fragment = document.createDocumentFragment();
    for (const item of checklist.length ? checklist : ['味方と合流']) {
      const li = document.createElement('li');
      li.textContent = item;
      fragment.appendChild(li);
    }
    this.el.guidanceChecklist.replaceChildren(fragment);
  }

  renderTacticalPrompt(view = {}) {
    const feedback = view.abilityFeedback;
    const label = feedback ? '使えない理由' : '今すること';
    const text = feedback?.text || view.guidance?.instruction || '味方と合流し、目標への入口を確認する。';
    const tone = feedback?.tone || 'normal';
    this.el.tacticalPrompt.hidden = !view.joined;
    const signature = `${view.joined}|${label}|${text}|${tone}`;
    if (signature === this._tacticalPromptSignature) return;
    this._tacticalPromptSignature = signature;
    this.el.tacticalPrompt.dataset.tone = tone;
    this.el.tacticalPromptLabel.textContent = label;
    this.el.tacticalPromptText.textContent = text;
  }

  // ---- スコアボード ----
  showScoreboard(show) {
    this.scoreboardShown = !!show;
    this.el.scoreboard.style.display = show ? 'block' : 'none';
  }

  renderScoreboard(snap, myId, myTeam) {
    if (!snap) return;
    const m = snap.match;
    const myScore = m.score[myTeam], enScore = m.score[1 - myTeam];
    this.el.sbTitle.textContent = `潮占 — ラウンド ${m.round} ／ 自軍 ${myScore} - ${enScore} 敵軍`;
    this.el.sbAllyName.textContent = `自軍（${m.sides[myTeam] === 'east' ? '東' : '西'}）`;
    this.el.sbEnemyName.textContent = `敵軍（${m.sides[1 - myTeam] === 'east' ? '東' : '西'}）`;
    const header = '<tr><th>名前</th><th>英雄</th><th>K</th><th>D</th><th>DMG</th><th>回復</th></tr>';
    for (const ally of [true, false]) {
      const rows = snap.players
        .filter(p => (p.team === myTeam) === ally)
        .sort((a, b) => playerStat(b, 'kills') - playerStat(a, 'kills') || playerStat(a, 'deaths') - playerStat(b, 'deaths'));
      let html = header;
      for (const p of rows) {
        const cls = [];
        if (!p.alive) cls.push('sbDead');
        if (p.id === myId) cls.push('sbMe');
        const name = escapeHtml(p.name) + (p.bot ? '（BOT）' : '') + (p.onPoint ? ' ◆' : '');
        const heroName = p.heroName || HERO_BY_ID[p.heroId]?.name || p.heroId || '—';
        html += `<tr class="${cls.join(' ')}"><td>${name}</td><td>${escapeHtml(heroName)}</td>`
          + `<td>${playerStat(p, 'kills')}</td><td>${playerStat(p, 'deaths')}</td>`
          + `<td>${Math.round(playerStat(p, 'damage', 'dmg'))}</td><td>${Math.round(playerStat(p, 'healing'))}</td></tr>`;
      }
      (ally ? this.el.sbAllyTable : this.el.sbEnemyTable).innerHTML = html;
    }
  }

  showLockHint(show) {
    this.el.lockHint.style.display = show ? 'block' : 'none';
  }

  setDetailsExpanded(expanded, { restoreFocus = false } = {}) {
    this.detailsExpanded = !!expanded;
    globalThis.document?.body?.classList?.toggle('hud-expanded', this.detailsExpanded);
    this.el.hudDetailToggle?.setAttribute?.('aria-expanded', String(this.detailsExpanded));
    if (restoreFocus && !this.detailsExpanded) this.el.hudDetailToggle?.focus?.();
    return this.detailsExpanded;
  }

  toggleDetails() {
    return this.setDetailsExpanded(!this.detailsExpanded);
  }
}

function abilityElements(id) {
  const root = $(id);
  return {
    root,
    key: root.querySelector('.abilityKey'),
    name: root.querySelector('.abilityName'),
    state: root.querySelector('.abilityState'),
    effect: root.querySelector('.abilityEffect'),
    meta: root.querySelector('.abilityMeta'),
    fill: root.querySelector('.abilityFill'),
  };
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function renderAbility(elements, ability = null, ultGauge = null) {
  const data = ability || {};
  const cooldown = Math.max(0, Number(data.cooldownRemaining) || 0);
  const cast = Math.max(0, Number(data.castRemaining) || 0);
  const active = Math.max(0, Number(data.activeRemaining) || 0);
  let state = String(data.state || '').toLowerCase();
  if (state === 'windup' || state === 'cast') state = 'casting';
  if (!data.stateText) {
    if (cast > 0) state = 'casting';
    else if (active > 0) state = 'active';
    else if (cooldown > 0) state = 'cooldown';
    else if (ultGauge !== null && Number(ultGauge) < 100) state = 'charging';
  }
  if (!state) state = 'ready';

  let stateText = data.stateText;
  if (!stateText) {
    if (state === 'casting') stateText = `詠唱 ${cast.toFixed(1)}秒`;
    else if (state === 'active') stateText = `発動中 ${active.toFixed(1)}秒`;
    else if (state === 'cooldown' || state === 'cd') stateText = `CD ${cooldown.toFixed(1)}秒`;
    else if (state === 'charging') stateText = `${Math.round(Number(ultGauge) || 0)}%`;
    else if (state === 'ready') stateText = '使用可能';
    else if (state === 'locked' || state === 'disabled') stateText = '使用不可';
    else stateText = data.state || '待機';
  }

  let fillPct = state === 'ready' ? 100 : 0;
  if (ultGauge !== null) fillPct = Math.max(0, Math.min(100, Number(ultGauge) || 0));
  else if (state === 'cooldown') fillPct = 100 * (1 - cooldown / Math.max(cooldown, Number(data.cooldownTotal) || 1));
  else if (state === 'casting') fillPct = 100 * (1 - cast / Math.max(cast, Number(data.castTotal) || 1));
  else if (state === 'active') fillPct = 100 * active / Math.max(active, Number(data.activeTotal) || 1);

  elements.key.textContent = data.input || '入力未設定';
  elements.name.textContent = data.name || '—';
  elements.state.textContent = stateText;
  elements.effect.textContent = data.effect || '効果説明なし';
  elements.meta.textContent = `${data.rangeText || '射程 —'} ／ ${data.cooldownText || 'CT —'}`;
  elements.fill.style.width = `${Math.max(0, Math.min(100, fillPct))}%`;
  for (const className of ['ready', 'cooldown', 'casting', 'active', 'blocked']) {
    elements.root.classList.toggle(className, state === className || (className === 'casting' && state === 'cast'));
  }
  elements.root.dataset.state = state;
  elements.root.setAttribute('aria-disabled', String(!!data.blocked));
  elements.root.setAttribute('aria-label', [
    data.input || '入力未設定', data.name || '能力', data.effect || '効果説明なし',
    data.rangeText || '射程不明', data.cooldownText || 'CT不明', stateText,
  ].join('、'));
}

function playerStat(player, key, legacy = key) {
  const value = player.stats?.[key] ?? player.stats?.[legacy] ?? player[legacy] ?? player[key] ?? 0;
  return Number(value) || 0;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
