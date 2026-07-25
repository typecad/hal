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
  /** Serial port, from config.port ?? cliPort */
  port: string;
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

  const cfg = {
    version: '0.2.0',
    configurations: [
      {
        type: 'gdbtarget',
        request: 'attach',
        name: 'TypeCAD Debug (ESP32-S3)',
        program: `\${workspaceFolder}/${outRel(opts)}/build/${opts.projectName}.elf`,
        gdbPath: '${command:espIdf.getToolchainGdb}',
        target: { type: 'remote', host: 'localhost', port: '3333' },
        preLaunchTask: 'cuttlefish: debug prep',
        initCommands,
      },
    ],
  };
  return JSON.stringify(cfg, null, 2);
}

export function buildTasksJson(opts: DebugConfigOptions): string {
  const tasks = {
    version: '2.0.0',
    tasks: [
      {
        label: 'cuttlefish: start openocd',
        type: 'shell',
        command: `openocd -f \${workspaceFolder}/${outRel(opts)}/.cuttlefish/openocd.cfg`,
        isBackground: true,
        problemMatcher: {
          owner: 'openocd',
          pattern: { regexp: '^[^N]' },
          background: {
            activeOnStart: true,
            beginsPattern: '^Open On-Chip Debugger',
            endsPattern: '^Info : Listening on port 3333 for gdb connections',
          },
        },
      },
      {
        label: 'cuttlefish: build + flash',
        type: 'shell',
        command: `cuttlefish build --compile --upload --debug --port ${opts.port}`,
        options: { cwd: sketchCwd(opts.sketchRel) },
      },
      {
        label: 'cuttlefish: debug prep',
        dependsOn: ['cuttlefish: start openocd', 'cuttlefish: build + flash'],
        dependsOrder: 'parallel',
      },
    ],
  };
  return JSON.stringify(tasks, null, 2);
}

export function buildOpenOcdCfg(): string {
  return 'source [find board/esp32s3-builtin.cfg]\n';
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
    port: opts.port,
    target: opts.target,
    hasGdbScript,
  };

  // launch.json + tasks.json: workspace root (where VS Code discovers them).
  mkdirSync(join(opts.workspaceRoot, '.vscode'), { recursive: true });
  writeFileSync(join(opts.workspaceRoot, '.vscode/launch.json'), buildLaunchJson(baseOpts));
  writeFileSync(join(opts.workspaceRoot, '.vscode/tasks.json'), buildTasksJson(baseOpts));

  // openocd.cfg + sdkconfig.defaults.debug: project root (next to build output).
  mkdirSync(join(opts.projectRoot, '.cuttlefish'), { recursive: true });
  writeFileSync(join(opts.projectRoot, '.cuttlefish/openocd.cfg'), buildOpenOcdCfg());
  writeFileSync(join(opts.projectRoot, 'sdkconfig.defaults.debug'), buildSdkconfigDefaultsDebug());
}
