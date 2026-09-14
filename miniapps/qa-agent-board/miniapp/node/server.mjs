// @ts-check
/**
 * qa-agent-board — Node runtime.
 *
 * Wraps the qa-agent CLI (prefers the global `qa-agent` shim on PATH; falls
 * back to `<pluginRoot>/../../../dist/cli.js` if the shim is missing) and
 * exposes a small JSON API for the Client UI. Talks to Azure DevOps REST
 * directly with AZURE_DEVOPS_PAT from the process environment; no
 * hostConnector provider is declared because none exists for ADO.
 *
 * Surface:
 *   GET  /dashboard                 → HTML UI
 *   GET  /api/health                → liveness + readiness
 *   GET  /api/config                → public config (cliSource, defaults)
 *   GET  /api/plans?org=&project=   → list ADO test plans
 *   GET  /api/plan?url=...          → fetch plan metadata + counts
 *   POST /api/runs                  → submit a Mode B audit run
 *   GET  /api/runs                  → list recent runs
 *   GET  /api/runs/:id              → run detail + log tail
 *   GET  /api/runs/:id/artifacts/:name → artifact file content
 *   DELETE /api/runs/:id            → remove a run
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** @typedef {import('./miniapp-api.js').MiniAppContext} MiniAppContext */
/** @typedef {import('./miniapp-api.js').MiniAppLifecycle} MiniAppLifecycle */

const API_VERSION = '7.2-preview';
const PAT = () => process.env.AZURE_DEVOPS_PAT ?? '';
const DEFAULT_ORG = process.env.ADO_ORG ?? 'd2odevops';
const DEFAULT_PROJECT = process.env.ADO_PROJECT ?? 'PMI';
const RUNS_DIRNAME = 'runs';
const RUN_LOG_LIMIT = 4000; // tail length returned to Client

/** In-memory run registry, hydrated from dataDir on startup. */
const runs = new Map();

/**
 * Resolve the qa-agent CLI command. Prefer the global `qa-agent` shim on PATH;
 * fall back to `<pluginRoot>/../../../dist/cli.js` (the workspace-local build)
 * if the shim is missing.
 *
 * @returns {{ command: string|null, prefix: string[], source: string }}
 */
function resolveCli(pluginRoot) {
  try {
    const probe = spawnSync('qa-agent', ['--version'], { stdio: 'ignore' });
    if (probe.status === 0) return { command: 'qa-agent', prefix: [], source: 'global-shim' };
  } catch { /* not on PATH */ }
  const local = resolve(pluginRoot, '..', '..', '..', 'dist', 'cli.js');
  if (existsSync(local)) {
    return { command: 'node', prefix: [local], source: `local:${local}` };
  }
  return { command: null, prefix: [], source: 'not-found' };
}


/**
 * @param {MiniAppContext} context
 * @returns {Promise<MiniAppLifecycle>}
 */
export async function start(context) {
  const runsDir = join(context.dataDir, RUNS_DIRNAME);
  await mkdir(runsDir, { recursive: true });
  await hydrateRuns(runsDir);

  const clientEntry = await readFile(join(context.pluginRoot, 'miniapp/client/index.html'));
  const cli = resolveCli(context.pluginRoot);
  context.logger.info('miniapp.cli.resolved', { source: cli.source, command: cli.command });
  const server = createServer(async (request, response) => {
    try {
      await route(request, response, {
        pluginRoot: context.pluginRoot,
        runsDir,
        cli,
        clientEntry,
        logger: context.logger,
        signal: context.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.logger.error('miniapp.runtime.route_error', { message });
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      response.end(JSON.stringify({ error: 'internal_error', message }));
    }
  });

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening', { port: context.listen.port });

  let disposed = false;
  /** @returns {Promise<void>} */
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    for (const run of runs.values()) {
      if (run.process && !run.process.killed) {
        try { run.process.kill('SIGTERM'); } catch { /* ignore */ }
      }
    }
    await close(server);
  };
  const onAbort = () => { void dispose(); };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

async function route(request, response, ctx) {
  const url = new URL(request.url ?? '/', 'http://miniapp.local');
  const path = url.pathname;

  if (request.method === 'GET' && path === '/dashboard') {
    respondText(response, 200, 'text/html; charset=utf-8', ctx.clientEntry);
    return;
  }
  if (request.method === 'GET' && path === '/api/health') {
    respondJson(response, 200, {
      status: 'ok',
      cliAvailable: ctx.cli.command !== null,
      cliSource: ctx.cli.source,
      patSet: PAT().length > 0,
      runCount: runs.size,
    });
    return;
  }
  if (request.method === 'GET' && path === '/api/config') {
    respondJson(response, 200, {
      cliAvailable: ctx.cli.command !== null,
      cliSource: ctx.cli.source,
      patSet: PAT().length > 0,
      defaultOrg: DEFAULT_ORG,
      defaultProject: DEFAULT_PROJECT,
      platforms: ['claude-code', 'dsh', 'gemini', 'minimax'],
    });
    return;
  }
  if (request.method === 'GET' && path === '/api/plans') {
    const org = url.searchParams.get('org') ?? DEFAULT_ORG;
    const project = url.searchParams.get('project') ?? DEFAULT_PROJECT;
    const plans = await listAdoPlans(org, project);
    respondJson(response, 200, { org, project, plans });
    return;
  }
  if (request.method === 'GET' && path === '/api/plan') {
    const planUrl = url.searchParams.get('url');
    if (!planUrl) { respondJson(response, 400, { error: 'missing_url' }); return; }
    const meta = await fetchPlanMetadata(planUrl);
    respondJson(response, 200, meta);
    return;
  }
  if (request.method === 'GET' && path === '/api/runs') {
    respondJson(response, 200, { runs: listRuns() });
    return;
  }

  const runMatch = path.match(/^\/api\/runs\/([^/]+)(?:\/artifacts\/([^/]+))?$/);
  if (runMatch) {
    const [, runId, artifact] = runMatch;
    if (artifact) {
      if (request.method !== 'GET') { respondJson(response, 405, { error: 'method_not_allowed' }); return; }
      await serveArtifact(response, ctx.runsDir, runId, artifact);
      return;
    }
    if (request.method === 'GET') {
      respondJson(response, 200, describeRun(runId));
      return;
    }
    if (request.method === 'DELETE') {
      await deleteRun(response, ctx.runsDir, runId);
      return;
    }
    respondJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  if (request.method === 'POST' && path === '/api/runs') {
    const body = await readJson(request);
    const result = await submitRun(body, ctx);
    respondJson(response, 202, result);
    return;
  }

  respondJson(response, 404, { error: 'not_found', path });
}

// ─── ADO REST ────────────────────────────────────────────────────────────────

function adoBase(org, project) {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}`;
}

function adoAuthHeader() {
  return `Basic ${Buffer.from(`:${PAT()}`).toString('base64')}`;
}

async function adoFetch(org, project, path) {
  const pat = PAT();
  if (!pat) throw new HttpError(503, 'pat_missing', 'AZURE_DEVOPS_PAT is not set in the Mini App process environment.');
  const url = `${adoBase(org, project)}${path}${path.includes('?') ? '&' : '?'}api-version=${API_VERSION}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: adoAuthHeader(),
      Accept: 'application/json',
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new HttpError(resp.status, 'ado_error', `ADO ${resp.status}: ${body.slice(0, 500)}`);
  }
  return /** @type {any} */ (await resp.json());
}

async function listAdoPlans(org, project) {
  // Test plans API: /_apis/testplan/plans
  const data = await adoFetch(org, project, '/_apis/testplan/plans');
  const value = Array.isArray(data?.value) ? data.value : [];
  return value.map((p) => ({
    id: p.id,
    name: p.name ?? `Plan ${p.id}`,
    state: p.state ?? 'unknown',
    rootSuiteId: p.rootSuite?.id ?? null,
  })).sort((a, b) => Number(b.id) - Number(a.id));
}

async function fetchPlanMetadata(planUrl) {
  const parsed = parsePlanUrl(planUrl);
  if (!parsed) throw new HttpError(400, 'bad_plan_url', 'Could not parse the plan URL.');
  const plan = await adoFetch(parsed.org, parsed.project, `/_apis/testplan/plans/${parsed.planId}`);
  const suites = await adoFetch(parsed.org, parsed.project, `/_apis/testplan/plans/${parsed.planId}/suites`);
  let caseCount = 0;
  for (const suite of (Array.isArray(suites?.value) ? suites.value : [])) {
    try {
      const cases = await adoFetch(parsed.org, parsed.project, `/_apis/testplan/plans/${parsed.planId}/suites/${suite.id}/TestCase`);
      caseCount += Array.isArray(cases?.value) ? cases.value.length : 0;
    } catch { /* skip suite on failure, keep going */ }
  }
  return {
    org: parsed.org,
    project: parsed.project,
    planId: parsed.planId,
    name: plan?.name ?? `Plan ${parsed.planId}`,
    state: plan?.state ?? 'unknown',
    suiteCount: Array.isArray(suites?.value) ? suites.value.length : 0,
    caseCount,
  };
}

function parsePlanUrl(url) {
  const m = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_testPlans\/\w+\?planId=(\d+)/);
  if (!m) return null;
  return { org: m[1], project: m[2], planId: Number(m[3]) };
}

// ─── Run lifecycle ────────────────────────────────────────────────────────────

async function hydrateRuns(runsDir) {
  let entries;
  try { entries = await readdir(runsDir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readJsonSafe(join(runsDir, entry.name, 'meta.json'));
    if (!meta) continue;
    if (meta.status === 'running') meta.status = 'orphaned'; // no live process anymore
    runs.set(entry.name, { id: entry.name, ...meta, process: null });
  }
}

function listRuns() {
  return Array.from(runs.values())
    .map((r) => ({
      id: r.id,
      planUrl: r.planUrl,
      workItem: r.workItem ?? null,
      platform: r.platform,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      exitCode: r.exitCode ?? null,
      outDir: r.outDir,
    }))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

function describeRun(runId) {
  const run = runs.get(runId);
  if (!run) return { error: 'not_found', runId };
  return {
    id: run.id,
    planUrl: run.planUrl,
    workItem: run.workItem ?? null,
    platform: run.platform,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    exitCode: run.exitCode ?? null,
    outDir: run.outDir,
    artifacts: run.artifacts ?? [],
    logTail: (run.logTail ?? '').slice(-RUN_LOG_LIMIT),
  };
}

async function submitRun(body, ctx) {
  if (!ctx.cli.command) {
    throw new HttpError(503, 'cli_missing',
      `qa-agent CLI not available. Source: ${ctx.cli.source}. ` +
      `Install globally with \`npm install -g qa-agent\` or build the workspace-local CLI (npm run build).`);
  }
  const planUrl = String(body?.planUrl ?? '').trim();
  if (!planUrl) throw new HttpError(400, 'missing_plan_url', 'planUrl is required.');
  const parsed = parsePlanUrl(planUrl);
  if (!parsed) throw new HttpError(400, 'bad_plan_url', 'planUrl must look like https://dev.azure.com/{org}/{project}/_testPlans/execute?planId={id}');

  const platform = String(body?.platform ?? 'claude-code');
  const workItem = body?.workItem != null ? String(body.workItem) : '';
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const outDir = join(ctx.runsDir, runId);
  await mkdir(outDir, { recursive: true });

  const args = [
    ...ctx.cli.prefix,
    'run',
    '--plan-url', planUrl,
    '--platform', platform,
    '--outDir', outDir,
  ];
  if (workItem) args.push('--work-item', workItem);

  const logPath = join(outDir, 'log.txt');
  const startedAt = new Date().toISOString();

  const child = spawn(ctx.cli.command, args, {
    cwd: ctx.pluginRoot,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  /** @type {string[]} */
  const logChunks = [];
  child.stdout.on('data', (d) => { logChunks.push(d.toString()); writeAppend(logPath, d); });
  child.stderr.on('data', (d) => { logChunks.push(d.toString()); writeAppend(logPath, d); });

  const meta = {
    planUrl,
    workItem: workItem || null,
    platform,
    cliCommand: ctx.cli.command,
    cliArgs: args,
    cliSource: ctx.cli.source,
    status: 'running',
    startedAt,
    finishedAt: null,
    exitCode: null,
    outDir,
    artifacts: [],
    logPath,
  };
  await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  runs.set(runId, { id: runId, ...meta, process: child, logTail: '' });

  child.on('close', async (code) => {
    const run = runs.get(runId);
    if (!run) return;
    run.status = code === 0 ? 'completed' : 'failed';
    run.finishedAt = new Date().toISOString();
    run.exitCode = code;
    run.process = null;
    run.artifacts = await listArtifacts(outDir);
    run.logTail = logChunks.join('');
    const updated = { ...meta, status: run.status, finishedAt: run.finishedAt, exitCode: code, artifacts: run.artifacts };
    await writeFile(join(outDir, 'meta.json'), JSON.stringify(updated, null, 2));
  });

  return { runId, status: 'running', outDir, cliSource: ctx.cli.source, cliArgs: args.slice(args.indexOf('run')) };
}

async function deleteRun(response, runsDir, runId) {
  const run = runs.get(runId);
  if (!run) { respondJson(response, 404, { error: 'not_found', runId }); return; }
  if (run.process && !run.process.killed) {
    try { run.process.kill('SIGTERM'); } catch { /* ignore */ }
  }
  runs.delete(runId);
  await rm(join(runsDir, runId), { recursive: true, force: true });
  respondJson(response, 200, { deleted: runId });
}

async function serveArtifact(response, runsDir, runId, artifact) {
  const run = runs.get(runId);
  if (!run) { respondJson(response, 404, { error: 'not_found', runId }); return; }
  if (!isSafeArtifactName(artifact)) {
    respondJson(response, 400, { error: 'bad_artifact_name' });
    return;
  }
  const filePath = join(runsDir, runId, artifact);
  let info;
  try { info = await stat(filePath); }
  catch { respondJson(response, 404, { error: 'artifact_not_found', name: artifact }); return; }
  if (!info.isFile()) { respondJson(response, 404, { error: 'not_a_file', name: artifact }); return; }
  const content = await readFile(filePath, 'utf-8');
  respondText(response, 200, mimeForArtifact(artifact), content);
}

function isSafeArtifactName(name) {
  if (!name || name.length > 80) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function mimeForArtifact(name) {
  const ext = extname(name).toLowerCase();
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.txt' || ext === '.log') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

async function listArtifacts(outDir) {
  let entries;
  try { entries = await readdir(outDir, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === 'log.txt' || entry.name === 'meta.json') continue;
    out.push(entry.name);
  }
  return out.sort();
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function respondJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
function respondText(response, status, contentType, body) {
  response.writeHead(status, { 'content-type': contentType });
  response.end(body);
}

async function readJson(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    request.on('data', (d) => chunks.push(d));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new HttpError(400, 'bad_json', e instanceof Error ? e.message : String(e))); }
    });
    request.on('error', reject);
  });
}

async function readJsonSafe(path) {
  try { return JSON.parse(await readFile(path, 'utf-8')); }
  catch { return null; }
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function writeAppend(path, data) {
  // fire-and-forget; we don't want to block the child on log writes.
  // Errors here are non-fatal; the run will still complete.
  import('node:fs/promises').then((m) => m.appendFile(path, data).catch(() => undefined));
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
