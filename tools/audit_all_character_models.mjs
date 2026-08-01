#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HEROES } from '../shared/data/heroes.js';

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const baseUrl = value('base-url', 'http://127.0.0.1:8787').replace(/\/$/, '');
const width = value('width', '660'); const height = value('height', '660'); const timeout = value('timeout', '15000');
const repo = process.cwd(); const outRoot = join(repo, 'work', 'img2threejs');
await mkdir(outRoot, { recursive: true });

function runAudit(argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['tools/cdp_preview_audit.mjs', ...argv], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => { try { resolve({ code, result: JSON.parse(output.trim()) }); } catch { resolve({ code: code ?? 1, result: null }); } });
  });
}

const rows = [];
for (const hero of HEROES) {
  const id = hero.id; const dir = join(repo, 'client', 'img2threejs', id);
  const files = existsSync(dir) ? await (await import('node:fs/promises')).readdir(dir) : [];
  const sourceName = files.find((file) => /^create.+Model\.js$/.test(file));
  const preview = files.includes('preview.html');
  const rowDir = join(outRoot, id); await mkdir(rowDir, { recursive: true });
  const row = { hero: id, ok: false, contract: null, exceptions: 0, consoleErrors: 0, performance: null, budgets: null, output: `work/img2threejs/${id}/browser-audit.json`, screenshot: `work/img2threejs/${id}/audit-front.png` };
  if (!sourceName || !preview) { row.error = 'MODEL_SOURCE_OR_PREVIEW_MISSING'; rows.push(row); continue; }
  const source = await readFile(join(dir, sourceName), 'utf8');
  const match = source.match(/export\s+(?:async\s+)?function\s+(create[A-Za-z0-9]+PlayableHeroModel)\b|export\s+const\s+(create[A-Za-z0-9]+PlayableHeroModel)\b/);
  const factory = match?.[1] || match?.[2];
  if (!factory) { row.error = 'MODEL_FACTORY_NOT_FOUND'; rows.push(row); continue; }
  const url = `${baseUrl}/client/img2threejs/${id}/preview.html?capture=1&clean=1`;
  const result = await runAudit(['--url', url, '--hero', id, '--module', `/client/img2threejs/${id}/${sourceName}`, '--factory', factory, '--screenshot', row.screenshot, '--out', row.output, '--width', width, '--height', height, '--timeout', timeout]);
  const audit = result.result;
  if (audit) {
    const measured = audit.review?.metadata?.performance || null;
    row.ok = Boolean(audit.ok);
    row.contract = audit.review?.contract || null;
    row.exceptions = audit.exceptions?.length || 0;
    row.consoleErrors = (audit.console || []).filter((entry) => entry.type === 'error').length;
    row.performance = measured ? {
      triangles: measured.triangles,
      drawCalls: measured.drawCalls,
      textures: measured.textures,
    } : null;
    row.budgets = measured ? {
      triangles: measured.lod0TriangleBudget ?? null,
      drawCalls: measured.mobileDrawCallBudget ?? null,
    } : null;
  }
  else row.error = `AUDIT_PROCESS_FAILED:${result.code}`;
  rows.push(row);
}
const summary = { generatedAt: new Date().toISOString(), baseUrl, viewport: { width: Number(width), height: Number(height), timeout: Number(timeout) }, heroes: rows, ok: rows.length > 0 && rows.every((row) => row.ok) };
await writeFile(join(outRoot, 'browser-audit-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = summary.ok ? 0 : 1;
