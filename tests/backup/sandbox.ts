/**
 * Runs a repository script under tests/backup/sandbox-hook.cjs and returns
 * what it loaded and which network endpoints it contacted (emulator rehearsals).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const TSX = path.join(REPO, 'node_modules/tsx/dist/cli.mjs');
const HOOK = path.join(REPO, 'tests/backup/sandbox-hook.cjs');

export interface Observed {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Firebase / Google Cloud / gRPC modules loaded. */
  modules: string[];
  /** Outbound TCP connections (tsx's own parent–child pipe excluded). */
  connects: Array<{ host: string; port: number | null }>;
  dns: string[];
}

export function runObserved(script: string, args: string[], env: Record<string, string | undefined>, logDir: string): Observed {
  const log = path.join(logDir, `sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) if (v !== undefined) childEnv[k] = v;
  childEnv.NODE_OPTIONS = `--require ${HOOK}`;
  childEnv.SANDBOX_LOG = log;
  const r = spawnSync(process.execPath, [TSX, script, ...args], { cwd: REPO, env: childEnv as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 180_000 });
  const entries = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  fs.rmSync(log, { force: true });
  return {
    status: r.status, stdout: r.stdout, stderr: r.stderr,
    modules: entries.filter((e) => e.type === 'module').map((e) => e.request),
    connects: entries.filter((e) => e.type === 'connect' && !/^ipc:.*\/tsx-\d+\/\d+\.pipe$/.test(e.host)).map((e) => ({ host: e.host, port: e.port })),
    dns: entries.filter((e) => e.type === 'dns').map((e) => e.host),
  };
}
