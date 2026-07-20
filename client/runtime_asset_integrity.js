const GENERATED_ASSET_ROOT = '/client/assets/generated/';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function normalizeSha256(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function contentTypeOf(response) {
  const value = response?.headers?.get?.('content-type');
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
}

function validateDescriptor(asset) {
  const runtimeUrl = typeof asset?.runtimeUrl === 'string' ? asset.runtimeUrl : '';
  const sha256 = normalizeSha256(asset?.sha256);
  if (!runtimeUrl.startsWith(GENERATED_ASSET_ROOT)) {
    throw new Error(`runtime asset URL must stay below ${GENERATED_ASSET_ROOT}`);
  }
  if (!sha256) throw new Error(`runtime asset must declare a valid SHA-256: ${runtimeUrl || '<missing>'}`);
  if (!runtimeUrl.toLowerCase().includes(`.${sha256.slice(0, 12)}.`)) {
    throw new Error(`runtime asset filename must contain its SHA-256 digest prefix: ${runtimeUrl}`);
  }
  const declaredBytes = Number(asset?.bytes);
  return {
    runtimeUrl,
    sha256,
    declaredBytes: Number.isSafeInteger(declaredBytes) && declaredBytes >= 0 ? declaredBytes : null,
  };
}

export async function fetchVerifiedAsset(asset, {
  host = globalThis,
  fetcher = null,
  expectedContentType = '',
  maxBytes = 16 * 1024 * 1024,
} = {}) {
  const descriptor = validateDescriptor(asset);
  const request = fetcher || host?.fetch?.bind(host);
  const subtle = host?.crypto?.subtle;
  if (typeof request !== 'function') throw new Error('runtime asset fetch is unavailable');
  if (!subtle?.digest) throw new Error('Web Crypto SHA-256 is unavailable');

  const response = await request(descriptor.runtimeUrl, {
    credentials: 'same-origin',
    cache: 'force-cache',
  });
  if (!response?.ok) {
    throw new Error(`runtime asset request failed: ${response?.status ?? 'unknown'} ${descriptor.runtimeUrl}`);
  }
  const receivedType = contentTypeOf(response);
  if (expectedContentType && receivedType !== expectedContentType.toLowerCase()) {
    throw new Error(`runtime asset content type mismatch: expected ${expectedContentType}, received ${receivedType}`);
  }

  const source = await response.arrayBuffer();
  const bytes = source instanceof ArrayBuffer
    ? source
    : ArrayBuffer.isView(source)
      ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
      : null;
  if (!bytes) throw new Error(`runtime asset did not return bytes: ${descriptor.runtimeUrl}`);
  if (bytes.byteLength > maxBytes) {
    throw new Error(`runtime asset exceeds ${maxBytes} bytes: ${descriptor.runtimeUrl}`);
  }
  if (descriptor.declaredBytes !== null && bytes.byteLength !== descriptor.declaredBytes) {
    throw new Error(`runtime asset size mismatch: expected ${descriptor.declaredBytes}, received ${bytes.byteLength}`);
  }

  const actualSha256 = bytesToHex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
  if (actualSha256 !== descriptor.sha256) {
    throw new Error(`runtime asset SHA-256 mismatch: expected ${descriptor.sha256}, received ${actualSha256}`);
  }
  return Object.freeze({
    runtimeUrl: descriptor.runtimeUrl,
    sha256: descriptor.sha256,
    bytes,
    contentType: receivedType || expectedContentType || 'application/octet-stream',
  });
}

export async function createVerifiedObjectUrl(asset, options = {}) {
  const host = options.host || globalThis;
  const BlobClass = host?.Blob || globalThis.Blob;
  const urlApi = host?.URL || globalThis.URL;
  if (typeof BlobClass !== 'function' || typeof urlApi?.createObjectURL !== 'function') {
    throw new Error('verified object URL creation is unavailable');
  }
  const verified = await fetchVerifiedAsset(asset, options);
  const objectUrl = urlApi.createObjectURL(new BlobClass([verified.bytes], { type: verified.contentType }));
  return Object.freeze({
    ...verified,
    objectUrl,
    revoke: () => urlApi.revokeObjectURL?.(objectUrl),
  });
}
