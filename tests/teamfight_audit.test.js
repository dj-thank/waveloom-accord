import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runTeamfightAudit } from '../tools/teamfight_audit.js';

const root = new URL('../', import.meta.url);
const EXPECTED_SOURCE_PATHS = [
  'server/bots.js',
  'shared/data/combat.json',
  'shared/data/heroes.js',
  'shared/data/map_oshioi.js',
  'shared/rules/bot_roster.js',
  'shared/rules/team_capabilities.js',
  'shared/sim/combat.js',
  'shared/sim/sim.js',
  'shared/telemetry/teamfight_metrics.js',
  'tools/teamfight_audit.js',
];

test('fixed seed audit is deterministic and read-only', { timeout: 20_000 }, () => {
  const first = runTeamfightAudit({
    seed: 20260713,
    matchIndex: 0,
    durationSec: 5,
    schemaId: 'caller-forged',
    schemaVersion: 999,
  });
  const second = runTeamfightAudit({ seed: 20260713, matchIndex: 0, durationSec: 5 });
  assert.deepEqual(first, second);
  assert.equal(first.seed, 20260713);
  assert.equal(first.ticks, second.ticks);
  assert.deepEqual(first.rounds, second.rounds);
  assert.deepEqual(first.teamCompositions, second.teamCompositions);
  assert.ok(Array.isArray(first.objective.timeline));
  assert.ok(first.objective.timeline.every(sample => (
    Array.isArray(sample.presence)
    && Array.isArray(sample.occupants)
    && Array.isArray(sample.near)
  )));
  assert.deepEqual(first.frontlineHealingByTeam.map(team => team.amount), [0, 0]);
  assert.equal(first.observationIntegrity.accepted, first.ticks);
  assert.equal(first.observationIntegrity.preTickSnapshotsAccepted, first.ticks);
  assert.equal(first.combatTotals.attributionConsistent, true);
  assert.ok(first.killAttributions.every(attribution => (
    (attribution.engagementId === null) !== (attribution.outsideReason === null)
  )));
  assert.ok(first.engagements.every(engagement => (
    engagement.fullFrontlineContestSec <= engagement.trackerOpenSec
  )));
});

test('audit provenance binds deterministic inputs, teams, package, and core sources', {
  timeout: 20_000,
}, () => {
  const result = runTeamfightAudit({ seed: 20260713, matchIndex: 0, durationSec: 5 });
  const { provenance } = result;

  assert.equal(provenance.schemaId, 'kagariai.teamfight-audit');
  assert.equal(provenance.schemaVersion, 3);
  assert.equal(provenance.packageVersion, '1.0.0-rc.5');
  assert.equal(provenance.rosterSource, 'canonical');
  assert.deepEqual({
    seed: provenance.seed,
    matchIndex: provenance.matchIndex,
    requestedDurationSec: provenance.requestedDurationSec,
    simulatedDurationSec: provenance.simulatedDurationSec,
    ticks: provenance.ticks,
  }, {
    seed: 20260713,
    matchIndex: 0,
    requestedDurationSec: 5,
    simulatedDurationSec: result.simulatedDurationSec,
    ticks: result.ticks,
  });
  assert.deepEqual(provenance.teamCompositions, [
    [
      { heroId: 'zairu', role: 'frontline' },
      { heroId: 'shirasagi', role: 'damage' },
      { heroId: 'hokuchi', role: 'damage' },
      { heroId: 'tsuzuri', role: 'support' },
      { heroId: 'shirabe', role: 'support' },
    ],
    [
      { heroId: 'shiomaneki', role: 'frontline' },
      { heroId: 'asagi', role: 'damage' },
      { heroId: 'ankou', role: 'damage' },
      { heroId: 'hibari', role: 'support' },
      { heroId: 'karakasa', role: 'support' },
    ],
  ]);
  assert.deepEqual(provenance.teamCompositions, result.teamCompositions);
  assert.equal(Object.hasOwn(provenance, 'generatedAt'), false);
  assert.equal(Object.hasOwn(provenance, 'runId'), false);
  assert.deepEqual(result.rotation, {
    rotationIndex: 0,
    canonicalLineupIndex: 0,
    mirrored: false,
    mirrorMatchIndex: 3,
    acceptanceSeed: 20260713,
    logicalLineupSlots: [
      [
        'lineup:0|side:a|slot:0',
        'lineup:0|side:a|slot:1',
        'lineup:0|side:a|slot:2',
        'lineup:0|side:a|slot:3',
        'lineup:0|side:a|slot:4',
      ],
      [
        'lineup:0|side:b|slot:0',
        'lineup:0|side:b|slot:1',
        'lineup:0|side:b|slot:2',
        'lineup:0|side:b|slot:3',
        'lineup:0|side:b|slot:4',
      ],
    ],
  });
  assert.equal(result.botRng.scheme.id, 'kagariai.bot-rng.counter-domain.v1');
  assert.equal(result.botRng.scheme.defaultDomain, 'bot-controller');
  assert.equal(result.botRng.scheme.sideDrawDomain, 'match-side-draw');
  assert.equal(result.botRng.scheme.matchSeedDomain, 'match-world-seed');
  assert.equal(result.botRng.matchSeed, 20260713);
  assert.equal(result.botRng.controllers.length, 10);
  assert.ok(result.botRng.controllers.every(controller => (
    controller.defaultDomain === 'bot-controller'
    && controller.physicalTeamInIdentity === false
    && !controller.identity.includes('team:')
  )));
  assert.deepEqual(provenance.rotation, result.rotation);
  assert.deepEqual(provenance.botRng, result.botRng);

  const paths = provenance.sourceManifest.map(record => record.path);
  assert.deepEqual(paths, [...paths].sort());
  for (const expectedPath of EXPECTED_SOURCE_PATHS) {
    assert.ok(paths.includes(expectedPath), `missing core source: ${expectedPath}`);
  }
  for (const record of provenance.sourceManifest) {
    assert.match(record.sha256, /^[a-f0-9]{64}$/, record.path);
    const expectedHash = createHash('sha256')
      .update(readFileSync(new URL(record.path, root)))
      .digest('hex');
    assert.equal(record.sha256, expectedHash, record.path);
  }
});

test('audit mirror pair reuses seed and logical RNG identities while reversing physical teams', {
  timeout: 20_000,
}, () => {
  const base = runTeamfightAudit({ matchIndex: 0, durationSec: 1 });
  const mirrored = runTeamfightAudit({ matchIndex: 3, durationSec: 1 });
  const identityByHero = result => new Map(result.botRng.controllers.map(controller => [
    controller.heroId,
    { identity: controller.identity, physicalTeam: controller.physicalTeam },
  ]));
  const baseByHero = identityByHero(base);
  const mirroredByHero = identityByHero(mirrored);

  assert.equal(base.seed, 20260713);
  assert.equal(mirrored.seed, 20260713);
  assert.equal(base.rotation.mirrorMatchIndex, 3);
  assert.equal(mirrored.rotation.mirrorMatchIndex, 0);
  for (const [heroId, original] of baseByHero) {
    const reversed = mirroredByHero.get(heroId);
    assert.equal(reversed.identity, original.identity, heroId);
    assert.equal(reversed.physicalTeam, 1 - original.physicalTeam, heroId);
  }
});

test('audit accepts a validated counterfactual roster without mutating the caller input', {
  timeout: 20_000,
}, () => {
  const teamCompositions = [
    [
      { heroId: 'vesta', role: 'frontline' },
      { heroId: 'asagi', role: 'damage' },
      { heroId: 'ankou', role: 'damage' },
      { heroId: 'tsuzuri', role: 'support' },
      { heroId: 'kazura', role: 'support' },
    ],
    [
      { heroId: 'nuedori', role: 'frontline' },
      { heroId: 'shirasagi', role: 'damage' },
      { heroId: 'botan', role: 'damage' },
      { heroId: 'hibari', role: 'support' },
      { heroId: 'shirabe', role: 'support' },
    ],
  ];
  const expected = structuredClone(teamCompositions);
  const result = runTeamfightAudit({
    seed: 20260713,
    matchIndex: 1,
    durationSec: 1,
    teamCompositions,
  });

  assert.deepEqual(teamCompositions, expected);
  assert.deepEqual(result.teamCompositions, expected);
  assert.deepEqual(result.provenance.teamCompositions, expected);
  assert.equal(result.provenance.rosterSource, 'counterfactual');
  const invalidTeam = structuredClone(teamCompositions[0]);
  invalidTeam[1] = { heroId: 'vesta', role: 'damage' };
  assert.throws(() => runTeamfightAudit({
    durationSec: 1,
    teamCompositions: [invalidTeam, teamCompositions[1]],
  }), /competitive roster|duplicates|invalid hero slot|sustain/i);
});
