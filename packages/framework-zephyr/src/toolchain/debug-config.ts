// ---------------------------------------------------------------------------
// debug-config.ts — west-driven VS Code debug artifacts (cortex-debug external
// server mode).
//
// The board-specific debug knowledge lives in Zephyr, not here: after any
// successful build, `west debugserver` serves the GDB connection using the
// board's own runner configuration (resolved in build/zephyr/runners.yaml —
// the exact arch gdb, the openocd/jlink binaries and flags, the Zephyr RTOS
// awareness, adapter quirks). The launch.json written here just connects
// cortex-debug to that server (`servertype: 'external'` +
// `gdbTarget: localhost:<port>`).
//
// Lifecycle: F5 runs the preLaunchTask (build + flash, unchanged), the
// background task `typecad-hal: debug server (west)` starts
// `typecad-hal debug-server start` (which wraps `west debugserver` and prints
// a ready marker the task's problem matcher waits for), and VS Code runs the
// postDebugTask (`typecad-hal: stop debug server`) when the session ends.
//
// Everything here is best-effort: a failed artifact write warns and never
// fails the build (a project without launch.json still builds fine).
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { ZephyrStrategy } from '../strategy.js';
import { readRunnersFacts } from './runners.js';

/** The gdb server port west's openocd/jlink runners default to. */
export const DEBUG_SERVER_PORT = 3333;
/** west's openocd tcl port — pinned in the debugserver invocation and used
 *  as the READINESS probe: its listener opens at the END of openocd's init
 *  (after the gdb listener and the startup halt), and probe connections
 *  there never consume the gdb server's single client slot. */
export const DEBUG_SERVER_TCL_PORT = 6333;

export interface DebugConfigOptions {
  /** Absolute path to the Zephyr project root (contains CMakeLists.txt + src/). */
  projectRoot: string;
  /** Absolute path to the workspace root (the cuttlefish config dir — the folder VS Code has open). */
  workspaceRoot: string;
  /** The Zephyr app dir relative to the workspace root (e.g. 'src/out'). */
  appRel: string;
  /** The Zephyr board id (e.g. 'esp32s3_devkitc'). */
  target: string;
  /** Absolute path to the Zephyr build dir (<projectRoot>/build) — read for the SDK/GDB path. */
  buildDir: string;
  /** Absolute path to the emitted source map (*.thcppmap.json), if any. */
  sourceMapPath?: string;
  /**
   * Create-time best-effort gdb (from the SDK + the board's silicon) — used
   * only when runners.yaml doesn't exist yet (pre-first-build). The first
   * build's west-resolved gdb replaces it, and a mismatch triggers the
   * artifact rewrite (debugArtifactsNeedRewrite).
   */
  starterGdbPath?: string;
}

/** Task labels (also the preLaunchTask/postDebugTask references in launch.json). */
export const DEBUG_BUILD_TASK = 'typecad-hal: build + flash (debug)';
export const DEBUG_SERVER_TASK = 'typecad-hal: debug server (west)';
export const DEBUG_SERVER_STOP_TASK = 'typecad-hal: stop debug server';

export function resolveDebugLocations(projectRoot: string): {
  workspaceRoot: string;
  appRel: string;
} {
  // Walk up from the Zephyr app dir to find the typecad-hal project root (the
  // nearest ancestor containing typecad-hal.config.ts). Fall back to projectRoot
  // itself if none is found (single-dir project where the app sits at root).
  let workspaceRoot = resolve(projectRoot);
  let dir = resolve(projectRoot);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, 'typecad-hal.config.ts'))) {
      workspaceRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const appRel = relative(workspaceRoot, resolve(projectRoot)).replace(/\\/g, '/');
  return { workspaceRoot, appRel };
}

/** Read-merge-write a JSON file, adding/replacing a single config by a key. */
function mergeJsonArrayEntry<T extends Record<string, unknown>>(
  filePath: string,
  arrayKey: string,
  nameKey: string,
  entry: T,
): void {
  let doc: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        doc = parsed as Record<string, unknown>;
      }
    } catch {
      // malformed — start fresh
    }
  }
  const arr = Array.isArray(doc[arrayKey])
    ? (doc[arrayKey] as Record<string, unknown>[])
    : [];
  const name = entry[nameKey] as string;
  const idx = arr.findIndex((e) => e && e[nameKey] === name);
  if (idx >= 0) arr[idx] = entry;
  else arr.push(entry);
  doc[arrayKey] = arr;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
}

/**
 * Whether the workspace's gdb debug artifacts need rewriting: missing, still
 * in an older (self-managed-server) shape, written before a build resolved
 * the gdb path (the create-time starter omits gdbPath), or referencing an app
 * root other than the current one (an outDir rename). Only OUR entries count
 * (`TypeCAD Debug (Zephyr, …)`); user-authored ones are never judged.
 */
export function debugArtifactsNeedRewrite(
  workspaceRoot: string,
  appRel: string,
  currentGdb?: string,
): boolean {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(join(workspaceRoot, '.vscode', 'launch.json'), 'utf-8'));
  } catch {
    return false; // no launch.json (or unreadable) — plain builds leave it absent
  }
  const configs = (doc as { configurations?: unknown }).configurations;
  if (!Array.isArray(configs)) return false;
  const prefix = `\${workspaceFolder}/${appRel ? `${appRel}/` : ''}`;
  for (const c of configs) {
    const e = c as { name?: unknown; executable?: unknown; servertype?: unknown; gdbPath?: unknown };
    if (typeof e.name !== 'string' || !e.name.startsWith('TypeCAD Debug (Zephyr,')) continue;
    if (e.servertype !== 'external') return true; // pre-west (self-managed server) shape
    if (e.gdbPath === undefined) return true; // create-time starter — upgrade on first build
    if (currentGdb !== undefined && typeof e.gdbPath === 'string'
      && e.gdbPath.replace(/\\/g, '/') !== currentGdb) {
      return true; // a wrong create-time silicon guess — west's answer wins
    }
    if (typeof e.executable === 'string'
      && e.executable.startsWith('${workspaceFolder}/')
      && !e.executable.startsWith(prefix)) {
      return true; // outDir moved
    }
    return false; // our entry exists in the current shape — nothing to do
  }
  return false; // no our-entry (deleted launch entry): only --debug recreates
}

/**
 * Build the cortex-debug launch.json config connecting to the west-owned gdb
 * server. `gdbPath` comes from the build's runners.yaml (west's own resolved
 * arch gdb); undefined before the first build (create-time starter).
 */
function buildLaunchConfig(
  o: DebugConfigOptions,
  gdbScriptRel: string | undefined,
  gdbPath: string | undefined,
): Record<string, unknown> {
  const executable = `\${workspaceFolder}/${o.appRel}/build/zephyr/zephyr.elf`;

  // The gdb binary names the architecture (xtensa-espressif_* / arm-zephyr-* /
  // riscv64-*): the Xtensa flash-mapping commands are only correct there —
  // app flash is unreadable until the ESP32 bootloader maps it, and the
  // trailing `c` rides the bootloader's slow boot past cortex-debug's init.
  const isXtensa = (gdbPath ?? '').includes('xtensa');

  // Post-attach commands executed after GDB connects to the west-owned server.
  //   set directories .           — source lookup root (gdb's cwd is the
  //                                 config's cwd = workspace root)
  //   monitor reset init          — reset target + halt via the server
  //   thb main                    — temporary HW breakpoint at main()
  // Paths must stay RELATIVE (cortex-debug passes commands verbatim; Windows
  // backslash expansion would corrupt absolute paths).
  const postAttachCommands = [
    'set directories .',
    'set remote hardware-watchpoint-limit 2',
    'set remote hardware-breakpoint-limit 2',
    ...(isXtensa ? [
      'set mem inaccessible-by-default off',
      'mem 0x42000000 0x44000000 ro cache',
    ] : []),
    'monitor reset init',
    'thb main',
    ...(isXtensa ? ['c'] : []),
  ];
  if (gdbScriptRel) {
    postAttachCommands.splice(1, 0, `source ${gdbScriptRel}`);
  }

  return {
    name: `TypeCAD Debug (Zephyr, ${o.target.split('/')[0]})`,
    type: 'cortex-debug',
    // Attach mode: no download (the ELF is already flashed by the
    // preLaunchTask's dependency chain). The server is west-owned;
    // cortex-debug only connects.
    request: 'attach',
    cwd: '${workspaceFolder}',
    executable,
    servertype: 'external',
    gdbTarget: `localhost:${DEBUG_SERVER_PORT}`,
    ...(gdbPath ? { gdbPath } : {}),
    postAttachCommands,
    preLaunchTask: DEBUG_SERVER_TASK,
    postDebugTask: DEBUG_SERVER_STOP_TASK,
  };
}

/** The build+flash task (preLaunchTask) — unchanged shape from the old flow. */
function buildTask(o: DebugConfigOptions): Record<string, unknown> {
  return {
    label: DEBUG_BUILD_TASK,
    type: 'shell',
    command: 'npx typecad-hal build --compile --upload --debug',
    options: { cwd: `\${workspaceFolder}/${o.appRel}` },
    group: { kind: 'build', isDefault: false },
    problemMatcher: [],
  };
}

/**
 * The background task that is the F5 preLaunchTask — ONE task, no dependsOn:
 * `debug-server start --flash` runs the whole build pipeline (transpile →
 * compile → upload, with --debug) and then serves. VS Code releases the
 * debug session to connect gdbTarget when the matcher's endsPattern (the
 * ready marker) fires, while the task keeps serving. (A dependsOn chain was
 * tried: VS Code awaits the whole dependency GROUP, and a background task
 * that never exits never releases the session — F5 hung with no debug UI.)
 */
function serverTask(o: DebugConfigOptions): Record<string, unknown> {
  return {
    label: DEBUG_SERVER_TASK,
    type: 'shell',
    command: 'npx typecad-hal debug-server start --flash',
    // NO_COLOR keeps chalk's ANSI codes out of the output — they break the
    // background patterns below (the banner prints as ESC[36m⇳ Transpiling,
    // and ^-anchored patterns never match past the escape byte). Same remedy
    // as the scaffold's watch task.
    options: { cwd: `\${workspaceFolder}/${o.appRel}`, env: { NO_COLOR: '1' } },
    isBackground: true,
    problemMatcher: {
      owner: 'typecad-hal-debug-server',
      // MUST never match a real line: matched lines become file-less
      // problems (default severity: error), and VS Code then blocks F5 with
      // "errors exist after running preLaunchTask". The sentinel literal
      // cannot occur in pipeline or openocd output. (^$ was tried — it
      // matches the blank lines openocd prints.)
      pattern: { regexp: '__cuttlefish_never_matches__' },
      background: {
        beginsPattern: 'Transpiling',
        endsPattern: `^TYPECAD_HAL: debug server ready on ${DEBUG_SERVER_PORT}`,
      },
    },
  };
}

/** The postDebugTask — stops the west-owned server when the session ends. */
function serverStopTask(o: DebugConfigOptions): Record<string, unknown> {
  return {
    label: DEBUG_SERVER_STOP_TASK,
    type: 'shell',
    command: 'npx typecad-hal debug-server stop',
    options: { cwd: `\${workspaceFolder}/${o.appRel}` },
    problemMatcher: [],
  };
}

/**
 * Write the debug artifacts: the cortex-debug launch entry (merged by name)
 * and the three tasks (merged by label). Returns the workspace-relative
 * paths written, for CLI reporting.
 */
export function writeDebugConfig(o: DebugConfigOptions): string[] {
  const vscodeDir = join(o.workspaceRoot, '.vscode');
  mkdirSync(vscodeDir, { recursive: true });

  // west's resolved facts — present after any successful build. Before the
  // first build the launch entry is written without gdbPath; the next build
  // upgrades it (debugArtifactsNeedRewrite).
  //
  // west records the `-py` (python-enabled) gdb variant; cortex-debug derives
  // objdump/nm paths from the gdb path by name substitution, and the -py
  // variants of those do not exist in the SDK (ENOENT noise, degraded symbol
  // classification). Prefer the plain gdb sibling when it exists.
  let gdbPath = readRunnersFacts(o.buildDir)?.gdb?.replace(/\\/g, '/');
  if (gdbPath && /-py(\.exe)?$/i.test(gdbPath)) {
    const plain = gdbPath.replace(/-py(\.exe)?$/i, '$1');
    if (existsSync(plain)) gdbPath = plain;
  }
  gdbPath = gdbPath ?? o.starterGdbPath;

  // gdb frame-filter script (lambda frames) — conditional on a source map.
  const gdbScript = generateGdbScript(o.sourceMapPath);
  let gdbScriptRel: string | undefined;
  if (gdbScript) {
    const scriptPath = join(o.projectRoot, '.typecad-hal', '.typecad-hal-gdb.py');
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, gdbScript, 'utf-8');
    gdbScriptRel = `${o.appRel}/.typecad-hal/.typecad-hal-gdb.py`;
  }

  const launchConfig = buildLaunchConfig(o, gdbScriptRel, gdbPath);
  mergeJsonArrayEntry(join(vscodeDir, 'launch.json'), 'configurations', 'name', launchConfig);

  const tasksPath = join(vscodeDir, 'tasks.json');
  for (const task of [buildTask(o), serverTask(o), serverStopTask(o)]) {
    mergeJsonArrayEntry(tasksPath, 'tasks', 'label', task);
  }

  return ['.vscode/launch.json', '.vscode/tasks.json'];
}

/**
 * The Zephyr app dir the standard `typecad-hal create` scaffold produces,
 * relative to the project root: the scaffold fixes entry `./src/main.ts` +
 * outDir `./out`, and the CLI resolves output.outDir against the ENTRY's
 * directory (cli.ts), so the emitted app root lands at `src/out`. The create
 * flow passes its actual resolution (typecad-hal create's starterAppRel) so a
 * non-standard scaffold still gets correct starter paths; this is only the
 * default.
 */
const STARTER_APP_REL = 'src/out';

/**
 * Create-time starter debug artifacts: the same west-driven launch entry and
 * tasks, minus gdbPath (no build exists yet — runners.yaml is absent). The
 * first build upgrades the entry (debugArtifactsNeedRewrite fires on the
 * missing gdbPath), so F5 after a compile is fully resolved.
 *
 * No-ops (returns []) for targets without gdb debug facts (no debug-capable
 * probe method in the board's table — printf instrumentation territory).
 */
export function writeProjectDebugArtifacts(o: {
  /** Absolute path to the typecad-hal project root (contains typecad-hal.config.ts). */
  workspaceRoot: string;
  /** The Zephyr board id from the project config (frameworkData.buildTarget). */
  buildTarget?: string;
  /**
   * The scaffolded app dir, workspace-relative with forward slashes.
   * Defaults to the standard layout ('src/out'); typecad-hal create passes
   * its config's actual entry + outDir resolution so a non-standard scaffold
   * still gets correct starter paths.
   */
  appRel?: string;
  /**
   * Create-time best-effort gdb from typecad-hal create (SDK + silicon) —
   * see DebugConfigOptions.starterGdbPath. Plain JSON string.
   */
  gdbPath?: string;
}): string[] {
  if (new ZephyrStrategy().debugMode(o.buildTarget) !== 'gdb') return [];
  const workspaceRoot = resolve(o.workspaceRoot);
  const appRel = o.appRel ?? STARTER_APP_REL;
  const projectRoot = join(workspaceRoot, appRel);
  return writeDebugConfig({
    projectRoot,
    workspaceRoot,
    appRel,
    target: o.buildTarget ?? '',
    buildDir: join(projectRoot, 'build'),
    ...(o.gdbPath ? { starterGdbPath: o.gdbPath } : {}),
  });
}

// -- gdb frame-filter script -------------------------------------------------

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

  // A GDB Python frame-filter. Registered via the launch.json postAttachCommand
  // `source <path>` so GDB auto-loads it on attach.
  return [
    '# Auto-generated by @typecad/framework-zephyr. GDB frame-filter that',
    '# rewrites typecad-hal hoisted-lambda frame names (*_isr_N) into readable',
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
