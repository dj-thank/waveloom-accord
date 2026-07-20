import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production deploymentは固定イメージ・read-only・healthcheck・必須Originで起動する', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const compose = readFileSync(new URL('../compose.production.yml', import.meta.url), 'utf8');
  const caddy = readFileSync(new URL('../deploy/Caddyfile.example', import.meta.url), 'utf8');
  const caddyDockerfile = readFileSync(new URL('../deploy/Dockerfile.caddy', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../docs/DEPLOYMENT.md', import.meta.url), 'utf8');
  const dockerignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');

  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.equal(dockerfile.match(/FROM node:24-alpine@sha256:[0-9a-f]{64}/g)?.length, 2,
    'both image stages must pin the Node base image by digest');
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/,
    'npm must not remain in the runtime image');
  assert.doesNotMatch(dockerfile, /COPY --chown=node:node \. \./,
    'tests, tools, and release documents must not be copied into the runtime image');
  for (const runtimeDir of ['client', 'server', 'shared']) {
    assert.match(dockerfile, new RegExp(`COPY --chown=node:node ${runtimeDir} \\.\\/${runtimeDir}`),
      `${runtimeDir} must be copied explicitly into the runtime image`);
  }
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(compose, /KAGARIAI_PUBLIC_ORIGIN:\s*\$\{KAGARIAI_PUBLIC_ORIGIN:\?required\}/);
  assert.match(compose, /^name:\s*kagariai$/m,
    'the production project name must stay stable when a release manifest is moved');
  assert.equal(compose.match(/^\s{4}stop_grace_period:\s*15s\s*$/gm)?.length, 2,
    'both services need enough time to complete their own graceful shutdown');
  assert.match(compose, /image:\s*kagariai:\$\{KAGARIAI_IMAGE_TAG:\?required\}/,
    'production image tags must fail closed instead of deploying latest');
  assert.match(compose, /image:\s*kagariai-caddy:\$\{KAGARIAI_CADDY_IMAGE_TAG:\?required\}/,
    'the ingress image tag must be part of the immutable release unit');
  assert.match(dockerignore, /^\.env\.\*$/m,
    'environment secret files must never enter the Docker build context');
  assert.equal(compose.match(/^\s{4}read_only:\s*true\s*$/gm)?.length, 2,
    'application and Caddy services must both use a read-only root filesystem');
  assert.match(caddyDockerfile, /FROM caddy:2\.11\.4-alpine@sha256:[0-9a-f]{64}/,
    'the Caddy base image must be pinned by digest');
  assert.match(caddyDockerfile, /FROM golang:1\.26\.4-alpine@sha256:[0-9a-f]{64} AS builder/,
    'the patched Caddy binary must use a fixed Go toolchain image');
  assert.match(caddyDockerfile, /caddy\/v2\/cmd\/caddy@v2\.11\.4/);
  assert.match(caddyDockerfile, /COPY deploy\/Caddyfile\.example \/etc\/caddy\/Caddyfile/,
    'the ingress config must be immutable inside the versioned Caddy image');
  assert.match(caddyDockerfile, /CustomVersion=v2\.11\.4-kagariai-go1\.26\.4/);
  assert.match(caddyDockerfile, /apk del --no-cache curl/,
    'unused vulnerable curl packages must not remain in the ingress image');
  assert.match(caddyDockerfile, /setcap -r \/usr\/bin\/caddy/,
    'the high-port Caddy image must remove its unneeded file capability');
  assert.match(compose, /user:\s*"65534:65534"/,
    'the public ingress must not run as root');
  assert.match(compose, /KAGARIAI_HTTP_PORT:-80/);
  assert.match(compose, /KAGARIAI_HTTPS_PORT:-443/);
  assert.match(compose, /caddy_data:\/data/);
  assert.match(compose, /caddy_config:\/config/);
  assert.doesNotMatch(compose, /Caddyfile\.example:/,
    'production must not bind the current working-tree ingress config');
  assert.match(compose, /name:\s*\$\{KAGARIAI_CADDY_DATA_VOLUME:\?required\}/);
  assert.match(compose, /name:\s*\$\{KAGARIAI_CADDY_CONFIG_VOLUME:\?required\}/);
  assert.doesNotMatch(compose, /cap_add:/,
    'high internal ports must avoid granting bind-service capability');
  assert.match(caddy, /http_port\s+8080/);
  assert.match(caddy, /https_port\s+8443/);
  assert.match(caddy, /reverse_proxy\s+kagariai:8787/);
  assert.match(guide, /KAGARIAI_PUBLIC_ORIGIN/);
  assert.match(guide, /ロールバック/);
});
