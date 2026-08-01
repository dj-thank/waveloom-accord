import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMap } from '../shared/data/map_oshioi.js';
import {
  auditCandidatePlacements,
  PLACEMENT_PROPOSALS,
  UNSAFE_CONTROL_PROPOSAL,
  THIN_VERTICAL_M,
} from '../tools/audit_img2threejs_candidate_placement.mjs';

// 画像→Three.js候補を実マップへ「仮に置いたら」どうなるかを固定するテスト。
// 候補は runtime へ入っていないので、ここで守るのは2つ。
//   ① 監査が実データを一切変えないこと（被覆も solid も増えない）。
//   ② 偽の遮蔽規則が、候補を通すために緩められていないこと。
// ②は「わざと危険な配置」を用意して、必ず落ちることで示す。

const report = auditCandidatePlacements();
const byId = new Map(report.placements.map(placement => [placement.id, placement]));

test('the placement probe never mutates map collision or cladding', () => {
  const before = buildMap();
  auditCandidatePlacements();
  const after = buildMap();
  assert.equal(after.solids.length, before.solids.length);
  assert.equal(after.presentation.layers.length, before.presentation.layers.length);
  assert.equal(
    after.presentation.layers.filter(layer => layer.semantics === 'clad-existing-solid').length,
    before.presentation.layers.filter(layer => layer.semantics === 'clad-existing-solid').length,
  );
  assert.equal(report.baselineUnsafeClusters, 0, 'the shipped map must start with zero unsafe clusters');
});

test('every audited candidate stays presentation-only and candidate-only', () => {
  assert.equal(report.placements.length, PLACEMENT_PROPOSALS.length);
  for (const placement of report.placements) {
    assert.equal(placement.adoptionState, 'candidate');
    assert.equal(placement.runtimeAdmission, 'NOT_RUNTIME_ADMITTED');
    for (const part of placement.parts) {
      assert.equal(part.colliderType, 'none', `${placement.id}/${part.id} must not declare collision`);
    }
    assert.equal(placement.clusters.new.length, 0,
      `${placement.id} must not create a new body-height cover cluster`);
  }
});

test('the market awning placement clears the real-map safety gates', () => {
  const awning = byId.get('prop-market-awning-01');
  assert.ok(awning);
  assert.equal(awning.verdict, 'PASS');
  assert.deepEqual(awning.findings.filter(finding => finding.severity === 'fail'), []);

  // 宿主は北回廊の外欄干。全部品がその footprint に収まり、上端を越えない。
  assert.ok(awning.hosts.every(host => host.hostId === 'canonical-076-wall'));
  assert.deepEqual(awning.aboveHost, [],
    'nothing may rise above the host wall; that is what keeps the canopy out of the fake-cover rule');

  // 通路側へ出ていない＝立っている人の胴体帯に入らない。
  assert.deepEqual(awning.walkableIntrusions, []);
  assert.equal(awning.metrics.outsideWalkableFootprint, true);
  assert.equal(awning.routeClearance.blocking.length, 0);
  assert.ok(awning.routeClearance.nearest.distanceM > 1.0);

  // 宣言された 2.20m の下端は幾何側で満たされていない（実測 1.50m、下端は張り綱）。
  // この配置が通るのは「人が入れない壁の footprint 内」という第2条件のためで、
  // 通路上に掛けるなら別の配置審査が要る。所見として固定しておく。
  const note = awning.findings.find(finding => finding.rule === 'underside-clearance');
  assert.equal(note.severity, 'note');
  assert.equal(note.measured, 1.5);
  assert.equal(note.limit, 2.2);
});

test('the roof finial placement is blocked by its own declared envelope width', () => {
  const finial = byId.get('prop-roof-finial-01');
  assert.ok(finial);
  assert.equal(finial.verdict, 'FAIL');

  // 実装される部品はすべて 0.80m 以下で、屋根の縁からも 0.25m 以上離れている。
  const authored = finial.parts.filter(part => part.kind === 'authored-part');
  assert.ok(authored.length > 0);
  for (const part of authored) {
    assert.ok(part.widestXY <= THIN_VERTICAL_M,
      `${part.id} is ${part.widestXY}m wide above the roof (limit ${THIN_VERTICAL_M}m)`);
  }
  assert.ok(finial.metrics.rimClearanceM >= 0.25);

  // 落ちているのは「宣言された安全エンベロープ」だけ。0.85m は 0.80m の上限を超える。
  // 規則を緩めるのではなく、宣言側を実部品（最大 0.72m）に合わせて締めるのが正しい直し方。
  const failures = finial.findings.filter(finding => finding.severity === 'fail');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].rule, 'thin-vertical');
  assert.equal(failures[0].partId, 'finial-root');
  assert.equal(failures[0].partKind, 'declared-envelope');
  assert.equal(failures[0].measured, 0.85);
  assert.equal(failures[0].limit, THIN_VERTICAL_M);
});

test('a free-standing prop in a combat lane is still rejected', () => {
  // 規則が候補を通すために緩んでいないことの対照。市場レーンの真ん中に自立させる。
  const control = auditCandidatePlacements([UNSAFE_CONTROL_PROPOSAL]).placements[0];
  assert.equal(control.verdict, 'FAIL');

  const thin = control.findings.filter(finding => finding.rule === 'thin-vertical' && finding.severity === 'fail');
  assert.ok(thin.length >= 3,
    'a 2.8m canopy standing on the market slab must be reported as uncollidable body-height geometry');
  assert.ok(thin.some(finding => finding.partKind === 'authored-part'),
    'the failure must come from real parts, not only from the declared envelope');

  const underside = control.findings.find(finding => finding.rule === 'underside-clearance');
  assert.equal(underside.severity, 'fail');
  assert.ok(control.walkableIntrusions.length > 0,
    'the control must actually sit in a standing player body band');
});
