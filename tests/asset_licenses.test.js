import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../client/assets/materials/polyhaven/', import.meta.url);
const EXPECTED = Object.freeze({
  'concrete_floor_01/concrete_floor_01_diff_1k.jpg': 'DB7C800F1464359B5F359FC743E82AC51B34E014FDFD53844F4AF34BB1949229',
  'concrete_floor_01/concrete_floor_01_nor_gl_1k.jpg': '28BE1F6FA82EEAB137C84954BF7EA0F5D8A4434352D01C29F15E20926EB7227E',
  'concrete_floor_01/concrete_floor_01_rough_1k.jpg': 'F5239E1C6DB5F0DDB4C2397E881A5938AB511386AAB19A23C20D40F4AB2C181B',
  'concrete/concrete_diff_1k.jpg': '046C0E2AEBE31E6043A6BC074E779F6A345F1D823D0CA1C69446C5CABADEFA8A',
  'concrete/concrete_nor_gl_1k.jpg': '298A0E93040C9D76D239A894BDF28A9787755EA5F22BAA068FFA8075369EE428',
  'concrete/concrete_rough_1k.jpg': '0DC74E17295160CF2FC214BF22A57FDDC68F261E2CBACEBB706F5B3FA5D07458',
});

test('bundled Poly Haven material bytes match the reviewed CC0 ledger', async () => {
  for (const [relativePath, expected] of Object.entries(EXPECTED)) {
    const bytes = await readFile(new URL(relativePath, ROOT));
    const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    assert.equal(actual, expected, relativePath);
  }
  const license = await readFile(new URL('LICENSE.txt', ROOT), 'utf8');
  assert.match(license, /Creative Commons Zero 1\.0 Universal/);
  assert.match(license, /https:\/\/polyhaven\.com\/license/);
  assert.match(license, /concrete_floor_01/);
});
