import path from 'node:path';

function isInside(file, directory) {
  const prefix = directory.endsWith(path.sep) ? directory : directory + path.sep;
  return file.startsWith(prefix);
}

export function resolvePublicAsset(root, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(rawUrl || '/').split('?')[0]);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, '.' + pathname.replaceAll('/', path.sep));
  const clientRoot = path.resolve(resolvedRoot, 'client');
  const sharedRoot = path.resolve(resolvedRoot, 'shared');
  return isInside(resolved, clientRoot) || isInside(resolved, sharedRoot) ? resolved : null;
}

export function resolveVendorAddon(root, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(rawUrl || '').split('?')[0]);
  } catch {
    return null;
  }
  const prefix = '/vendor/addons/';
  if (!pathname.startsWith(prefix) || pathname.includes('\0') || !pathname.endsWith('.js')) return null;
  const addonRoot = path.resolve(root, 'node_modules/three/examples/jsm');
  const resolved = path.resolve(addonRoot, pathname.slice(prefix.length).replaceAll('/', path.sep));
  return isInside(resolved, addonRoot) ? resolved : null;
}

export function isInsideRoot(root, file) {
  return isInside(path.resolve(file), path.resolve(root));
}
