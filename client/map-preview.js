import * as THREE from '/vendor/three.module.js';
import { buildMap } from '/shared/data/map_oshioi.js';
import { SceneRenderer } from '/client/render.js';

const canvas = document.getElementById('map');
const status = document.getElementById('status');
const calls = document.getElementById('calls');
const tris = document.getElementById('tris');
const instances = document.getElementById('instances');
const map = buildMap();
const renderer = new SceneRenderer(canvas, map);
renderer.setQualityProfile('high');

const flashpointSites = map.flashpoint?.sites || [];
const routeColors = {
  front: 0xf2b66d,
  cloister: 0x76e6df,
  shallows: 0x789bc7,
};

function siteCamera(site) {
  const [x, y] = site.center;
  // 被覆で建物が大きくなり、従来の (+22, -18, 12) では建物の内側に入っていた。
  // 拠点の外へ十分引き、上から見下ろす角度にして全体が入るようにする。
  const pos = [x + 46, y - 40, Math.max(26, site.center[2] + 24)];
  return {
    pos,
    yaw: Math.atan2(y - pos[1], x - pos[0]),
    pitch: -0.42,
  };
}

const presets = {
  spawn: { pos: [42, -2, 7.2], yaw: Math.PI, pitch: -0.04 },
  objective: { pos: [22, -14, 9.5], yaw: 2.58, pitch: -0.12 },
  cloister: { pos: [28, 21, 7.2], yaw: 2.95, pitch: -0.05 },
  shallows: { pos: [35, -23, 5.4], yaw: 2.72, pitch: -0.07 },
  aerial: { pos: [0, -36, 48], yaw: Math.PI / 2, pitch: -0.78 },
  network: { pos: [0, -150, 146], yaw: Math.PI / 2, pitch: -0.69 },
};
for (const site of flashpointSites) presets[`site-${site.id}`] = siteCamera(site);

function makeRouteLine(points, color, opacity) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point =>
    new THREE.Vector3(point[0], point[1], point[2] + 0.16)));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 25;
  return line;
}

function buildFlashpointReviewOverlay() {
  const root = new THREE.Group();
  root.name = 'flashpoint-review-overlay';
  root.userData.previewOnly = true;
  root.userData.siteGroups = {};
  for (const site of flashpointSites) {
    const group = new THREE.Group();
    group.name = `flashpoint-site-${site.id}`;
    group.userData.siteId = site.id;
    const color = site.identity?.navigationColor || 0x76e6df;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radiusM - 0.45, site.radiusM, 64),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    ring.position.set(site.center[0], site.center[1], site.center[2] + 0.1);
    ring.renderOrder = 24;
    group.add(ring);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 1.1, 38, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    beacon.rotation.x = Math.PI / 2;
    beacon.position.set(site.center[0], site.center[1], site.center[2] + 19);
    beacon.renderOrder = 23;
    group.add(beacon);
    for (const side of ['east', 'west']) {
      const routes = map.flashpoint?.runtime?.routesBySite?.[site.id]?.[side]
        || map.flashpoint?.routesBySite?.[site.id]?.[side]
        || {};
      for (const [lane, route] of Object.entries(routes)) {
        const line = makeRouteLine(route.points, routeColors[lane] || color, 0.7);
        line.userData.lane = lane;
        line.userData.side = side;
        group.add(line);
      }
    }
    root.userData.siteGroups[site.id] = group;
    root.add(group);
  }
  renderer.world.add(root);
  return root;
}

const flashpointOverlay = buildFlashpointReviewOverlay();

let mode = 'orbit';
let pose = { pos: [32, -24, 12], yaw: 2.5, pitch: -0.16 };
let orbitAngle = -0.68;
let orbitRadius = 41;
let dragging = false;
let pointer = null;
let lastFrame = performance.now();

function setMode(next) {
  mode = next;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === mode));
  }
  if (presets[next]) pose = structuredClone(presets[next]);
  const selectedSiteId = next.startsWith('site-') ? next.slice(5) : null;
  flashpointOverlay.visible = next === 'network' || !!selectedSiteId;
  for (const [siteId, group] of Object.entries(flashpointOverlay.userData.siteGroups)) {
    group.visible = next === 'network' || siteId === selectedSiteId;
    for (const child of group.children) {
      if (child.isLine && child.material) child.material.opacity = next === 'network' ? 0.2 : 0.76;
    }
  }
}

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => setMode(button.dataset.view));
}
const requestedView = new URLSearchParams(location.search).get('view');
if (requestedView === 'orbit' || presets[requestedView]) setMode(requestedView);
else setMode('orbit');

canvas.addEventListener('pointerdown', event => {
  dragging = true;
  pointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  if (mode === 'orbit') mode = 'free';
});
canvas.addEventListener('pointermove', event => {
  if (!dragging || !pointer) return;
  pose.yaw -= (event.clientX - pointer.x) * 0.0045;
  pose.pitch = Math.max(-1.25, Math.min(0.45, pose.pitch - (event.clientY - pointer.y) * 0.0035));
  pointer = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointerup', event => {
  dragging = false;
  pointer = null;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  const forward = [Math.cos(pose.yaw), Math.sin(pose.yaw)];
  const distance = Math.sign(event.deltaY) * Math.min(4, Math.abs(event.deltaY) * 0.012);
  pose.pos[0] -= forward[0] * distance;
  pose.pos[1] -= forward[1] * distance;
}, { passive: false });

function updateMetrics() {
  const info = renderer.renderer.info?.render;
  calls.textContent = String(info?.calls ?? '—');
  tris.textContent = Number(info?.triangles ?? 0).toLocaleString('ja-JP');
  instances.textContent = Number(renderer.originalMapPresentation?.userData?.instanceCount ?? 0)
    .toLocaleString('ja-JP');
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (mode === 'orbit') {
    orbitAngle += dt * 0.085;
    pose.pos[0] = Math.cos(orbitAngle) * orbitRadius;
    pose.pos[1] = Math.sin(orbitAngle) * orbitRadius * 0.68;
    pose.pos[2] = 14.5 + Math.sin(orbitAngle * 0.7) * 2;
    pose.yaw = orbitAngle + Math.PI;
    pose.pitch = -0.18;
  }
  renderer.update(dt);
  renderer.render(pose);
  updateMetrics();
  requestAnimationFrame(frame);
}

const original = renderer.originalMapPresentation;
status.textContent = original
  ? `${map.displayName} / ${original.userData.instanceCount} original instances`
  : `${map.displayName} / presentation fallback`;
document.documentElement.dataset.mapPresentation = original ? 'ready' : 'fallback';
window.__KAGARIAI_MAP_PREVIEW__ = Object.freeze({
  mapId: map.id,
  presentationId: map.presentation?.id,
  flashpointId: map.flashpoint?.id || null,
  siteCount: flashpointSites.length,
  sites: flashpointSites.map(site => ({
    id: site.id,
    center: [...site.center],
    displayName: site.displayName,
  })),
  instanceCount: original?.userData?.instanceCount ?? 0,
  layerCount: original?.children?.length ?? 0,
  get performance() { return renderer.getPerformanceSnapshot(); },
  setView: setMode,
});
requestAnimationFrame(frame);
