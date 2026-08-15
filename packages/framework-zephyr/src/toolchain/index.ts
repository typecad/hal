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
import { readdirSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import type { ToolchainOptions, CompileResult, UploadResult } from '@typecad/cuttlefish/api/shared';
import { parseCompileErrors } from '@typecad/cuttlefish/api/shared';
import { scaffoldZephyrProject, writeIfChanged } from './scaffold.js';
import { westSpawn, buildEnv } from './west-spawn.js';
import { discoverWest } from './west-discover.js';
import { writeDebugConfig, resolveDebugLocations } from './debug-config.js';
import { ZephyrStrategy } from '../strategy.js';
import { generateOverlay, type DisplayWiring, type TouchWiring } from '../dt-config/overlay.js';
import { chipForTarget } from '../chips/index.js';
import { detectZephyrVersion, checkZephyrCompat, resolveBoardTarget } from './compat.js';
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
 * Build the `west flash` argument list for a board.
 *
 * Runner selection: each board's board.cmake declares a sensible default flash
 * runner for its hardware (xiao_ble → nrfutil, esp32* → esptool), and `west
 * flash` resolves it automatically. The framework only intervenes where the
 * board default needs an argument it can't infer:
 *   - An explicit `zephyr.runner` (from cuttlefish.config.ts) always wins.
 *   - ESP32 boards forward the port via `--esp-device` (esptool reads the
 *     device from it); board.cmake still picks the runner.
 *   - Every other board trusts the board.cmake default. Previously this forced
 *     `--runner nrfjprog` for every non-ESP32 target, which broke boards whose
 *     default is not nrfjprog (xiao_ble defaults to nrfutil) and required
 *     Nordic J-Link tools that a USB-bootloader board does not have.
 *
 * Exported (pure) so the runner-selection contract is unit-testable without
 * spawning west.
 */
export function buildFlashArgs(
  buildDir: string,
  board: string,
  userRunner: string | undefined,
  port: string | undefined,
): string[] {
  const args = ['flash', '-d', buildDir];
  if (userRunner) {
    args.push('--runner', userRunner);
  }
  if (port && board.startsWith('esp32')) {
    args.push('--esp-device', port);
  }
  return args;
}

/**
 * Classify a `west flash` result as success/failure.
 *
 * west's exit status is authoritative except for one known race in the uf2
 * runner on Windows: the UF2 bootloader reboots to run new firmware the instant
 * the file copy completes, unmounting the USB-MSC drive before `shutil.copy`'s
 * trailing `copymode`/chmod runs. That raises `OSError: [WinError 433] A
 * device which does not exist was specified` and makes west exit non-zero —
 * even though the firmware copied and flashed correctly (the LED blinks).
 *
 * The copy starting is logged ("Copying UF2 file to '<drive>'"); WinError 433
 * during `copymode` after that point proves the data write finished and the
 * drive only vanished on the metadata step. Treat that exact signature as
 * success so the upload isn't reported as a failure. Genuine uf2 failures
 * (no partition found, write errors before the copy) still surface as failures.
 *
 * Exported (pure) so the classification is unit-testable without spawning west.
 */
export function classifyUploadResult(
  runner: string | undefined,
  status: number | null,
  output: string,
): boolean {
  if (status === 0) return true;
  if (isUf2DriveVanishRace(output)) return runner === 'uf2';
  return false;
}

/**
 * Whether `output` carries the benign UF2 copymode/WinError-433 race signature
 * (see classifyUploadResult). Centralized so classify + cleanse share one match.
 */
function isUf2DriveVanishRace(output: string): boolean {
  return /Copying UF2 file to/.test(output)
    && /WinError 433/.test(output)
    && /copymode/.test(output);
}

/**
 * Cleanse the `west flash` output shown to the user.
 *
 * When classifyUploadResult has decided a non-zero west exit was the benign UF2
 * race (firmware copied, drive unmounted on the trailing chmod), the raw output
 * is a wall of Python traceback that reads like a hard failure. Drop everything
 * after the "Copying UF2 file to" line — i.e. the entire traceback — so a
 * successful flash reads as a success (the framework's ✓ Done follows). Non-race
 * output is returned untouched; genuine errors stay fully visible for diagnosis.
 *
 * Exported (pure) so the cleansing is unit-testable without spawning west.
 */
export function cleanseUploadOutput(
  runner: string | undefined,
  status: number | null,
  output: string,
): string {
  if (status === 0) return output;
  if (runner === 'uf2' && isUf2DriveVanishRace(output)) {
    // Keep everything west printed up to and including "Copying UF2 file to",
    // then stop — everything after that is the drive-vanish traceback.
    const upto = output.match(/[\s\S]*Copying UF2 file to[^\n]*/);
    const head = upto ? upto[0] : '-- west flash: using runner uf2';
    return head;
  }
  return output;
}


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
    // Display usage tokens: the minimal GFX runtime (display_write/_fill_rect)
    // and the UI display adapter (display_init / __tc_display_dev /
    // DEVICE_DT_GET on the display nodelabel). Both paths need the DT overlay
    // to enable the display node.
    const usesDisplay = uses('display_write') || uses('display_init')
      || uses('display_fill_rect') || uses('__tc_display_dev')
      || uses('CuttlefishDisplayTarget');
    // Both registered Zephyr display profiles use dtLabel 'display0', so the
    // default profile's overlay block (&display0 { status="okay" }) is correct
    // for either driver. Thread a non-default profile here only if a future
    // board carries a display node under a different nodelabel.
    const displayProfile = usesDisplay ? DEFAULT_ZEPHYR_DISPLAY_PROFILE : undefined;
    // Touch controller kind comes from which DT nodelabel the emitted adapter
    // references (FT6336U on I2C, XPT2046 on the display's SPI bus).
    const usesTouch = uses('ft6336u') || uses('touch_');
    const usesXpt = uses('xpt2046');
    const overlay = generateOverlay(chip, {
      usesI2c: uses('i2c_'),
      usesSpi: uses('spi_'),
      usesUart: uses('uart_'),
      usesDisplay,
      usesTouch: usesTouch || usesXpt,
      touchController: usesXpt ? 'xpt2046' : 'ft6336u',
    }, displayProfile);
    const overlayDir = join(projectRoot, 'boards');
    mkdirSync(overlayDir, { recursive: true });
    writeIfChanged(join(overlayDir, `${board}.overlay`), overlay);
  },

  compile(o: ToolchainOptions): CompileResult {
    const projectRoot = projectRootFromOptions(o);
    const rawBoard = targetFromOptions(o);

    // Fail fast on an incompatible Zephyr (clear message vs. a cryptic west/
    // CMake board error), then normalize the board target for the installed
    // version — Zephyr 4.3+ rejects bare multi-core board names, so a stale
    // config (esp32s3_devkitc) is rewritten to the qualified form
    // (esp32s3_devkitc/esp32s3/procpu). See toolchain/compat.ts.
    const zephyrVersion = detectZephyrVersion();
    const compat = checkZephyrCompat(zephyrVersion);
    if (compat.status === 'out-of-range') {
      throw new Error(
        `Zephyr ${zephyrVersion} is outside the supported range (${compat.range}) for @typecad/framework-zephyr. ` +
        `Set ZEPHYR_BASE to a compatible Zephyr checkout, or install one via '@typecad/zephyr-installer'.`,
      );
    }
    if (compat.status === 'undetectable') {
      console.warn(
        `! Could not detect the installed Zephyr version (is ZEPHYR_BASE set?). ` +
        `Skipping compat check; declared range is ${compat.range}.`,
      );
    }
    const board = resolveBoardTarget(rawBoard, zephyrVersion);

    const debugMode = new ZephyrStrategy().debugMode(board);
    const isGdbDebug = o.debug === true && debugMode === 'gdb';
    const zc = o.zephyrConfig as Record<string, unknown> | undefined;
    const userKconfig = zc?.kconfig as Record<string, string> | undefined;
    const configChanged = scaffoldZephyrProject(projectRoot, isGdbDebug, userKconfig, o.psram);

    // Regenerate the DT overlay for the ACTUAL target board. prepare() writes
    // it for the default board (the real target is unknown until compile), so
    // the <default>.overlay it wrote does not match `west build -b <board>`.
    // Zephyr auto-detects boards/<board>.overlay under APPLICATION_CONFIG_DIR.
    try {
      const chip = chipForTarget(board);
      const srcDir = join(projectRoot, 'src');
      let src = '';
      try {
        for (const name of readdirSync(srcDir)) {
          if (name.endsWith('.cpp') || name.endsWith('.c')) {
            src += readFileSync(join(srcDir, name), 'utf-8');
          }
        }
      } catch { /* src may not exist */ }
      const uses = (t: string): boolean => src.includes(t);
      const usesDisplay = uses('display_write') || uses('display_init')
        || uses('display_fill_rect') || uses('__tc_display_dev')
        || uses('CuttlefishDisplayTarget');
      // Derive the display dimensions from the emitted adapter code
      // (display_width/height return the profile's w/h). This ensures the DT
      // overlay's width/height match the panel the adapter targets, not the
      // default profile — critical for drivers like ST7796S that initialize
      // the panel geometry from the DT node.
      let displayProfile = usesDisplay ? DEFAULT_ZEPHYR_DISPLAY_PROFILE : undefined;
      if (usesDisplay) {
        const wMatch = src.match(/display_width\(\)\s*\{\s*return\s+(\d+)\s*;\s*\}/);
        const hMatch = src.match(/display_height\(\)\s*\{\s*return\s+(\d+)\s*;\s*\}/);
        if (wMatch && hMatch) {
          displayProfile = {
            ...DEFAULT_ZEPHYR_DISPLAY_PROFILE,
            width: parseInt(wMatch[1], 10),
            height: parseInt(hMatch[1], 10),
          };
        }
      }
      // Extract display pin wiring (cs/dc/rst/spiFrequency/spiPins) from the
      // config display section so the DT overlay wires the MIPI DBI bridge to
      // the correct GPIOs + SPI bus pins.
      const dispCfg = o.display as Record<string, unknown> | undefined;
      const spiPins = (dispCfg?.spiPins ?? undefined) as
        { sck?: unknown; mosi?: unknown; miso?: unknown } | undefined;
      const wiring: DisplayWiring | undefined = dispCfg
        ? {
            cs: typeof dispCfg.cs === 'number' ? dispCfg.cs : undefined,
            dc: typeof dispCfg.dc === 'number' ? dispCfg.dc : undefined,
            rst: typeof dispCfg.rst === 'number' ? dispCfg.rst : undefined,
            spiFrequency: typeof dispCfg.spiFrequency === 'number' ? dispCfg.spiFrequency : undefined,
            sck: typeof spiPins?.sck === 'number' ? spiPins.sck : undefined,
            mosi: typeof spiPins?.mosi === 'number' ? spiPins.mosi : undefined,
            miso: typeof spiPins?.miso === 'number' ? spiPins.miso : undefined,
            backlightPin: typeof dispCfg.backlightPin === 'number' ? dispCfg.backlightPin : undefined,
          }
        : undefined;
      // Extract touch pin wiring from the config display.touch section so the
      // DT overlay wires the bus + touch node. I2C (FT6336U) carries
      // irq/resetPin/sda/scl; SPI (XPT2046) carries irq/cs + the calibration
      // range the xptek,xpt2046 binding requires.
      const touchCfg = dispCfg?.touch as Record<string, unknown> | undefined;
      const isXpt = touchCfg?.library === 'XPT2046_Touchscreen';
      const touchCal = touchCfg?.calibration as
        { xMin?: unknown; xMax?: unknown; yMin?: unknown; yMax?: unknown } | undefined;
      const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
      let touchWiring: TouchWiring | undefined = touchCfg
        ? {
            controller: isXpt ? 'xpt2046' : 'ft6336u',
            irq: num(touchCfg.irq),
            resetPin: num(touchCfg.resetPin),
            sda: num(touchCfg.sda),
            scl: num(touchCfg.scl),
            cs: num(touchCfg.cs),
            calibration: touchCal
              ? {
                  xMin: num(touchCal.xMin) ?? 0,
                  xMax: num(touchCal.xMax) ?? 4095,
                  yMin: num(touchCal.yMin) ?? 0,
                  yMax: num(touchCal.yMax) ?? 4095,
                }
              : undefined,
            minPressure: num(touchCfg.minPressure),
          }
        : undefined;
      // Touch controller kind for Kconfig (bus driver selection) and the DT
      // node shape: from the config when available, else from the DT nodelabel
      // the emitted adapter references. Forced onto touchWiring so a source
      // scan match without a config section still emits the right node.
      const usesXpt = isXpt || uses('xpt2046');
      if (usesXpt) {
        touchWiring = { controller: 'xpt2046', ...(touchWiring ?? {}) };
      }
      const overlay = generateOverlay(chip, {
        usesI2c: uses('i2c_'),
        usesSpi: uses('spi_'),
        usesUart: uses('uart_'),
        usesDisplay,
        usesTouch: uses('ft6336u') || uses('touch_') || usesXpt,
        touchController: usesXpt ? 'xpt2046' : 'ft6336u',
        psram: o.psram,
      }, displayProfile, wiring, touchWiring);
      const overlayDir = join(projectRoot, 'boards');
      mkdirSync(overlayDir, { recursive: true });
      // Write the board-specific overlay (the one west loads). Zephyr looks for
      // boards/<board_id>.overlay under APPLICATION_CONFIG_DIR — use the bare
      // board id (before any hardware-qualifier suffix, e.g. 'esp32_devkitc'
      // not the full 'esp32_devkitc/esp32/procpu' target string).
      const boardId = board.split('/')[0];
      writeIfChanged(join(overlayDir, `${boardId}.overlay`), overlay);
    } catch { /* best-effort overlay regen; the build surfaces DT errors */ }

    // Use a stable build dir so incremental builds reuse the Ninja graph.
    // west defaults to <projectRoot>/build.
    const buildDir = join(projectRoot, 'build');

    // Nuke the build dir whenever a previous build exists. Zephyr's gen_offset
    // flow (offsets.h is generated FROM offsets.c.obj, while gen_offset.h makes
    // offsets.c include offsets.h) leaves a permanent `offsets.h ->
    // offsets.c.obj -> offsets.h` cycle in the .ninja_deps log after the first
    // incremental pass — ninja then fails every later build with `dependency
    // cycle` even when nothing changed. This is a known Zephyr-on-Windows
    // issue; the reliable fix is a pristine build dir per build. Also nukes
    // when prj.conf/CMakeLists/overlay changed, so Kconfig symbols and
    // generated headers never diverge from a cached graph.
    if (configChanged || existsSync(join(buildDir, 'zephyr', 'zephyr.bin'))) {
      try { rmSync(buildDir, { recursive: true, force: true }); } catch { /* may not exist */ }
    }

    const buildArgs = ['build', '-b', board, '-d', buildDir, projectRoot];
    // Explicitly pass the generated DT overlay. Zephyr's auto-detection of
    // boards/<board>.overlay fails for hardware-qualified targets (e.g.
    // esp32_devkitc/esp32/procpu) because the FILE_SUFFIX matching doesn't
    // resolve — passing -DDTC_OVERLAY_FILE forces it unconditionally.
    const boardId = board.split('/')[0];
    const overlayPath = join(projectRoot, 'boards', `${boardId}.overlay`);
    try {
      if (readFileSync(overlayPath, 'utf-8').length > 0) {
        // CMake parses backslashes as escapes — use forward slashes so the
        // Windows path survives the -D argument intact.
        buildArgs.push('--', `-DDTC_OVERLAY_FILE=${overlayPath.replace(/\\/g, '/')}`);
      }
    } catch { /* no overlay — let Zephyr auto-detect or build without one */ }
    // Append user cmake args from cuttlefish.config.ts zephyr.cmakeArgs.
    const userCmakeArgs = zc?.cmakeArgs as string[] | undefined;
    if (userCmakeArgs && userCmakeArgs.length > 0) {
      if (!buildArgs.includes('--')) buildArgs.push('--');
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
    const runner = zc?.runner as string | undefined;
    const args = buildFlashArgs(buildDir, board, runner, o.port);

    const inv = westSpawn(args, {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: FLASH_TIMEOUT_MS,
    });
    const result = spawnSync(inv.command, inv.args, inv.options);

    const fstdout = typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString() ?? '');
    const fstderr = typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString() ?? '');
    const raw = fstdout + fstderr;
    return {
      success: classifyUploadResult(runner, result.status, raw),
      output: cleanseUploadOutput(runner, result.status, raw),
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
