// ---------------------------------------------------------------------------
// debug-config.ts — VS Code / GDB debug artifact generation for `--debug`
//
// After a successful gdb-mode build, writes the artifacts that let the user
// press F5 in VS Code and attach GDB to the running Zephyr target.
//
// Uses the cortex-debug extension (NOT the ESP-IDF gdbtarget adapter) so the
// debug session is self-contained.  cortex-debug starts OpenOCD as a child
// process via `servertype: "openocd"`; the preLaunch task handles only the
// build + flash step.  After attach we issue `monitor reset init`, set a
// temporary hardware breakpoint at setup(), and continue — this ensures the
// breakpoint is deferred until the bootloader maps the app flash region.
//
// All generators are deterministic + idempotent so toggling --debug does not
// churn the tree.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { ZephyrStrategy } from '../strategy.js';

export interface DebugConfigOptions {
  /** Absolute path to the Zephyr project root (contains CMakeLists.txt + src/). */
  projectRoot: string;
  /** Absolute path to the workspace root (the cuttlefish config dir — the folder VS Code has open). */
  workspaceRoot: string;
  /** The Zephyr app dir relative to the workspace root (e.g. 'src/out'). */
  sketchRel: string;
  /** The Zephyr board id (e.g. 'esp32s3_devkitc'). */
  target: string;
  /** Absolute path to the Zephyr build dir (<projectRoot>/build) — read for the SDK/GDB path. */
  buildDir: string;
  /** Absolute path to the emitted source map (*.thcppmap.json), if any. */
  sourceMapPath?: string;
}

/**
 * Resolve the GDB binary path for the target from the build cache, falling
 * back to a filesystem scan of known Zephyr SDK locations when no build
 * exists yet (the create-time starter artifacts path). Zephyr records
 * ZEPHYR_SDK_INSTALL_DIR in CMakeCache.txt at configure time, and the
 * xtensa GDB lives at <sdk>/xtensa-espressif_esp32s3_zephyr-elf/bin/... (note
 * the Zephyr-SDK naming, distinct from the ESP-IDF xtensa-esp32s3-elf-gdb).
 *
 * Returns the absolute gdb path on success, or undefined (the launch.json then
 * omits gdbPath and relies on Cortex-Debug's default resolution).
 */
export function resolveGdbPath(buildDir: string, target: string): string | undefined {
  void target; // toolchain dir is esp32s3-specific today; see gdbPathFromSdkRoot
  const cachePath = join(buildDir, 'CMakeCache.txt');
  if (existsSync(cachePath)) {
    try {
      const cache = readFileSync(cachePath, 'utf-8');
      const m = cache.match(/^ZEPHYR_SDK_INSTALL_DIR:PATH=(.+)$/m);
      if (m) {
        const fromCache = gdbPathFromSdkRoot(m[1].trim());
        if (fromCache) return fromCache;
      }
    } catch {
      // unreadable cache — fall through to the SDK scan
    }
  }
  // No build dir yet (project just created): probe known SDK locations.
  for (const sdkRoot of discoverZephyrSdkRoots()) {
    const p = gdbPathFromSdkRoot(sdkRoot);
    if (p) return p;
  }
  return undefined;
}

/** The esp32s3 xtensa GDB location inside a Zephyr SDK root (verified against
 *  zephyr-sdk-0.17.4). Returns a forward-slash absolute path or undefined. */
export function gdbPathFromSdkRoot(sdkRoot: string): string | undefined {
  const gdbName = 'xtensa-espressif_esp32s3_zephyr-elf-gdb.exe';
  const gdbPath = join(sdkRoot, 'xtensa-espressif_esp32s3_zephyr-elf', 'bin', gdbName);
  return existsSync(gdbPath) ? gdbPath.replace(/\\/g, '/') : undefined;
}

/** Compare two dotted version strings numerically (0.17.10 > 0.17.4). */
function compareSdkVersions(a: string, b: string): number {
  const segsOf = (v: string): number[] => v.split('.').map((s) => parseInt(s, 10) || 0);
  const aa = segsOf(a);
  const bb = segsOf(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const d = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Probe the well-known Zephyr SDK install locations, newest version first:
 *   1. $ZEPHYR_SDK_INSTALL_DIR (the var board.cmake reads)
 *   2. <MAMBA_ROOT_PREFIX | ~/micromamba>/zephyr-sdk/zephyr-sdk-<ver> — the
 *      @typecad/zephyr-installer layout
 *   3. ~/zephyr-sdk-<ver> — the standalone download layout
 *
 * Only roots that actually contain the esp32s3 GDB are useful to callers;
 * this returns candidate roots (gdbPathFromSdkRoot does the existence check)
 * so tests can inject home/env overrides.
 */
export function discoverZephyrSdkRoots(opts?: {
  home?: string;
  env?: Record<string, string | undefined>;
}): string[] {
  const env = opts?.env ?? process.env;
  const home = opts?.home ?? (env.USERPROFILE || env.HOME || '');
  const scanned: string[] = [];

  const versionedDirs = (base: string): string[] => {
    try {
      return readdirSync(base)
        .filter((d) => existsSync(join(base, d)) && d.startsWith('zephyr-sdk-'))
        .map((d) => join(base, d));
    } catch {
      return []; // dir absent
    }
  };
  const mambaRoot = env.MAMBA_ROOT_PREFIX || (home ? join(home, 'micromamba') : '');
  if (mambaRoot) scanned.push(...versionedDirs(join(mambaRoot, 'zephyr-sdk')));
  if (home) scanned.push(...versionedDirs(home));

  // Scanned roots newest version first; the env var stays pinned first
  // (explicit user intent outranks any discovered location).
  scanned.sort((a, b) => {
    const va = a.match(/zephyr-sdk-([\d.]+)/)?.[1] ?? '';
    const vb = b.match(/zephyr-sdk-([\d.]+)/)?.[1] ?? '';
    return compareSdkVersions(vb, va);
  });
  const roots = env.ZEPHYR_SDK_INSTALL_DIR
    ? [env.ZEPHYR_SDK_INSTALL_DIR, ...scanned]
    : scanned;
  // De-duplicate (an env var may repeat a scan hit) preserving order.
  return roots.filter((r, i) => roots.indexOf(r) === i);
}

/**
 * Resolve the Espressif OpenOCD binary path. The esp32s3 needs the Espressif
 * OpenOCD fork (openocd-esp32) — not the Zephyr SDK's openocd and not a
 * generic/GDB-stub build — because only it carries the Xtensa + esp_usb_jtag
 * support. It is NOT on PATH by default, so Cortex-Debug must be pointed at it
 * explicitly or it fails with `spawn openocd.exe ENOENT`.
 *
 * Discovery order:
 *   1. ESPRESSIF_TOOLCHAIN_PATH env (the var board.cmake reads) — if set, its
 *      openocd-esp32/bin/openocd.exe.
 *   2. The standard ESP-IDF install layout: ~/.espressif/tools/openocd-esp32/
 *      <version>/openocd-esp32/bin/openocd.exe. Pick the newest version dir.
 * Returns undefined if not found (the launch.json then omits openOCDPath and
 * Cortex-Debug falls back to PATH / its openocdPath setting).
 */
export function resolveOpenOcdPath(): string | undefined {
  const candidates: string[] = [];
  // 1. ESPRESSIF_TOOLCHAIN_PATH env
  const envPath = process.env.ESPRESSIF_TOOLCHAIN_PATH;
  if (envPath) {
    candidates.push(join(envPath, 'openocd-esp32', 'bin', 'openocd.exe'));
  }
  // 2. ~/.espressif/tools/openocd-esp32/<version>/openocd-esp32/bin/openocd.exe
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    const base = join(home, '.espressif', 'tools', 'openocd-esp32');
    let versions: string[] = [];
    try {
      versions = readdirSync(base).filter((v) =>
        existsSync(join(base, v, 'openocd-esp32', 'bin', 'openocd.exe')),
      );
    } catch {
      // dir absent
    }
    // newest version last — sort then reverse so the highest wins on match.
    versions.sort().reverse();
    for (const v of versions) {
      candidates.push(join(base, v, 'openocd-esp32', 'bin', 'openocd.exe'));
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c).replace(/\\/g, '/');
  }
  return undefined;
}

/**
 * Resolve where to write the VS Code debug artifacts and how to express paths
 * in them.
 *
 * VS Code reads `.vscode/` from the folder the user has OPENED — and for a
 * cuttlefish project that is almost always the **cuttlefish project root**
 * (the directory containing `cuttlefish.config.ts`), NOT the git repo root.
 * The toolchain's `projectRoot` is the Zephyr *app* dir (e.g.
 * `<projectRoot>/src/out`), which sits below the cuttlefish config dir. So we
 * walk up from `projectRoot` to the nearest `cuttlefish.config.ts` and treat
 * THAT as the workspace root. This makes F5 work when a user opens the project
 * folder directly, and keeps launch.json paths relative to it.
 *
 * Returns { workspaceRoot, sketchRel } where workspaceRoot is the cuttlefish
 * project root (the `.vscode/` target) and sketchRel is the Zephyr app dir
 * (`projectRoot`) relative to it (e.g. 'src/out').
 */
export function resolveDebugLocations(projectRoot: string): {
  workspaceRoot: string;
  sketchRel: string;
} {
  // Walk up from the Zephyr app dir to find the cuttlefish project root (the
  // nearest ancestor containing cuttlefish.config.ts). Fall back to projectRoot
  // itself if none is found (single-dir project where the app sits at root).
  let workspaceRoot = resolve(projectRoot);
  let dir = resolve(projectRoot);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, 'cuttlefish.config.ts'))) {
      workspaceRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const sketchRel = relative(workspaceRoot, resolve(projectRoot)).replace(/\\/g, '/');
  return { workspaceRoot, sketchRel };
}

/** Read-merge-write a JSON file, adding/replacing a single config by a key. */
function mergeJsonArrayEntry<T extends Record<string, unknown>>(
  filePath: string,
  arrayKey: string,
  matchKey: string,
  entry: T,
): void {
  let doc: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      doc = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      // malformed — start fresh
    }
  }
  const arr = Array.isArray(doc[arrayKey]) ? (doc[arrayKey] as T[]) : [];
  const idx = arr.findIndex((e) => e[matchKey] === entry[matchKey]);
  if (idx >= 0) arr[idx] = entry;
  else arr.push(entry);
  doc[arrayKey] = arr;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
}

/**
 * Generate the GDB Python frame-filter that rewrites cuttlefish's hoisted
 * lambda frame names (`${prefix}_isr_N`) into readable `<lambda> @ file:line`
 * in the call stack. Only emitted when the source map references `_isr_N`
 * symbols; otherwise returns null (launch.json omits the `source` initCommand).
 *
 * Ported verbatim from the deleted framework-esp32/toolchain/gdb-script.ts —
 * the filter is cuttlefish-internal (lambda hoisting is framework-agnostic).
 */
export function generateGdbScript(sourceMapPath?: string): string | null {
  if (!sourceMapPath || !existsSync(sourceMapPath)) return null;
  let mapText = '';
  try {
    mapText = readFileSync(sourceMapPath, 'utf-8');
  } catch {
    return null;
  }
  // Only emit when the emitted code contains hoisted-lambda symbols.
  if (!/_isr_\d+/.test(mapText)) return null;

  // A GDB Python frame-filter. Registered via the launch.json initCommand
  // `source <path>` so GDB auto-loads it on attach.
  return [
    '# Auto-generated by @typecad/framework-zephyr. GDB frame-filter that',
    '# rewrites cuttlefish hoisted-lambda frame names (*_isr_N) into readable',
    '# <lambda> form so the VS Code call stack is legible.',
    'import gdb',
    'import re',
    '',
    'class CuttlefishLambdaFilter:',
    '    def __init__(self):',
    '        self.name = "cuttlefish_lambda"',
    '        self.priority = 100',
    '        self.enabled = True',
    '',
    '    def filter(self, frame_iter):',
    '        isr_re = re.compile(r"(.*)_isr_(\\d+)")',
    '        return (CuttlefishFrame(f) for f in frame_iter)',
    '',
    'class CuttlefishFrame:',
    '    def __init__(self, frame):',
    '        self.frame = frame',
    '    def __getattr__(self, name):',
    '        val = getattr(self.frame, name)',
    '        if name == "function":',
    '            m = isr_re.match(val)',
    '            if m: return "<lambda>"',
    '        return val',
    '',
    'gdb.frame_filters[CuttlefishLambdaFilter().name] = CuttlefishLambdaFilter()',
    '',
  ].join('\n');
}

/**
 * Build the cortex-debug launch.json config for an ESP32-S3 (built-in USB-JTAG).
 * `openOcdCfgRel` is the workspace-relative path to the generated
 * .cuttlefish/openocd.cfg, passed to cortex-debug's configFiles.
 */
function buildLaunchConfig(
  o: DebugConfigOptions,
  gdbScriptRel: string | undefined,
  openOcdCfgRel: string,
): Record<string, unknown> {
  // The ELF is at <projectRoot>/build/zephyr/zephyr.elf (Zephyr's standard
  // build output). cortex-debug uses `executable` (not `program`).
  const executable = `\${workspaceFolder}/${o.sketchRel}/build/zephyr/zephyr.elf`;

  // OpenOCD cfg relative to the workspace root so cortex-debug can pass it
  // via the -f flag.  Must be a list; cortex-debug prepends -f per entry.
  const configFiles = [`\${workspaceFolder}/${openOcdCfgRel}`];

  // GDB path resolved from the Zephyr SDK build cache (CMakeCache.txt).
  const gdbPath = resolveGdbPath(o.buildDir, o.target);

  // OpenOCD binary path — the Espressif fork (openocd-esp32) is required for
  // the esp_usb_jtag adapter.  cortex-debug's `serverpath` tells it where to
  // find the binary (not on PATH by default).
  const openocdPath = resolveOpenOcdPath();

  // Post-attach commands executed after GDB connects to the OpenOCD gdbserver.
  //   set mem inaccessible-by-default off — suppresses "Cannot access memory"
  //     errors caused by overlapping Xtensa memory regions (flash-mapped
  //     0x4200xxxx isn't accessible until the bootloader runs).
  //   mem 0x42000000 0x44000000 ro cache — tells GDB the app flash region IS
  //     read-only so -break-insert uses hw breakpoints, not sw breakpoints
  //     (which would fail with "Cannot access memory at 0x4200xxxx").
  //   monitor reset init  — reset target + halt (bootloader maps flash)
  //   thb setup           — temporary HW breakpoint at setup()
  //   c                   — continue; bootloader maps flash, breaks at setup()
  //
  // Paths use forward slashes — ${workspaceFolder} on Windows produces
  // backslashes that GDB interprets as escape sequences (\t → tab, etc.).
  const ws = o.workspaceRoot.replace(/\\/g, '/');
  const postAttachCommands = [
    `set directories ${ws}`,
    'set remote hardware-watchpoint-limit 2',
    'set remote hardware-breakpoint-limit 2',
    'set mem inaccessible-by-default off',
    'mem 0x42000000 0x44000000 ro cache',
    'monitor reset init',
    'thb setup',
    'c',
  ];
  if (gdbScriptRel) {
    postAttachCommands.splice(1, 0, `source ${ws}/${gdbScriptRel}`);
  }

  const cfg: Record<string, unknown> = {
    name: 'TypeCAD Debug (Zephyr, ESP32-S3)',
    type: 'cortex-debug',
    // Attach mode: no download (the ELF is already flashed). The server
    // controller's attachCommands() just halts the target, then our
    // postAttachCommands reset it, set a HW breakpoint at setup(), and
    // continue.  HW breakpoints use debug registers and work before the
    // bootloader maps the app flash region.
    request: 'attach',
    cwd: '${workspaceFolder}',
    executable,
    servertype: 'openocd',
    configFiles,
    interface: 'jtag',
    ...(gdbPath ? { gdbPath } : {}),
    ...(openocdPath ? { serverpath: openocdPath } : {}),
    postAttachCommands,
    preLaunchTask: 'cuttlefish: build + flash (debug)',
  };

  // openOcdCfgRel is consumed by configFiles above. Referenced here only to
  // keep the signature honest.
  void openOcdCfgRel;

  return cfg;
}

/**
 * Build the tasks.json entry: rebuild + flash only.  cortex-debug starts
 * OpenOCD as a child process (servertype: "openocd"), so the preLaunch task
 * just needs to build and upload — no isBackground / OpenOCD wrapping.
 */
function buildTask(o: DebugConfigOptions): Record<string, unknown> {
  return {
    label: 'cuttlefish: build + flash (debug)',
    type: 'shell',
    command: 'npx cuttlefish build --compile --upload --debug',
    options: { cwd: `\${workspaceFolder}/${o.sketchRel}` },
    group: { kind: 'build', isDefault: false },
    problemMatcher: [],
  };
}

/**
 * The adapter speed the S3's built-in USB-Serial-JTAG runs stably at.
 *
 * The interface cfg (esp_usb_jtag.cfg) defaults to 40000 (40 MHz), the chip
 * max. The USB-Serial-JTAG peripheral is a software bitq adapter that bit-bangs
 * JTAG over USB bulk transfers; at 40 MHz it can't keep up, drops transfers
 * (LIBUSB_ERROR_IO / "missing data from bitq interface"), and the reset/halt
 * sequence silently fails — leaving the target running with no breakpoint set
 * (the "debugger starts but never stops / buttons don't work" symptom).
 *
 * 4000 (4 MHz) is the empirically-stable speed for this peripheral.
 */
const OPENOCD_ADAPTER_SPEED = 4000;

/**
 * Build the OpenOCD cfg content. Sources the board's own openocd.cfg (which
 * sets ESP_RTOS Zephyr + ESP_ONLYCPU + the esp_usb_jtag driver + the esp32s3
 * target) then overrides the adapter speed AFTER the driver loads — the order
 * that a bare `-c "adapter speed N"` cannot guarantee (OpenOCD applies -c args
 * in command-line order relative to -f, and Cortex-Debug injects its own
 * helper/RTOS tcl, so the override can land before the driver exists or be
 * re-defaulted). Putting it in the cfg, after the source, is deterministic.
 */
function buildOpenOcdCfg(): string {
  return [
    '# Auto-generated by @typecad/framework-zephyr. Do not edit — regenerate',
    '# with `cuttlefish build --debug`. Sources the board cfg (which loads the',
    '# esp_usb_jtag adapter driver + esp32s3 target + ESP_RTOS Zephyr) then',
    '# overrides the adapter speed to a USB-JTAG-stable value AFTER the driver',
    '# is loaded. See debug-config.ts for the rationale.',
    'source [find board/esp32s3-builtin.cfg]',
    `adapter speed ${OPENOCD_ADAPTER_SPEED}`,
    '',
  ].join('\n');
}

/**
 * Write all gdb-mode debug artifacts for the given target. Called from the
 * toolchain compile() after a successful build when debugMode === 'gdb'.
 *
 * Writes (all idempotent):
 *   <workspaceRoot>/.vscode/launch.json   (cortex-debug config)
 *   <workspaceRoot>/.vscode/tasks.json    (build + flash preLaunch task)
 *   <projectRoot>/.cuttlefish/openocd.cfg (OpenOCD cfg, adapter speed override)
 *   <projectRoot>/.cuttlefish/.cuttlefish-gdb.py  (lambda frame filter, conditional)
 */
export function writeDebugConfig(o: DebugConfigOptions): void {
  const vscodeDir = join(o.workspaceRoot, '.vscode');
  const cuttlefishDir = join(o.projectRoot, '.cuttlefish');
  mkdirSync(cuttlefishDir, { recursive: true });

  // openocd.cfg — written first so its relative path can be wired into the
  // cortex-debug configFiles.  cortex-debug starts OpenOCD as a child process
  // and passes this file via -f.
  const openOcdCfgPath = join(cuttlefishDir, 'openocd.cfg');
  writeFileSync(openOcdCfgPath, buildOpenOcdCfg(), 'utf-8');
  const openOcdCfgRel = `${o.sketchRel}/.cuttlefish/openocd.cfg`;

  // launch.json — merge the cortex-debug config by name.
  const gdbScript = generateGdbScript(o.sourceMapPath);
  let gdbScriptRel: string | undefined;
  if (gdbScript) {
    const scriptPath = join(cuttlefishDir, '.cuttlefish-gdb.py');
    writeFileSync(scriptPath, gdbScript, 'utf-8');
    gdbScriptRel = `${o.sketchRel}/.cuttlefish/.cuttlefish-gdb.py`;
  }

  const launchConfig = buildLaunchConfig(o, gdbScriptRel, openOcdCfgRel);
  mergeJsonArrayEntry(join(vscodeDir, 'launch.json'), 'configurations', 'name', launchConfig);

  // tasks.json — merge the build+flash task by label.  OpenOCD is managed by
  // cortex-debug so the task is a simple synchronous build step.
  const task = buildTask(o);
  mergeJsonArrayEntry(join(vscodeDir, 'tasks.json'), 'tasks', 'label', task);
}

/**
 * The Zephyr app dir a `cuttlefish create` scaffold produces, relative to the
 * project root: the scaffold fixes entry `./src/main.ts` + outDir `./out`, and
 * the CLI resolves output.outDir against the ENTRY's directory (cli.ts), so
 * the emitted app root — and therefore the ELF, build dir, and .cuttlefish/
 * debug artifacts — always lands at `src/out`. Keep in sync with
 * generateProjectConfig in @typecad/cuttlefish create/templates.ts.
 */
const STARTER_SKETCH_REL = 'src/out';

/**
 * Create-time starter debug artifacts. Called by the cuttlefish `create` flow
 * (via the package's `writeProjectDebugArtifacts` export) so a fresh project
 * has a working F5 before any build exists:
 *
 * The launch.json's preLaunchTask runs `cuttlefish build --compile --upload
 * --debug`, which builds + flashes AND rewrites this same launch entry (merged
 * by name) with the CMakeCache-resolved gdbPath — so the starter files upgrade
 * themselves on the first debug build.
 *
 * No-ops (returns []) for targets without native GDB support (debugMode() !==
 * 'gdb'); the gdb frame-filter script is skipped (no source map exists yet).
 *
 * Returns the workspace-relative paths written, for CLI reporting.
 */
export function writeProjectDebugArtifacts(o: {
  /** Absolute path to the cuttlefish project root (contains cuttlefish.config.ts). */
  workspaceRoot: string;
  /** The Zephyr board id from the project config (frameworkData.buildTarget). */
  buildTarget?: string;
}): string[] {
  if (new ZephyrStrategy().debugMode(o.buildTarget) !== 'gdb') return [];
  const workspaceRoot = resolve(o.workspaceRoot);
  const projectRoot = join(workspaceRoot, STARTER_SKETCH_REL);
  writeDebugConfig({
    projectRoot,
    workspaceRoot,
    sketchRel: STARTER_SKETCH_REL,
    target: o.buildTarget ?? '',
    // No build dir exists yet — resolveGdbPath falls back to probing known
    // Zephyr SDK locations so gdbPath is still filled in when possible.
    buildDir: join(projectRoot, 'build'),
  });
  return [
    '.vscode/launch.json',
    '.vscode/tasks.json',
    `${STARTER_SKETCH_REL}/.cuttlefish/openocd.cfg`,
  ];
}
