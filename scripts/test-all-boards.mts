// ---------------------------------------------------------------------------
// test-all-boards.mts — compile one TypeCAD program against every board in
// the Zephyr board data pack, reporting pass/fail per board.
//
//   npx tsx scripts/test-all-boards.mts ./src/main.ts [options]
//
// Modes:
//   default     transpile only (type-check + boardgen + C++ generation)
//   --compile   full west firmware build (minutes per board)
//
// A master harness project is scaffolded once under <out>/harness with the
// program placed at src/main.ts and its package.json rewired to the local
// workspace packages (file:). With --jobs N, the master is cloned into N
// worker harnesses (node_modules shared via a junction) and boards are run
// through a worker pool; each worker owns its clone exclusively, so config
// and build artifacts never race. Per board the script rewrites the config's
// `board:` and runs the real CLI — config load → ensureGeneratedBoard
// (boardgen) → type-check → transpile (→ west configure + build).
//
// Results stream into <out>/results.json after every board (so an
// interrupted run resumes with --resume), and full CLI output for every
// board lands in <out>/logs/<target>.log.
//
// Compile mode deletes each board's src/out build tree after its verdict to
// bound disk usage (--keep-output preserves the last build per worker).
//
// Note: the program is type-checked against each board's generated module
// as-is. A program importing `LED` fails on boards with no LED fact — that
// is signal, not noise. Use --boards/--filter/--only-pass to slice.
// ---------------------------------------------------------------------------

import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

// ── CLI ─────────────────────────────────────────────────────────────────────

interface Options {
  file: string;
  out: string;
  compile: boolean;
  boards: string[];
  filter?: RegExp;
  limit?: number;
  onlyPass?: string;
  random?: number;
  seed?: number;
  resume: boolean;
  retryFailed: boolean;
  jobs: number;
  timeoutSec: number;
  keepOutput: boolean;
  fresh: boolean;
  quiet: boolean;
}

function usage(): never {
  console.log(`Usage: npx tsx scripts/test-all-boards.mts <program.ts> [options]

  Tests one TypeCAD program against every board in the machine-local board
  catalog (generated from the installed SDK's Zephyr tree), reporting
  pass/fail per board.

Options:
  --compile              Full west firmware build per board (default: transpile only)
  --jobs <n>             Parallel board builds (default: compile = cores/3 capped 8,
                         transpile = cores-2 capped 16). Per-build ninja jobs are
                         capped so workers × jobs ≈ cores.
  --random <n>           Sample n random boards from the pool (after other filters).
                         Composes with --compile / transpile. Use --seed to rerun
                         the exact same sample.
  --seed <n>             Seed for --random (default: random each run).
  --boards <list>        Comma-separated board targets/substrings to test (default: all)
  --filter <regex>       Test only targets matching a regex
  --only-pass <file>     Test only targets recorded 'pass' in a previous results.json
  --limit <n>            Stop after n boards
  --out <dir>            Harness + results directory (default: ./board-test-run)
  --resume               Skip boards already recorded in <out>/results.json
  --retry-failed         With --resume, rerun previously failed boards
  --timeout <seconds>    Per-board timeout (default: 180 transpile, 1200 compile)
  --keep-output          Keep each board's src/out build tree (disk-heavy)
  --fresh                Discard previous results and rebuild the harness
  --quiet                Only print failures and the summary`);
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const [file = '', ...rest] = argv;
  if (!file || file.startsWith('--') || rest.includes('--help')) usage();
  const cores = process.env.NUMBER_OF_PROCESSORS ? Number(process.env.NUMBER_OF_PROCESSORS) : 4;
  const opt: Options = {
    file: resolve(file),
    out: resolve('board-test-run'),
    compile: false,
    boards: [],
    resume: false,
    retryFailed: false,
    jobs: 0, // 0 = mode-dependent default, resolved after flag parsing
    timeoutSec: 0,
    keepOutput: false,
    fresh: false,
    quiet: false,
  };
  const get = (flag: string): string => {
    const i = rest.indexOf(flag);
    if (i === -1 || i + 1 >= rest.length) missing(flag);
    return rest[i + 1]!;
  };
  for (let i = 0; i < rest.length; i++) {
    switch (rest[i]) {
      case '--compile': opt.compile = true; break;
      case '--jobs': opt.jobs = Math.max(1, Number(get('--jobs'))); break;
      case '--boards': opt.boards = get('--boards').split(',').map(s => s.trim()).filter(Boolean); break;
      case '--filter': opt.filter = new RegExp(get('--filter')); break;
      case '--only-pass': opt.onlyPass = resolve(get('--only-pass')); break;
      case '--random': opt.random = Math.max(1, Number(get('--random'))); break;
      case '--seed': opt.seed = Number(get('--seed')); break;
      case '--limit': opt.limit = Number(get('--limit')); break;
      case '--out': opt.out = resolve(get('--out')); break;
      case '--resume': opt.resume = true; break;
      case '--retry-failed': opt.retryFailed = true; break;
      case '--timeout': opt.timeoutSec = Number(get('--timeout')); break;
      case '--keep-output': opt.keepOutput = true; break;
      case '--fresh': opt.fresh = true; break;
      case '--quiet': opt.quiet = true; break;
      default: break; // values consumed by get()
    }
  }
  // Default worker counts by mode. Compile-mode workers each run a west build
  // whose ninja also spawns compiler jobs (capped per build below), so fewer
  // workers; transpile is single-core per board and RAM-light, so many.
  if (!opt.jobs) {
    opt.jobs = opt.compile
      ? Math.max(2, Math.min(8, Math.floor(cores / 3)))
      : Math.max(2, Math.min(16, cores - 2));
  }
  if (!opt.timeoutSec) opt.timeoutSec = opt.compile ? 1200 : 180;
  return opt;
}

function missing(flag: string): never {
  console.error(`Missing value for ${flag}`);
  process.exit(2);
}

// ── Board catalog ───────────────────────────────────────────────────────────
//
// The catalog is machine-local — generated from the installed SDK's Zephyr
// tree into <workspace>/.cuttlefish/board-catalog.json. There is no
// compiled-in pack. ensureFreshBoardCatalog() walks the tree only when its
// provenance (VERSION / git HEAD / boards-mtime / extraction revision)
// moved past the overlay, so repeated runs ride a handful of stat calls.

import {
  activeBoardCatalog,
  ensureFreshBoardCatalog,
  loadBoardCatalogOverlay,
} from '../packages/cuttlefish/src/board-catalog/store';
import type { BoardDataEntry } from '../packages/cuttlefish/src/board-catalog/types';

interface ResolvedCatalog {
  boards: Record<string, BoardDataEntry>;
  zephyrBase: string;
  zephyrVersion: string | null;
  status: 'fresh' | 'synced';
}

let CATALOG: Record<string, BoardDataEntry> = {};
let CATALOG_INFO: ResolvedCatalog | undefined;

/** Resolve the machine-local catalog, creating/refreshing the overlay when
 *  the tree moved. Exits with actionable guidance when there is no tree. */
function resolveCatalog(): void {
  const ensure = ensureFreshBoardCatalog();
  if (ensure.status === 'no-tree') {
    console.error(
      'No Zephyr tree found for the board catalog. Install one via the\n' +
      'zephyr-installer, or point an existing checkout at the tool:\n' +
      '  cuttlefish board sync <path-to-zephyr>',
    );
    process.exit(1);
  }
  if (ensure.status === 'no-overlay') {
    console.error(`No board catalog overlay at ${ensure.overlayPath}. Run: cuttlefish board sync`);
    process.exit(1);
  }
  const boards = activeBoardCatalog();
  if (Object.keys(boards).length === 0) {
    console.error('The board catalog resolved to zero boards — re-run: cuttlefish board sync');
    process.exit(1);
  }
  CATALOG = boards;
  CATALOG_INFO = {
    boards,
    zephyrBase: ensure.zephyrBase,
    zephyrVersion: loadBoardCatalogOverlay()?.provenance.version ?? null,
    status: ensure.status,
  };
}

// ── Process helpers ─────────────────────────────────────────────────────────

const REPO = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const CLI = join(REPO, 'packages', 'cuttlefish', 'dist', 'cli.js');
const HARNESS_NAME = 'harness';

// ── Build caches ────────────────────────────────────────────────────────────
//
// ccache is the one build cache that measurably helps here. Zephyr
// auto-uses ccache as compiler launcher when it is on PATH (it is, in the
// micromamba env); kernel/driver objects are near-identical between
// rebuilds of the SAME board, so retries and resumed sweeps recompile in a
// fraction of the time. Cross-board hits are modest (~8-15%: every board's
// autoconf.h differs), so first-time families still pay full price.
//
// Measured and rejected: Node 22's NODE_COMPILE_CACHE made CLI startup
// ~20% SLOWER (bytecode validation cost > parse savings — startup is
// dominated by module resolution, not compilation). Do not re-add it
// without re-measuring.
//
// Defaults only — an explicitly exported variable wins.

const CACHE_ROOT = process.env.TYPECAD_CACHE_ROOT ?? join(homedir(), '.typecad', 'cache');

function primeBuildCacheEnv(): { ccacheDir: string } {
  const ccacheDir = join(CACHE_ROOT, 'ccache');
  process.env.CCACHE_DIR ??= ccacheDir;
  process.env.CCACHE_MAXSIZE ??= '20G';
  process.env.CCACHE_NOHASHDIR ??= '1';
  mkdirSync(process.env.CCACHE_DIR, { recursive: true });
  return { ccacheDir: process.env.CCACHE_DIR };
}

interface SyncResult { code: number | null; timedOut: boolean; output: string }

function spawnSyncWrapped(cmd: string, args: string[], opts: { cwd: string; timeoutSec?: number; shellOnWindows?: boolean }): SyncResult {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: 'pipe',
    timeout: opts.timeoutSec ? opts.timeoutSec * 1000 : undefined,
    shell: opts.shellOnWindows === true && process.platform === 'win32',
    encoding: 'utf8',
  });
  return {
    code: result.status,
    timedOut: result.status === null && (result.signal !== null || result.error != null),
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

interface AsyncResult extends SyncResult { }

/** Promise wrapper over spawn with a hard timeout. */
function spawnAsync(cmd: string, args: string[], opts: { cwd: string; timeoutSec?: number; extraEnv?: Record<string, string> }): Promise<AsyncResult> {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.extraEnv ? { ...process.env, ...opts.extraEnv } : process.env,
    });
    let out = '';
    let timedOut = false;
    const timer = opts.timeoutSec
      ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, opts.timeoutSec * 1000)
      : undefined;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolveP({ code: null, timedOut: false, output: out + String(err) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolveP({ code, timedOut, output: out });
    });
  });
}

// ── Harness ─────────────────────────────────────────────────────────────────

/** Scaffold the master harness project once, place the program, wire local deps. */
function initMasterHarness(opts: Options): string {
  const master = join(opts.out, HARNESS_NAME);
  if (opts.fresh) rmSync(master, { recursive: true, force: true });
  if (!existsSync(join(master, 'package.json'))) {
    mkdirSync(opts.out, { recursive: true });
    const firstBoard = Object.keys(CATALOG)[0]!;
    console.log(`Scaffolding harness in ${master} (placeholder board ${firstBoard})…`);
    const created = spawnSyncWrapped(process.execPath, [CLI, 'create', HARNESS_NAME, '--target', firstBoard, '--framework', 'zephyr', '--no-starter', '--out-dir', master], { cwd: opts.out, timeoutSec: 300 });
    if (created.code !== 0) {
      console.error(`cuttlefish create failed:\n${created.output.slice(-2000)}`);
      process.exit(1);
    }
  }
  // The program under test.
  copyFileSync(opts.file, join(master, 'src', 'main.ts'));
  // Local workspace packages (the npm-published alphas lag the workspace).
  // file: paths are computed from the harness's real location, forward-slash
  // separated so npm accepts them on every platform.
  const toRepo = relative(master, REPO).split('\\').join('/');
  const pkgPath = join(master, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const rewired = JSON.stringify({
    ...pkg,
    dependencies: {
      ...pkg.dependencies,
      '@typecad/cuttlefish': `file:${toRepo}/packages/cuttlefish`,
      '@typecad/hal': `file:${toRepo}/packages/hal`,
      '@typecad/framework-zephyr': `file:${toRepo}/packages/framework-zephyr`,
    },
    devDependencies: {
      ...pkg.devDependencies,
      '@typecad/expect': `file:${toRepo}/packages/expect`,
      '@typecad/simulator': `file:${toRepo}/packages/simulator`,
    },
  }, null, 2) + '\n';
  if (readFileSync(pkgPath, 'utf8') !== rewired) {
    writeFileSync(pkgPath, rewired);
    console.log('Installing harness dependencies (npm install)…');
    const installed = spawnSyncWrapped('npm', ['install'], { cwd: master, timeoutSec: 600, shellOnWindows: true });
    if (installed.code !== 0) {
      console.error(`npm install failed:\n${installed.output.slice(-2000)}`);
      process.exit(1);
    }
  }
  if (!existsSync(join(master, 'node_modules', '@typecad', 'framework-zephyr'))) {
    console.error('Harness node_modules missing @typecad/framework-zephyr — run once with --fresh');
    process.exit(1);
  }
  return master;
}

const CLONE_SKIP = new Set(['node_modules', '.git', '.vscode']);

/** Recursively copy the harness skeleton (everything but node_modules etc.). */
function copySkeleton(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (CLONE_SKIP.has(entry)) continue;
    const s = join(src, entry);
    const d = join(dest, entry);
    if (entry === 'src') {
      // The program itself — never a stale build tree.
      mkdirSync(d, { recursive: true });
      copyFileSync(join(s, 'main.ts'), join(d, 'main.ts'));
      continue;
    }
    cpSync(s, d, { recursive: true });
  }
}

/**
 * Per-worker harness clone. node_modules is shared with the master through a
 * junction (Windows, no admin) or a directory symlink — the build only reads
 * it. Falls back to a full copy if the platform refuses links.
 */
function cloneHarness(master: string, slot: number): string {
  const dest = join(master + `-w${slot}`);
  rmSync(dest, { recursive: true, force: true });
  copySkeleton(master, dest);
  const nm = join(master, 'node_modules');
  try {
    symlinkSync(nm, join(dest, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    cpSync(nm, join(dest, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  }
  return dest;
}

// ── Per-board run ───────────────────────────────────────────────────────────

interface BoardResult {
  target: string;
  status: 'pass' | 'fail' | 'timeout';
  seconds: number;
  firstError?: string;
  log?: string;
}

const safeName = (target: string) => target.replace(/[^a-z0-9._-]/gi, '_');

function configFor(target: string): string {
  const entry = CATALOG[target]!;
  const probe = entry.probeMethods?.[0]?.id ?? 'openocd';
  return `// Generated by scripts/test-all-boards.mts — board: ${target}
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  board: '${target}',
  framework: '@typecad/framework-zephyr',
  output: { outDir: './out' },
  zephyr: { probe: '${probe}' },
  console: { baudRate: 115200, port: 'COM4' },
  test: { port: 'COM4' },
};

export default config;
`;
}

async function runBoard(harness: string, opts: Options, target: string, perBuildJobs?: number): Promise<BoardResult> {
  const started = Date.now();
  writeFileSync(join(harness, 'cuttlefish.config.ts'), configFor(target));
  // Compile-mode west builds must not reuse a configured build dir from the
  // previous board (west re-configure across a BOARD change is not reliable).
  rmSync(join(harness, 'src', 'out'), { recursive: true, force: true });
  // Stale boardgen output: the config-loader regenerates on identifier
  // mismatch, but a fresh directory makes every run independent.
  rmSync(join(harness, '.cuttlefish', 'board.json'), { force: true });
  rmSync(join(harness, '.cuttlefish', 'board.ts'), { force: true });

  const args = ['build'];
  if (opts.compile) args.push('--compile');
  // Cap the ninja fan-out of each concurrent build so jobs workers × N build
  // jobs ≈ cores (west build → cmake --build honors this env var), instead of
  // every build defaulting to the full core count and thrashing.
  const extraEnv = opts.compile && perBuildJobs
    ? { CMAKE_BUILD_PARALLEL_LEVEL: String(perBuildJobs) }
    : undefined;
  const run = await spawnAsync(process.execPath, [CLI, ...args], { cwd: harness, timeoutSec: opts.timeoutSec, extraEnv });
  const seconds = (Date.now() - started) / 1000;
  if (opts.compile && !opts.keepOutput) {
    // Bound disk: a finished board's build tree is not needed (the log is).
    rmSync(join(harness, 'src', 'out'), { recursive: true, force: true });
  }
  const logPath = join(opts.out, 'logs', `${safeName(target)}.log`);
  mkdirSync(join(opts.out, 'logs'), { recursive: true });
  writeFileSync(logPath, run.output);

  const status: BoardResult['status'] = run.timedOut ? 'timeout' : run.code === 0 ? 'pass' : 'fail';
  const result: BoardResult = { target, status, seconds, log: logPath };
  if (status !== 'pass') {
    const lines = run.output.split('\n').map(l => l.trim());
    const errLine =
      lines.find(l => /error:/i.test(l) && !l.startsWith('>')) ??
      lines.find(l => /error|✗|was not declared|Cannot find|Cannot redeclare/i.test(l) && !l.startsWith('>'));
    if (errLine) result.firstError = errLine.slice(0, 300);
  }
  return result;
}

// ── Main ────────────────────────────────────────────────────────────────────

/** Small seeded PRNG (mulberry32) — reproducible random board sampling. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.file)) {
    console.error(`Program not found: ${opts.file}`);
    process.exit(1);
  }
  if (!existsSync(CLI)) {
    console.error(`CLI not built — run: npm run build --workspace @typecad/cuttlefish`);
    process.exit(1);
  }

  resolveCatalog();
  const catalogBoards = Object.keys(CATALOG).length;
  const info = CATALOG_INFO!;
  const caches = primeBuildCacheEnv();
  const cores = process.env.NUMBER_OF_PROCESSORS ? Number(process.env.NUMBER_OF_PROCESSORS) : 4;
  // Ninja fan-out per concurrent build: workers × per-build ≈ cores.
  const perBuildJobs = opts.compile ? Math.max(1, Math.floor(cores / opts.jobs)) : undefined;
  // Zephyr sources live under the workspace — keep ccache's recorded paths
  // relative to it so hits transfer across per-board build directories.
  process.env.CCACHE_BASEDIR ??= resolve(info.zephyrBase, '..');

  let targets = Object.keys(CATALOG);
  if (opts.onlyPass) {
    const prior = JSON.parse(readFileSync(opts.onlyPass, 'utf8')) as { results?: BoardResult[] };
    const passing = new Set((prior.results ?? []).filter(r => r.status === 'pass').map(r => r.target));
    targets = targets.filter(t => passing.has(t));
    console.log(`--only-pass: ${passing.size} passing boards in ${opts.onlyPass}`);
  }
  if (opts.boards.length > 0) {
    targets = targets.filter(t => opts.boards.some(b => t === b || t.includes(b)));
  }
  if (opts.filter) targets = targets.filter(t => opts.filter!.test(t));
  if (opts.limit) targets = targets.slice(0, opts.limit);

  // --random: uniform sample without replacement from the scoped pool.
  // Seeded (--seed) so a selection is reproducible; results.json records
  // the seed used so the exact run can be re-created.
  let usedSeed: number | undefined;
  if (opts.random) {
    usedSeed = opts.seed ?? (Date.now() ^ Math.floor(Math.random() * 0xffffffff));
    const rand = mulberry32(usedSeed);
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [targets[i], targets[j]] = [targets[j]!, targets[i]!];
    }
    const sampled = targets.slice(0, Math.min(opts.random, targets.length));
    const preview = sampled.length <= 15
      ? sampled.join(', ')
      : `${sampled.slice(0, 8).join(', ')} … +${sampled.length - 8} more`;
    console.log(`--random: sampled ${sampled.length} of ${targets.length} boards (seed ${usedSeed}): ${preview}`);
    targets = sampled;
  }

  mkdirSync(opts.out, { recursive: true });
  const resultsPath = join(opts.out, 'results.json');
  const results: BoardResult[] = [];
  let priorResults: BoardResult[] = [];
  if (opts.resume && existsSync(resultsPath)) {
    const parsed = JSON.parse(readFileSync(resultsPath, 'utf8')) as { results?: BoardResult[] };
    priorResults = parsed.results ?? [];
    for (const r of priorResults) {
      if (r.status === 'pass' || !(opts.retryFailed && r.status !== 'pass')) results.push(r);
    }
  }
  const done = new Set(results.map(r => r.target));
  const pending = targets.filter(t => !done.has(t));
  // With --retry-failed, non-pass entries this run will NOT revisit (outside
  // the current --boards/--only-pass slice) keep their recorded state —
  // dropping them would erase history the file's consumers expect.
  if (opts.resume && opts.retryFailed) {
    const rescoped = new Set(pending);
    for (const r of priorResults) {
      if (r.status !== 'pass' && !rescoped.has(r.target) && !results.some(x => x.target === r.target)) {
        results.push(r);
      }
    }
  }

  console.log(`Program : ${opts.file}`);
  console.log(`Mode    : ${opts.compile ? `full west compile ×${opts.jobs} workers` : 'transpile only'}`);
  console.log(
    `Catalog : ${catalogBoards} boards from ${info.zephyrBase}` +
    `${info.zephyrVersion ? ` (zephyr ${info.zephyrVersion})` : ''} [${info.status}]`,
  );
  console.log(`Caches  : ccache ${caches.ccacheDir} (max ${process.env.CCACHE_MAXSIZE}, nohashdir — same-board reruns hit)`);
  if (opts.compile) console.log(`Ninja   : ${perBuildJobs} parallel jobs per build × ${opts.jobs} workers`);
  console.log(`Boards  : ${pending.length} to run (${results.length} already recorded), ${catalogBoards} in catalog`);
  console.log('');

  const master = initMasterHarness(opts);
  const t0 = Date.now();

  // Worker pool: each slot owns a harness clone exclusively, so per-board
  // config writes and build trees never race.
  const slots: string[] = [];
  for (let s = 0; s < opts.jobs; s++) {
    slots.push(s === 0 ? master : cloneHarness(master, s));
  }
  if (opts.jobs > 1) console.log(`Workers : ${slots.length} harnesses (${slots.slice(1).map((_, i) => `w${i + 1}`).join(' ')})`);

  let pass = 0, fail = 0, timeout = 0, completed = 0;
  let next = 0;

  async function worker(slotHarness: string): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= pending.length) return;
      const target = pending[i]!;
      const r = await runBoard(slotHarness, opts, target, perBuildJobs);
      results.push(r);
      completed++;
      if (r.status === 'pass') pass++; else if (r.status === 'timeout') timeout++; else fail++;
      writeFileSync(resultsPath, JSON.stringify({ file: opts.file, mode: opts.compile ? 'compile' : 'transpile', random: opts.random ? { n: opts.random, seed: usedSeed } : undefined, startedAt: new Date(t0).toISOString(), results }, null, 1));
      const mark = r.status === 'pass' ? 'PASS' : r.status === 'timeout' ? 'TIMEOUT' : 'FAIL';
      if (r.status === 'pass' && opts.quiet) continue;
      const err = r.firstError ? ` — ${r.firstError}` : '';
      console.log(`[${completed}/${pending.length}] ${mark} ${target} (${r.seconds.toFixed(1)}s)${err}`);
    }
  }
  await Promise.all(slots.map(w => worker(w)));

  const total = pass + fail + timeout;
  console.log('');
  console.log(`Done: ${pass} pass, ${fail} fail, ${timeout} timeout of ${total} run (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
  console.log(`Results: ${resultsPath}`);
  if (fail + timeout > 0) {
    console.log('Failed boards:');
    for (const r of results.filter(x => x.status !== 'pass' && pending.includes(x.target)).slice(0, 50)) {
      console.log(`  ${r.target} — ${r.firstError ?? r.status}`);
    }
  }
}

// Run only when invoked directly — importing the script must not start a sweep.
const invokedDirectly = !!process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
