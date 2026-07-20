import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  fetchVerifiedAsset,
  normalizeSha256,
} from '../client/runtime_asset_integrity.js';

const BYTES = new TextEncoder().encode('verified runtime asset');
const SHA256 = '7b60610961362f1e793259e4b39cf493da25c364172f4a76b9bd9e7ffd8f227c';
const ASSET = Object.freeze({
  runtimeUrl: `/client/assets/generated/test/fixture.${SHA256.slice(0, 12)}.bin`,
  sha256: SHA256,
  bytes: BYTES.byteLength,
});

function hostFor(bytes = BYTES) {
  return {
    crypto: webcrypto,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/octet-stream' },
      arrayBuffer: async () => bytes.slice().buffer,
    }),
  };
}

test('runtime asset loader verifies the declared size and SHA-256 before returning bytes', async () => {
  const verified = await fetchVerifiedAsset(ASSET, { host: hostFor() });
  assert.equal(verified.sha256, SHA256);
  assert.equal(verified.bytes.byteLength, BYTES.byteLength);
});

test('runtime asset loader fails closed for tampered bytes', async () => {
  const tampered = new TextEncoder().encode('tampered runtime asset');
  await assert.rejects(
    fetchVerifiedAsset(ASSET, { host: hostFor(tampered) }),
    /size mismatch|SHA-256 mismatch/,
  );
});

test('runtime asset loader rejects missing hashes and filenames without the digest prefix', async () => {
  assert.equal(normalizeSha256(SHA256.toUpperCase()), SHA256);
  assert.equal(normalizeSha256('not-a-hash'), null);
  await assert.rejects(
    fetchVerifiedAsset({ runtimeUrl: ASSET.runtimeUrl }, { host: hostFor() }),
    /valid SHA-256/,
  );
  await assert.rejects(
    fetchVerifiedAsset({ ...ASSET, runtimeUrl: '/client/assets/generated/test/fixture.bin' }, { host: hostFor() }),
    /digest prefix/,
  );
});

test('runtime asset loader fails closed when an expected MIME type is absent', async () => {
  const host = hostFor();
  host.fetch = async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => BYTES.slice().buffer });
  await assert.rejects(
    fetchVerifiedAsset(ASSET, { host, expectedContentType: 'application/octet-stream' }),
    /content type mismatch/,
  );
});
