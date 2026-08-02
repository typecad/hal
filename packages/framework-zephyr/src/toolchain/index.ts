// ---------------------------------------------------------------------------
// FrameworkToolchain impl for Zephyr (west / CMake)
//
// compile() scaffolds the project (idempotent) then runs `west build -b <board>`.
// upload() runs `west flash`. monitor() runs a best-effort serial monitor.
//
// west resolution goes through westSpawn(), which finds a usable west without
// requiring the user to have activated the Zephyr Python venv — it prefers
// `<python> -m west` (robust cross-platform form) and injects ZEPHYR_BASE when
// a SDK root is discovered. See west-discover.ts / west-spawn.ts.
//
// The board target is carried via frameworkData.buildTarget (populated as
// ToolchainOptions.buildTarget by the cuttlefish CLI), defaulting to the
// framework's canonical MVP target (xiao_ble).
//
// Mirrors framework-esp32/src/toolchain/index.ts structure: projectRoot derived
// from outputDir, prepare is a no-op (scaffold happens in compile when the
// target is known), GCC errors parsed via the shared parseCompileErrors helper.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import type { ToolchainOptions, CompileResult, UploadResult } from '@typecad/cuttlefish/api/shared';
import { parseCompileErrors } from '@typecad/cuttlefish/api/shared';
import { scaffoldZephyrProject, writeIfChanged } from './scaffold.js';
import { westSpawn, buildEnv } from './west-spawn.js';
import { discoverWest } from './west-discover.js';
import { writeDebugConfig, resolveDebugLocations } from './debug-config.js';
import { ZephyrStrategy } from '../strategy.js';
import { generateOverlay } from '../dt-config/overlay.js';
import { chipForTarget } from '../chips/index.js';
import { DEFAULT_ZEPHYR_DISPLAY_PROFILE } from '../display/profiles.js';

/** Default board target — the framework's MVP canonical board. */
const DEFAULT_BOARD = 'xiao_ble';

function targetFromOptions(o: ToolchainOptions): string {
  // The cuttlefish CLI populates ToolchainOptions.buildTarget from
  // config.frameworkData.buildTarget. Accept frameworkData.target as an alias.
  const fcTarget = (o.frameworkConfig?.target as string | undefined);
  return (o.buildTarget as string | undefined) ?? fcTarget ?? DEFAULT_BOARD;
}

/**
 * Derive the Zephyr project root from the cuttlefish-emitted source path.
 *
 * Cuttlefish emits `src/main.cpp` under the output dir. The CLI passes
 * `sourcePath` = full path to `main.cpp` and `outputDir` = its parent (`src/`).
 * For Zephyr, the project root is the parent of `src/` — one level above
 * `outputDir`. Detect that shape and adjust; otherwise fall back to `outputDir`.
 */
export function projectRootFromOptions(o: ToolchainOptions): string {
  const outDir = o.outputDir;
  if (basename(outDir) === 'src') {
    return dirname(outDir);
  }
  return outDir;
}

/**
 * west build timeout. Zephyr's first build fetches the toolchain modules and
 * configures CMake/Ninja, which can take several minutes; allow generous headroom.
 */
const BUILD_TIMEOUT_MS = 600_000;
const FLASH_TIMEOUT_MS = 120_000;

/**
 * FrameworkToolchain for Zephyr. Spec §3.5 (mirror of the ESP-IDF toolchain).
 * The target board is carried via frameworkData.buildTarget; scaffolding
 * happens at compile time when the target is known.
 */
export const Toolchain = {
  prepare(outputDir: string, entryPoint: string): void {
    // Write the DT overlay for the default board (the real target is known at
    // compile time; prepare runs before compile, so use the default board id).
    // The overlay is additive and idempotent; compile re-runs prepare-equivalent
    // logic in scaffold via the usage scan. Mirrors how Arduino's library
    // resolution is a pre-build artifact step.
    const projectRoot = basename(outputDir) === 'src' ? dirname(outputDir) : outputDir;
    const board = DEFAULT_BOARD;
    const chip = chipForTarget(board);
    // Scan the emitted source for usage tokens (same authoritative signal the
    // scaffold uses). entryPoint is the path to main.cpp; its dir is src/.
    const srcDir = dirname(entryPoint);
    let src = '';
    try {
      for (const name of readdirSync(srcDir)) {
        if (name.endsWith('.cpp') || name.endsWith('.c')) {
          src += readFileSync(join(srcDir, name), 'utf8');
        }
      }
    } catch { /* src may not exist yet on first prepare */ }
    const uses = (t: string): boolean => src.includes(t);
    const usesDisplay = uses('display_write') || uses('display_init') || uses('display_fill_rect');
    // When the program uses the display, resolve a profile so the overlay
    // enables the display DT node (&display0). For now the default profile is
    // the only one registered; thread frameworkData.display through here when a
    // board carries more than one display binding.
    const displayProfile = usesDisplay ? DEFAULT_ZEPHYR_DISPLAY_PROFILE : undefined;
    const overlay = generateOverlay(chip, {
      usesI2c: uses('i2c_'),
      usesSpi: uses('spi_'),
      usesUart: uses('uart_'),
      usesDisplay,
    }, displayProfile);
    const overlayDir = join(projectRoot, 'app', 'boards');
    mkdirSync(overlayDir, { recursive: true });
    writeIfChanged(join(overlayDir, `${board}.overlay`), overlay);
  },

  compile(o: ToolchainOptions): CompileResult {
    const projectRoot = projectRootFromOptions(o);
    const board = targetFromOptions(o);
    const debugMode = new ZephyrStrategy().debugMode(board);
    const isGdbDebug = o.debug === true && debugMode === 'gdb';
    const zc = o.zephyrConfig as Record<string, unknown> | undefined;
    const userKconfig = zc?.kconfig as Record<string, string> | undefined;
    const configChanged = scaffoldZephyrProject(projectRoot, isGdbDebug, userKconfig);

    // Use a stable build dir so incremental builds reuse the Ninja graph.
    // west defaults to <projectRoot>/build.
    const buildDir = join(projectRoot, 'build');

    // When prj.conf, CMakeLists.txt, or the DT overlay changed, nuke the build
    // directory so CMake reconfigures from scratch. Without this, stale Ninja
    // dependency graphs in the build/ cache can produce `ninja: error:
    // dependency cycle` when Kconfig symbols and generated headers diverge.
    if (configChanged) {
      try { rmSync(buildDir, { recursive: true, force: true }); } catch { /* may not exist */ }
    }

    const buildArgs = ['build', '-b', board, '-d', buildDir, projectRoot];
    // Append user cmake args from cuttlefish.config.ts zephyr.cmakeArgs.
    const userCmakeArgs = zc?.cmakeArgs as string[] | undefined;
    if (userCmakeArgs && userCmakeArgs.length > 0) {
      buildArgs.push('--');
      buildArgs.push(...userCmakeArgs);
    }
    const inv = westSpawn(
      buildArgs,
      { cwd: projectRoot, encoding: 'utf-8', timeout: BUILD_TIMEOUT_MS },
    );
    const result = spawnSync(inv.command, inv.args, inv.options);

    const stdout = typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString() ?? '');
    const stderr = typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString() ?? '');
    const output = stdout + stderr;
    // Prefix the build log with how west was resolved, for transparency.
    const header = `Using west via ${inv.install.source}` +
      (inv.install.zephyrBase ? ` (ZEPHYR_BASE=${inv.install.zephyrBase})` : '') + '\n';

    // After a successful build in gdb mode (--debug on a probe-capable target),
    // write the VS Code launch.json + tasks.json + gdb-script artifacts so F5
    // attaches GDB to the chip's debug probe. Non-fatal on failure — a missing
    // artifact doesn't block the build. Mirrors the deleted framework-esp32
    // toolchain compile() debug-config wiring.
    if (result.status === 0 && isGdbDebug) {
      try {
        const { workspaceRoot, sketchRel } = resolveDebugLocations(projectRoot);
        writeDebugConfig({
          projectRoot,
          workspaceRoot,
          sketchRel,
          target: board,
          buildDir,
          sourceMapPath: join(dirname(o.sourcePath), `${basename(o.sourcePath)}.thcppmap.json`),
        });
      } catch (e) {
        console.warn(`[cuttlefish] gdb debug config generation failed: ${(e as Error).message}`);
      }
    }

    return {
      success: result.status === 0,
      output: header + output,
      errors: parseCompileErrors(output, o.sourcePath),
    };
  },

  upload(o: ToolchainOptions): UploadResult {
    const projectRoot = projectRootFromOptions(o);
    const buildDir = join(projectRoot, 'build');
    const board = targetFromOptions(o);
    const zc = o.zephyrConfig as Record<string, unknown> | undefined;
    const args = ['flash', '-d', buildDir];

    // User-configured runner from cuttlefish.config.ts zephyr.runner.
    // When set it overrides the auto-detected runner below.
    const userRunner = zc?.runner as string | undefined;
    if (userRunner) {
      args.push('--runner', userRunner);
    }

    // Flash runner is target-specific. nRF boards (xiao_ble) flash over J-Link
    // via nrfjprog; Espressif boards (esp32s3_devkitc / esp32*) flash over USB
    // via the esptool runner that the board's board.cmake selects by default.
    // Forcing --runner nrfjprog unconditionally broke ESP flashing.
    if (o.port) {
      if (board.startsWith('esp32')) {
        // esptool reads the device from --esp-device. Let board.cmake pick the
        // runner; just forward the port so COM5 (etc.) flashes the right device.
        args.push('--esp-device', o.port);
      } else if (!userRunner) {
        // Only auto-set to nrfjprog if the user hasn't already specified one.
        args.push('--runner', 'nrfjprog'); // nRF52840 flashes via J-Link/nrfjprog
      }
    }

    const inv = westSpawn(args, {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: FLASH_TIMEOUT_MS,
    });
    const result = spawnSync(inv.command, inv.args, inv.options);

    const fstdout = typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString() ?? '');
    const fstderr = typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString() ?? '');
    return {
      success: result.status === 0,
      output: fstdout + fstderr,
    };
  },

  monitor(o: ToolchainOptions): void {
    // Serial monitor over USB-CDC. Zephyr does NOT ship a `west serial`
    // subcommand (it's not a real west command — invoking it errors with
    // "unknown command"). The discovered west install's venv carries pyserial,
    // so run its bundled miniterm directly: `python -m serial.tools.miniterm`.
    // That is the same cross-platform terminal pyserial provides in ESP-IDF's
    // idf.py monitor, and it inherits stdio so Ctrl+C exits cleanly.
    if (!o.port) {
      throw new Error(
        'A serial port is required to monitor. Pass --port <COMx/ttyX>.',
      );
    }
    // ESP32 USB-CDC console runs at 115200 (the Zephyr ESP32 board default).
    // The CLI's generic default of 9600 is wrong for this target; honor an
    // explicit --baud / config.console.baudRate when given, else 115200.
    const baud = o.baud ?? 115200;
    const install = discoverWest();
    const py = install?.pythonExecutable ?? process.env.PYTHON ?? 'python';
    // Reuse west-spawn's env builder (prepends the venv bin dir to PATH so the
    // python we spawn resolves pyserial from the same venv). Falls back to the
    // process env when no install is discovered.
    const env = install ? buildEnv(install) : process.env;
    spawnSync(py, ['-m', 'serial.tools.miniterm', o.port, String(baud)], {
      cwd: projectRootFromOptions(o),
      env,
      stdio: 'inherit',
    });
  },

  debug(o: ToolchainOptions): void {
    // Launch an interactive GDB session for the last build. `west debug`
    // auto-resolves the runner (openocd for esp32s3, nrfjprog/jlink for nRF)
    // and the GDB binary from the build dir's CMakeCache/board.cmake — no
    // hand-authored gdbinit needed. Inherits stdio so GDB runs interactively.
    // (Not invoked by the standard build/compile flow; powers an explicit
    // debug-attach entry point for terminal-driven debugging without VS Code.)
    const projectRoot = projectRootFromOptions(o);
    const buildDir = join(projectRoot, 'build');
    const inv = westSpawn(['debug', '-d', buildDir], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    spawnSync(inv.command, inv.args, inv.options);
  },
};
