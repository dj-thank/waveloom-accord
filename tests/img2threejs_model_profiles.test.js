import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'assets-src', 'img2threejs', 'heroes');
const ids = ['zairu','baraga','vesta','nuedori','sedora','shiomaneki','asagi','shirasagi','tsubakuro','hokuchi','botan','ankou','tsuzuri','koyomi','karakasa','shirabe','hibari','kazura'];

test('all authoritative hero modeling profiles are complete and portable', () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  assert.deepEqual(files, ids.map(id => id + '.json').sort());
  const seen = new Set();
  const priorities = new Set();
  const modelingSignatures = new Set();
  for (const file of files) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(!seen.has(p.id), 'duplicate id: ' + p.id);
    seen.add(p.id);
    assert.ok(ids.includes(p.id));
    for (const ref of [p.references.alpha, p.references.green]) {
      assert.ok(!path.isAbsolute(ref) && !ref.includes('..') && !ref.includes('\\'));
      assert.ok(fs.existsSync(path.join(root, ref)), 'missing reference: ' + ref);
    }
    assert.ok(['frontline','damage','support'].includes(p.role));
    assert.ok(p.cohort && p.modelArchetype && p.proportions.heightM > 1.2);
    assert.ok(p.silhouetteAnchors.front.length >= 3 && p.silhouetteAnchors.side.length >= 3);
    assert.ok(p.materialPalette.length >= 3);
    for (const material of p.materialPalette) {
      assert.equal(typeof material.name, 'string');
      assert.match(material.hex, /^#[0-9a-fA-F]{6}$/);
      assert.equal(typeof material.finish, 'string');
    }
    for (const key of ['head','torso','limbs','weapons','accessories']) assert.ok(p.primitives[key].length);
    for (const socket of ['weapon_primary','hand_off','back_accessory','vfx_origin']) assert.ok(p.rig.sockets.includes(socket));
    assert.match(p.rig.pivot, /\+Y up, \+Z forward/);
    assert.ok(p.rig.colliders.length >= 2 && p.animation.locomotion.length >= 3);
    for (const clip of [...p.animation.locomotion, ...p.animation.combat]) {
      assert.equal(typeof clip, 'string');
      assert.ok(clip.length >= 4);
    }
    assert.ok(p.reconstructionRisks.length >= 2 && p.qualityAcceptance.targets.length >= 3);
    assert.ok(Number.isInteger(p.rollout.priority) && p.rollout.priority >= 1 && p.rollout.priority <= 18);
    priorities.add(p.rollout.priority);
    modelingSignatures.add(JSON.stringify([
      p.modelArchetype,
      p.proportions.bodyRatio,
      p.silhouetteAnchors,
      p.primitives,
    ]));
    assert.notEqual(p.status, 'accepted');
  }
  assert.equal(seen.size, 18);
  assert.deepEqual([...priorities].sort((a, b) => a - b), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.equal(modelingSignatures.size, 18);
});

test('pilot work tree and generated client contain no workstation paths', () => {
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
  const files = [
    ...walk(path.join(root, 'work', 'img2threejs', 'shiomaneki'))
      .filter((file) => /\.(?:json|js|mjs|ts|md|log)$/i.test(file)),
    path.join(root, 'client', 'img2threejs', 'shiomaneki', 'createShiomanekiModel.js'),
  ];
  for (const relative of files) {
    const source = fs.readFileSync(relative, 'utf8');
    assert.doesNotMatch(
      source,
      /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\/Users\/)/m,
      `${path.relative(root, relative)} contains an absolute user path`,
    );
    assert.doesNotMatch(source, /\/\/# sourceURL=/, `${relative} contains a generated sourceURL`);
  }
});
