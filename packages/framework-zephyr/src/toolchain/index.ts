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
import type { ToolchainOptions, CompileResult, UploadResult } from '@typecad/cuttlefish/api/shared';
import { parseCompileErrors } from '@typecad/cuttlefish/api/shared';
import { scaffoldZephyrProject } from './scaffold.js';
import { westSpawn } from './west-spawn.js';

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
  prepare(_outputDir: string, _entryPoint: string): void {
    // no-op — scaffold happens in compile() so CMakeLists/prj.conf are always
    // in sync with the current config.
  },

  compile(o: ToolchainOptions): CompileResult {
    const projectRoot = projectRootFromOptions(o);
    scaffoldZephyrProject(projectRoot);

    const board = targetFromOptions(o);
    // Use a stable build dir so incremental builds reuse the Ninja graph.
    // west defaults to <projectRoot>/build.
    const buildDir = join(projectRoot, 'build');

    const inv = westSpawn(
      ['build', '-b', board, '-d', buildDir, projectRoot],
      { cwd: projectRoot, encoding: 'utf-8', timeout: BUILD_TIMEOUT_MS },
    );
    const result = spawnSync(inv.command, inv.args, inv.options);

    const stdout = typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString() ?? '');
    const stderr = typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString() ?? '');
    const output = stdout + stderr;
    // Prefix the build log with how west was resolved, for transparency.
    const header = `Using west via ${inv.install.source}` +
      (inv.install.zephyrBase ? ` (ZEPHYR_BASE=${inv.install.zephyrBase})` : '') + '\n';
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
    const args = ['flash', '-d', buildDir];

    // Flash runner is target-specific. nRF boards (xiao_ble) flash over J-Link
    // via nrfjprog; Espressif boards (esp32s3_devkitc / esp32*) flash over USB
    // via the esptool runner that the board's board.cmake selects by default.
    // Forcing --runner nrfjprog unconditionally broke ESP flashing.
    if (o.port) {
      if (board.startsWith('esp32')) {
        // esptool reads the device from --esp-device. Let board.cmake pick the
        // runner; just forward the port so COM5 (etc.) flashes the right device.
        args.push('--esp-device', o.port);
      } else {
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
    // Best-effort serial monitor. Zephyr's console output goes to UART/RTT;
    // for the XIAO nRF52840 the USB-CDC serial is the common path.
    const projectRoot = projectRootFromOptions(o);
    const port = o.port ?? '';
    const args = ['serial', ...(port ? ['--port', port] : [])];
    const inv = westSpawn(args, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    spawnSync(inv.command, inv.args, inv.options);
  },
};
