/**
 * Generators for the ESP32-S3 GDB debug artifacts. All output is deterministic
 * and idempotent — re-running with the same inputs produces byte-identical
 * files, so toggling --debug off and on doesn't churn the working tree.
 *
 * Paths are baked at generation time: VS Code sees no angle-bracket placeholders.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import type { GeneratedSourceMap } from '@typecad/cuttlefish/api';
import { generateGdbScript } from './gdb-script.js';

/**
 * Walk up from `start` to the nearest ancestor containing a `.git` marker
 * (directory or file — submodule worktrees use a file). Returns the absolute
 * path of that ancestor, or `null` if none is found before the filesystem root.
 *
 * Used to decide where VS Code is most likely to read `.vscode/` from: the
 * git/workspace root is the conventional folder to open for a monorepo, so
 * launch.json/tasks.json are written there. Falls back to the sketch dir
 * (see resolveDebugLocations) when not in a git repo.
 */
export function findWorkspaceRoot(start: string): string | null {
  let dir = start;
  // Walk until dirname(dir) === dir (filesystem root).
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Normalize a path to forward slashes for use in launch.json/tasks.json.
 * VS Code accepts either separator on Windows, but forward slashes avoid
 * JSON-escaping backslashes and are portable.
 */
function toForwardSlash(p: string): string {
  return p.split(sep).join('/');
}

export interface DebugLocations {
  /** Where to write .vscode/launch.json + tasks.json (the workspace root). */
  workspaceRoot: string;
  /**
   * Path from the workspace root to the sketch dir, forward-slashed.
   * Empty string when the sketch IS the workspace root (so generators can
   * collapse the path). Otherwise e.g. 'demos/demo'.
   */
  sketchRel: string;
}

/**
 * Resolve where to write the VS Code configs and the relative path from there
 * to the sketch dir.
 *
 * Strategy: if the sketch is inside a git repo, write to the repo root (the
 * most common folder to have open in VS Code) and compute sketchRel relative
 * to it. If not in a git repo, write at the sketch dir itself with sketchRel
 * empty.
 *
 * Returns forward-slashed sketchRel so it can be interpolated directly into
 * launch.json paths.
 */
export function resolveDebugLocations(sketchDir: string): DebugLocations {
  const wsRoot = findWorkspaceRoot(sketchDir);
  if (wsRoot && wsRoot !== sketchDir) {
    return { workspaceRoot: wsRoot, sketchRel: toForwardSlash(relative(wsRoot, sketchDir)) };
  }
  // Either no git repo, or the sketch IS the repo root.
  return { workspaceRoot: sketchDir, sketchRel: '' };
}

export interface DebugConfigOptions {
  /** ELF base name, e.g. 'demo' → build/demo.elf */
  projectName: string;
  /** Workspace-relative path to the sketch dir, e.g. 'demos/demo' */
  sketchRel: string;
  /** Build target (currently only 'esp32s3' is wired for gdb) */
  target: string;
  /**
   * Whether a .cuttlefish-gdb.py was generated for this build (i.e. the
   * source map had _isr_N entries). When true, launch.json adds a `source`
   * initCommand for it; when false, the directive is omitted so GDB doesn't
   * error on a missing file.
   */
  hasGdbScript?: boolean;
}

export interface WriteDebugConfigOptions extends DebugConfigOptions {
  /** Absolute path to the ESP-IDF project root (the out-<target> dir). */
  projectRoot: string;
  /** Absolute workspace root, for path normalization. */
  workspaceRoot: string;
  /** Path to main/main.cc.thcppmap.json — feeds the gdb script. */
  sourceMapPath: string;
}

function outRel(opts: DebugConfigOptions): string {
  // sketchRel is the workspace-relative path to the sketch dir. When empty
  // (the sketch IS the workspace root), collapse it to avoid an ugly
  // '${workspaceFolder}//src/out-...' path; otherwise prepend it.
  const sketch = opts.sketchRel === '' ? '' : `${opts.sketchRel}/`;
  return `${sketch}src/out-${opts.target}`;
}

/**
 * Build the tasks.json `cwd` for the sketch dir. When sketchRel is empty
 * (workspace IS the sketch dir), collapse to bare ${workspaceFolder} rather
 * than ${workspaceFolder}/.
 */
function sketchCwd(sketchRel: string): string {
  return sketchRel === '' ? '${workspaceFolder}' : `\${workspaceFolder}/${sketchRel}`;
}

export function buildLaunchJson(opts: DebugConfigOptions): string {
  // The ELF path for the gdbtarget config.
  const elfPath = `\${workspaceFolder}/${outRel(opts)}/build/${opts.projectName}.elf`;

  // Only emit the `source` directive for the gdb script when one was actually
  // generated. GDB errors on `source <missing-file>`, and sketches with no
  // hoisted lambdas produce no .cuttlefish-gdb.py.
  const initCommands = [
    'set directories ${workspaceFolder}',
    'set auto-load safe-path ${workspaceFolder}',
  ];
  if (opts.hasGdbScript) {
    initCommands.push(`source \${workspaceFolder}/${outRel(opts)}/.cuttlefish/.cuttlefish-gdb.py`);
  }
  initCommands.push('set remote hardware-watchpoint-limit 2');

  // Single gdbtarget configuration. The ESP-IDF VS Code extension provides the
  // `gdbtarget` debug type and resolves GDB itself via ${command:espIdf.getToolchainGdb}.
  // The IDF extension's gdbtarget adapter also starts its OWN OpenOCD via its
  // OpenOCD Manager (reading idf.openOcdConfigs from settings) — so we must NOT
  // start a competing OpenOCD. The preLaunchTask is just build+flash.
  const cfg = {
    version: '0.2.0',
    configurations: [
      {
        type: 'gdbtarget',
        request: 'attach',
        name: 'TypeCAD Debug (ESP32-S3)',
        program: elfPath,
        gdbPath: '${command:espIdf.getToolchainGdb}',
        target: { type: 'remote', host: 'localhost', port: '3333' },
        preLaunchTask: 'cuttlefish: build + flash',
        initCommands,
      },
    ],
  };
  return JSON.stringify(cfg, null, 2);
}

export function buildTasksJson(opts: DebugConfigOptions): string {
  // Single task: build + flash. The ESP-IDF extension's gdbtarget adapter
  // starts its own OpenOCD via its OpenOCD Manager — we don't start one here.
  // No --port flag: the cuttlefish CLI resolves the port from config.console.port
  // at runtime, so changing console.port takes effect on the next F5 without
  // a rebuild.
  const tasks = {
    version: '2.0.0',
    tasks: [
      {
        label: 'cuttlefish: build + flash',
        type: 'shell',
        command: 'cuttlefish build --compile --upload --debug',
        options: { cwd: sketchCwd(opts.sketchRel) },
      },
    ],
  };
  return JSON.stringify(tasks, null, 2);
}

export function buildOpenOcdCfg(): string {
  // The board config sources interface/esp_usb_jtag.cfg + target/esp32s3.cfg
  // but doesn't set adapter speed, so OpenOCD defaults to the chip max (40 MHz).
  // The S3's built-in USB-Serial-JTAG is a software (bitq) adapter that
  // bit-bangs JTAG over USB bulk transfers — at 40 MHz it can't keep up,
  // drops transfers (LIBUSB_ERROR_IO), and emits "missing data from bitq
  // interface" in a re-examine loop. 5 MHz is the commonly-recommended stable
  // speed for the USB-Serial-JTAG peripheral across Espressif's forums/issues.
  return [
    'source [find board/esp32s3-builtin.cfg]',
    'adapter speed 5000',
  ].join('\n') + '\n';
}

/**
 * Merge cuttlefish-owned settings into an existing VS Code settings object.
 *
 * The gdbtarget debug path runs OpenOCD via the ESP-IDF extension's OpenOCD
 * Manager, which reads `idf.openOcdConfigs` (a list of cfg files / board cfg
 * names to pass via -f). The Manager IGNORES .cuttlefish/openocd.cfg, so to
 * get the adapter-speed override applied we point idf.openOcdConfigs at our
 * generated cfg — which contains BOTH `source board/esp32s3-builtin.cfg` AND
 * `adapter speed 5000` in the correct order (speed AFTER the adapter driver
 * is loaded by the board cfg). Setting speed via -c idf.openOcdLaunchArgs
 * fails because -c is processed before -f, so the speed command runs before
 * any adapter driver is registered → "Debug Adapter has to be specified."
 *
 * `openocdCfgPath` is the absolute path to the generated .cuttlefish/openocd.cfg
 * (forward-slashed for OpenOCD portability).
 *
 * VS Code settings use FLAT DOTTED KEYS ("idf.openOcdConfigs" as a top-level
 * string property), NOT a nested { idf: {...} } structure — the IDF extension
 * reads them flat. A nested object would be silently ignored.
 *
 * `existing` is the parsed settings.json (or {} when absent/corrupt).
 */
export function buildVscodeSettings(
  openocdCfgPath: string,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  // Drop idf.openOcdLaunchArgs if a prior cuttlefish version wrote it — the
  // -c "adapter speed" approach fails because -c is processed before -f, so
  // the speed command runs before any adapter driver is registered. The speed
  // override now lives inside the generated cfg (sourced via idf.openOcdConfigs),
  // after the board cfg loads the adapter driver.
  const { 'idf.openOcdLaunchArgs': _drop, ...rest } = existing;
  return { ...rest, 'idf.openOcdConfigs': [openocdCfgPath] };
}

export function buildSdkconfigDefaultsDebug(): string {
  return [
    '# Auto-generated by cuttlefish for GDB debug builds.',
    '# Applied after sdkconfig.defaults via SDKCONFIG_DEFAULTS chain.',
    "# -Og (not -Os) so #line stepping doesn't jump erratically; LTO off",
    '# so DWARF symbols survive.',
    'CONFIG_COMPILER_OPTIMIZATION_DEBUG=y',
    'CONFIG_COMPILER_OPTIMIZATION_SIZE=',
    'CONFIG_COMPILER_OPTIMIZATION_ASSERTIONS_LEVEL=1',
  ].join('\n') + '\n';
}

/**
 * Write all gdb debug artifacts. Idempotent: re-running overwrites with
 * identical content (deterministic generators).
 *
 * Two distinct landing locations, by who consumes them:
 *
 *   workspaceRoot/.vscode/launch.json      ← VS Code loads launch configs ONLY
 *   workspaceRoot/.vscode/tasks.json         from the workspace root, so these
 *                                            must land here for F5 to discover them.
 *
 *   projectRoot/.cuttlefish/openocd.cfg     ← Consumed by OpenOCD/GDB relative
 *   projectRoot/.cuttlefish/.cuttlefish-gdb.py  to the build output, which lives
 *   projectRoot/sdkconfig.defaults.debug       under projectRoot (next to the ELF).
 *
 * projectRoot is the ESP-IDF project dir (the `src/out-<target>/` folder);
 * workspaceRoot is the folder the user opens in VS Code (the sketch dir, which
 * holds cuttlefish.config.ts). launch.json/tasks.json use ${workspaceFolder} to
 * address projectRoot-relative paths, so the split doesn't break references.
 */
export function writeDebugConfig(opts: WriteDebugConfigOptions): void {
  // GDB script: only if a source map exists and contains _isr_N symbols.
  // Avoids emitting a no-op script for sketches with no hoisted lambdas, and
  // controls whether launch.json adds the matching `source` directive.
  let hasGdbScript = false;
  if (existsSync(opts.sourceMapPath)) {
    const map = JSON.parse(readFileSync(opts.sourceMapPath, 'utf8')) as GeneratedSourceMap;
    hasGdbScript = map.entries.some((e) => e.symbolName && /_isr_\d+$/.test(e.symbolName));
    if (hasGdbScript) {
      mkdirSync(join(opts.projectRoot, '.cuttlefish'), { recursive: true });
      writeFileSync(join(opts.projectRoot, '.cuttlefish/.cuttlefish-gdb.py'), generateGdbScript(map));
    }
  }

  const baseOpts: DebugConfigOptions = {
    projectName: opts.projectName,
    sketchRel: opts.sketchRel,
    target: opts.target,
    hasGdbScript,
  };

  // launch.json + tasks.json: workspace root (where VS Code discovers them).
  mkdirSync(join(opts.workspaceRoot, '.vscode'), { recursive: true });
  writeFileSync(join(opts.workspaceRoot, '.vscode/launch.json'), buildLaunchJson(baseOpts));
  writeFileSync(join(opts.workspaceRoot, '.vscode/tasks.json'), buildTasksJson(baseOpts));

  // settings.json: merge cuttlefish-owned keys into the existing file. The
  // gdbtarget path runs OpenOCD via the IDF extension's Manager, which reads
  // idf.openOcdConfigs — we point it at our generated .cuttlefish/openocd.cfg
  // (which contains the adapter-speed override). Read-merge-write so we don't
  // clobber user/other-extension settings.
  const settingsPath = join(opts.workspaceRoot, '.vscode/settings.json');
  let existingSettings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      existingSettings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      // Corrupt settings.json — start fresh. (Never overwrite a file we can't
      // read, but we can't merge into garbage either.)
      existingSettings = {};
    }
  }
  // The generated .cuttlefish/openocd.cfg lives at the project root (next to
  // the build output). The IDF extension's OpenOCD Manager reads it via
  // idf.openOcdConfigs (set below), so it needs an absolute, forward-slashed
  // path (OpenOCD is picky about backslashes on Windows).
  const openocdCfgPath = join(opts.projectRoot, '.cuttlefish', 'openocd.cfg').replace(/\\/g, '/');
  writeFileSync(settingsPath, JSON.stringify(buildVscodeSettings(openocdCfgPath, existingSettings), null, 2) + '\n');

  // openocd.cfg + sdkconfig.defaults.debug: project root (next to build output).
  mkdirSync(join(opts.projectRoot, '.cuttlefish'), { recursive: true });
  writeFileSync(join(opts.projectRoot, '.cuttlefish/openocd.cfg'), buildOpenOcdCfg());
  writeFileSync(join(opts.projectRoot, 'sdkconfig.defaults.debug'), buildSdkconfigDefaultsDebug());
}
