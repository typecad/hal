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
import { scaffoldZephyrProject, writeIfChanged, appendLibraryOverlayFragments } from './scaffold.js';
import { westSpawn, buildEnv } from './west-spawn.js';
import { discoverWest } from './west-discover.js';
import { writeDebugConfig, resolveDebugLocations } from './debug-config.js';
import { bossacTouchReset } from './bossac-touch.js';
import { ZephyrStrategy } from '../strategy.js';
import { generateOverlay, type DisplayWiring, type TouchWiring, type OverlayDiagnostic } from '../dt-config/overlay.js';
import { generateCustomBoard } from '../dt-config/custom-board.js';
import { chipForTarget } from '../chips/index.js';
import { resolveChipFromBoard } from '../chips/resolve.js';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { pwmDtAliasToken } from '../lowering/pwm.js';
import { detectZephyrVersion, checkZephyrCompat, resolveBoardTarget } from './compat.js';
import { DEFAULT_ZEPHYR_DISPLAY_PROFILE } from '../display/profiles.js';

/** Default board target — the framework's MVP canonical board. */
const DEFAULT_BOARD = 'xiao_ble';

/**
 * Resolve the chip for a build the same way the strategy does at emit time —
 * from the board constants the transpile persisted next to the emitted
 * source (`board-constants.json`), falling back to the hardcoded registry.
 * Board-package chips (rpi_pico, esp32c3/c6, blackpill) exist only in their
 * board packages; the registry fallback would silently resolve them to the
 * XIAO default and the overlay generator would emit wrong controller labels
 * (e.g. `&uart0` on an STM32, whose node is `usart1`).
 */
function chipForBuild(projectRoot: string, board: string): ZephyrChipDescriptor {
  try {
    // The transpile writes the constants into the emit outDir, which is
    // <projectRoot>/src for the standard layout (basename 'src' collapsed by
    // projectRootFromOptions); check both locations.
    const bcPath = [join(projectRoot, 'src', 'board-constants.json'), join(projectRoot, 'board-constants.json')]
      .find(p => existsSync(p));
    if (bcPath) {
      const raw = JSON.parse(readFileSync(bcPath, 'utf8')) as Record<string, string | number | boolean>;
      const fromBoard = resolveChipFromBoard(new Map(Object.entries(raw)));
      if (fromBoard) return fromBoard;
    }
  } catch { /* fall back to the registry below */ }
  return chipForTarget(board);
}

/**
 * HAL pins the emitted sources read via adc.* — scanned from the emitted
 * `__tc_adc<N>_setup()` call sites (N = channel index, mapped back to the HAL
 * pin via the chip descriptor). Feeds the overlay's ADC pinctrl rewrite: on
 * SoCs that mux ADC pads via pinctrl (STM32), only the read channels are
 * switched to analog mode.
 */
function scanAdcReadPins(src: string, chip: ZephyrChipDescriptor): number[] {
  const pins: number[] = [];
  // Match CALL SITES only (`__tc_adc<N>_setup()` with empty parens) — the
  // setup definitions emitted by adcInitLines have a `(void)` parameter list
  // and would otherwise mark every descriptor channel as used.
  for (const m of src.matchAll(/__tc_adc(\d+)_setup\(\)/g)) {
    const ch = Number(m[1]);
    const c = chip.adc?.channels.find((x) => x.channel === ch);
    if (c && !pins.includes(c.pin)) pins.push(c.pin);
  }
  return pins;
}

/**
 * HAL pins the emitted sources drive with pwm.* — the emitted source
 * references each used spec as `__tc_pwm_<alias token>` (pwmVarName in
 * lowering/pwm.ts), and the lowering only emits specs for driven pins, so
 * var-presence is the authoritative signal. Feeds the overlay's per-pin
 * pwm-leds gating (no dead DT channels).
 */
function scanPwmUsedPins(src: string, chip: ZephyrChipDescriptor): number[] {
  return (chip.pwm?.specs ?? [])
    .filter((s) => src.includes(`__tc_pwm_${pwmDtAliasToken(s)}`))
    .map((s) => s.pin);
}

/**
 * Bus controller indexes the emitted sources actually reference — the shim
 * declares one `__tc_<bus><N>_dev` state block per used instance (gated by
 * collectUsedBusIndices at transpile time), so var-presence is the
 * authoritative signal. The overlay enables only these controllers: an
 * enabled-but-unused one claims its default pins (i2c0's GP4/GP5 on the
 * Pico) which a program driving the OTHER controller may want as GPIO.
 * Empty list (no state blocks — e.g. display/touch composites that use the
 * driver API directly) means "no signal"; the caller then passes undefined
 * so the overlay enables every declared controller, preserving old behavior.
 */
function scanUsedBusInstances(
  src: string,
  controllers: readonly { nodeLabel: string }[] | undefined,
  bus: 'i2c' | 'spi' | 'uart',
): number[] | undefined {
  if (!controllers) return undefined;
  const used: number[] = [];
  for (let i = 0; i < controllers.length; i++) {
    if (src.includes(`__tc_${bus}${i}_dev`)) used.push(i);
  }
  return used.length > 0 ? used : undefined;
}

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
/**
 * Resolve HOW this build attaches to the board for flashing OR debugging:
 * the friendly `zephyr.probe` id from the board's probeMethods table (quirks
 * included), or the raw `zephyr.runner` escape hatch. Exported (pure) so the
 * selection contract is unit-testable without spawning west.
 *
 * Rules:
 * - `probe` + `runner` together is an error (two ways of saying it — pick one).
 * - An unknown `probe` id is an error listing what the board supports; a board
 *   with no probeMethods table gets a hint to use `runner` directly.
 * - purpose 'debug': the chosen method must be debug-capable (`debug` is not
 *   false — a bootloader is not a debugger). Non-capable or unknown ids list
 *   the debug-capable methods.
 * - User `runnerArgs` are appended AFTER the method's args, so they can
 *   override the method's baked-in flags (argparse takes the last value).
 */
export type ProbeResolution =
  | { ok: true; runner?: string; args: string[] }
  | { ok: false; error: string };

export function resolveProbeMethod(
  zc: Record<string, unknown> | undefined,
  chip: ZephyrChipDescriptor,
  purpose: 'flash' | 'debug' = 'flash',
): ProbeResolution {
  const probe = zc?.probe as string | undefined;
  const runner = zc?.runner as string | undefined;
  const userArgs = (zc?.runnerArgs as string[] | undefined) ?? [];

  if (probe && runner) {
    return {
      ok: false,
      error:
        `cuttlefish.config.ts sets both zephyr.probe ('${probe}') and zephyr.runner ('${runner}'). ` +
        `They are two ways to choose the probe method — remove one.`,
    };
  }

  if (probe) {
    const methods = chip.probeMethods ?? [];
    const method = methods.find((m) => m.id === probe);
    if (!method) {
      const listAll = methods
        .map((m) => `${m.id} (${m.runner}${m.description ? ` — ${m.description}` : ''})`)
        .join('; ');
      return {
        ok: false,
        error: methods.length > 0
          ? `Unknown probe method '${probe}' for ${chip.id}. Supported: ${listAll}.`
          : `This board (${chip.id}) ships no probe-method table, so 'zephyr.probe' cannot resolve '${probe}'. ` +
            `Use the raw 'zephyr.runner' field instead (run 'west flash --context' in the build dir for options).`,
      };
    }
    if (purpose === 'debug' && method.debug === false) {
      const debuggable = methods.filter((m) => m.debug !== false).map((m) => m.id).join(', ');
      return {
        ok: false,
        error:
          `The '${probe}' method cannot debug ${chip.id} — a bootloader is not a debugger. ` +
          `Debug-capable methods: ${debuggable || '(none — this board needs an external probe)'}.`,
      };
    }
    return {
      ok: true,
      runner: method.runner,
      args: [...(method.args ?? []), ...userArgs],
    };
  }

  return { ok: true, runner, args: userArgs };
}

export function buildFlashArgs(
  buildDir: string,
  board: string,
  userRunner: string | undefined,
  port: string | undefined,
  runnerArgs?: readonly string[],
): string[] {
  const args = ['flash', '-d', buildDir];
  if (userRunner) {
    args.push('--runner', userRunner);
  }
  if (port && board.startsWith('esp32')) {
    args.push('--esp-device', port);
  }
  // The bossac runner defaults its port to /dev/ttyACM0 — on Windows that
  // never matches, so the port MUST be forwarded or bossac fails with
  // "No device found on /dev/ttyACM0" (same class of problem as the ESP32
  // --esp-device forwarding above).
  if (port && userRunner === 'bossac') {
    args.push('--bossac-port', port);
  }
  // Extra runner-specific flags, appended verbatim (west's runner parsers
  // accept them after the runner is selected).
  if (runnerArgs && runnerArgs.length > 0) {
    args.push(...runnerArgs);
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
 * Whether a failed `west build` output carries ninja's `dependency cycle`
 * signature. Zephyr 4.3.99-dev snapshots have a regression
 * (zephyrproject-rtos/zephyr#104757, fixed upstream by the #104784 revert,
 * in v4.4+): after CMake re-runs from a .config change, the build dir's
 * .ninja_deps records an `offsets.h -> offsets.c.obj -> offsets.h` cycle and
 * ninja aborts with `ninja: error: dependency cycle: ...` before compiling
 * anything. The cycle lives in the build dir, not the sources, so compile()
 * recovers by deleting the dir and retrying once.
 *
 * Exported (pure) so the detection is unit-testable without spawning west.
 */
export function isDependencyCycleFailure(output: string): boolean {
  return output.includes('dependency cycle');
}

/** stdout+stderr of a spawnSync result coerced to one string. Defensive about
 *  the buffer form (spawnSync only returns strings when `encoding` is set,
 *  which every call site here does — but the coercion costs nothing). */
function combinedSpawnOutput(
  result: { stdout?: string | Buffer | null; stderr?: string | Buffer | null },
): string {
  const so = typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString() ?? '');
  const se = typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString() ?? '');
  return so + se;
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
    const chip = chipForBuild(projectRoot, board);
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
      // __tc_<bus> matches the shim state block — a begin()-only program
      // emits no driver API call but still declares the DT device.
      usesI2c: uses('i2c_') || uses('__tc_i2c'),
      usesSpi: uses('spi_') || uses('__tc_spi'),
      usesUart: uses('uart_') || uses('__tc_uart'),
      usesUsb: uses('__tc_usb'),
      usesPwm: uses('pwm_'),
      usesAdc: uses('adc_'),
      adcReadPins: scanAdcReadPins(src, chip),
      pwmUsedPins: scanPwmUsedPins(src, chip),
      i2cUsedInstances: scanUsedBusInstances(src, chip.i2c?.controllers, 'i2c'),
      spiUsedInstances: scanUsedBusInstances(src, chip.spi?.controllers, 'spi'),
      uartUsedInstances: scanUsedBusInstances(src, chip.uart?.controllers, 'uart'),
      // Preferences/FS — same tokens scaffoldZephyrProject scans (the ZMS
      // settings_* API + __tc_prefs shim, the __tc_fs mount shim); drive the
      // storage-partition synthesis + /chosen settings pointer.
      usesPreferences: uses('settings_') || uses('__tc_prefs'),
      usesFS: uses('__tc_fs'),
      usesWdt: uses('wdt_'),
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
    // console.output from cuttlefish.config.ts's console section: 'usb' routes
    // console.log (printk) onto the CDC serial port.
    const cc = o.consoleConfig as { output?: 'default' | 'usb' } | undefined;
    const consoleOutput = cc?.output === 'usb' ? 'usb' as const : undefined;
    const configChanged = scaffoldZephyrProject(projectRoot, isGdbDebug, userKconfig, o.psram, consoleOutput);

    // Regenerate the DT overlay for the ACTUAL target board. prepare() writes
    // it for the default board (the real target is unknown until compile), so
    // the <default>.overlay it wrote does not match `west build -b <board>`.
    // Zephyr auto-detects boards/<board>.overlay under APPLICATION_CONFIG_DIR.
    try {
      const chip = chipForBuild(projectRoot, board);
      // Custom-board generation: an MCU-only target (no board package) has no
      // upstream Zephyr board — generate one under boards/typecad/<name>/ from
      // the chip's silicon data. Opt-in via `zephyr.customBoard: true` in
      // cuttlefish.config.ts; the board takes its name from the build target.
      // Idempotent — regenerated on every compile, before the overlay pass.
      if (zc?.customBoard === true) {
        const generated = generateCustomBoard(projectRoot, chip, board.split('/')[0]);
        if (!generated) {
          throw new Error(
            `zephyr.customBoard is set, but the resolved chip ('${chip.id}') carries no ` +
            `silicon board data. Custom-board generation requires an MCU-only config ` +
            `(mcu set, board absent) whose MCU package ships a zephyr block.`,
          );
        }
      }
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
            tearingEffectPin: typeof dispCfg.tearingEffectPin === 'number' ? dispCfg.tearingEffectPin : undefined,
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
      const overlayDiagnostics: OverlayDiagnostic[] = [];
      if (consoleOutput === 'usb' && !chip.usb) {
        overlayDiagnostics.push({
          severity: 'warning',
          message: `console.output: 'usb' is set, but this board's chip data declares no USB device (zephyr.usb) — console.log stays on the board's default console.`,
        });
      }
      // Console destination note: console.log's target is per-board and
      // invisible in the code — state it once per compile so it is never a
      // mystery where the output went (printk is what console.log lowers to).
      if (uses('printk(')) {
        const dest = consoleOutput === 'usb' && chip.usb
          ? 'USB CDC serial (the USB connector)'
          : (chip.consoleDescription ?? "the board's default console (its devicetree zephyr,console node)");
        console.log(`i console.log -> printk -> ${dest} on this board`);
      }
      const overlay = generateOverlay(chip, {
        // __tc_<bus> matches the shim state block — a begin()-only program
        // emits no driver API call but still declares the DT device.
        usesI2c: uses('i2c_') || uses('__tc_i2c'),
        usesSpi: uses('spi_') || uses('__tc_spi'),
        usesUart: uses('uart_') || uses('__tc_uart'),
        usesUsb: uses('__tc_usb'),
        usesPwm: uses('pwm_'),
        usesAdc: uses('adc_'),
        adcReadPins: scanAdcReadPins(src, chip),
        pwmUsedPins: scanPwmUsedPins(src, chip),
        i2cUsedInstances: scanUsedBusInstances(src, chip.i2c?.controllers, 'i2c'),
        spiUsedInstances: scanUsedBusInstances(src, chip.spi?.controllers, 'spi'),
        uartUsedInstances: scanUsedBusInstances(src, chip.uart?.controllers, 'uart'),
        // Preferences/FS — same tokens scaffoldZephyrProject scans; drive the
        // storage-partition synthesis + /chosen settings pointer.
        usesPreferences: uses('settings_') || uses('__tc_prefs'),
        usesWdt: uses('wdt_'),
        usesFS: uses('__tc_fs'),
        usesDisplay,
        usesTouch: uses('ft6336u') || uses('touch_') || usesXpt,
        touchController: usesXpt ? 'xpt2046' : 'ft6336u',
        psram: o.psram,
        consoleOutput,
      }, displayProfile, wiring, touchWiring, overlayDiagnostics);
      for (const d of overlayDiagnostics) {
        console.warn(`overlay: ${d.message}`);
      }
      const overlayDir = join(projectRoot, 'boards');
      mkdirSync(overlayDir, { recursive: true });
      // Write the board-specific overlay (the one west loads). Zephyr looks for
      // boards/<board_id>.overlay under APPLICATION_CONFIG_DIR — use the bare
      // board id (before any hardware-qualifier suffix, e.g. 'esp32_devkitc'
      // not the full 'esp32_devkitc/esp32/procpu' target string). Library
      // packages' overlay fragments are appended by the scaffold helper.
      const boardId = board.split('/')[0];
      writeIfChanged(
        join(overlayDir, `${boardId}.overlay`),
        appendLibraryOverlayFragments(overlay, projectRoot),
      );
    } catch { /* best-effort overlay regen; the build surfaces DT errors */ }

    // Use a stable build dir so incremental builds reuse the Ninja graph.
    // west defaults to <projectRoot>/build.
    const buildDir = join(projectRoot, 'build');

    // Reuse the build dir across builds so ninja recompiles only the changed
    // app translation units and re-links — a pristine configure + the
    // ~280-target Zephyr library rebuild costs minutes on Windows
    // (demo-shadcn measures 69s of ninja wall time, 448s of summed compile
    // work, and every build redid all of it). Nuke it only when the generated
    // config changed (prj.conf / CMakeLists content), the one path that must
    // not reuse a cached graph: Zephyr 4.3.99-dev snapshots carry a
    // regression (zephyrproject-rtos/zephyr#104757, fixed by the #104784
    // revert on 2026-03-03, in v4.4+) where re-running CMake after a .config
    // change records an `offsets.h -> offsets.c.obj -> offsets.h` cycle in
    // .ninja_deps, after which every ninja run fails with `dependency cycle`.
    // Plain source edits never reconfigure CMake, so they cannot trigger it —
    // and the retry after the spawn below self-heals any path that still does.
    // Board switches need no nuke here: `west build` is --pristine=auto by
    // default and recreates the dir itself when -b <board> mismatches the
    // cached board.
    if (configChanged) {
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
    let result = spawnSync(inv.command, inv.args, inv.options);
    // Self-heal the Zephyr 4.3.99 dep-cycle regression (see the nuke comment
    // above): when the cached .ninja_deps carries the cycle, ninja aborts with
    // `dependency cycle` before compiling anything. The cycle lives in the
    // build dir, not the sources — one pristine retry clears it and the build
    // proceeds. On fixed Zephyr (>=4.4) this never fires.
    let pristineRetry = false;
    if (result.status !== 0 && isDependencyCycleFailure(combinedSpawnOutput(result))) {
      try { rmSync(buildDir, { recursive: true, force: true }); } catch { /* may not exist */ }
      result = spawnSync(inv.command, inv.args, inv.options);
      pristineRetry = true;
    }

    const stdout = typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString() ?? '');
    const stderr = typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString() ?? '');
    const output = stdout + stderr + (pristineRetry
      ? '\n[cuttlefish] dependency cycle detected in the cached build dir — retried with a pristine build'
      : '');
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
    const chip = chipForBuild(projectRoot, board);
    const probe = resolveProbeMethod(zc, chip, 'flash');
    if (!probe.ok) {
      return { success: false, output: `-- west flash: ${probe.error}` };
    }
    // BOSSA bootloader boards with touch-reset data: open the app's console
    // port at 1200 baud (the firmware's USB shim reboots into the
    // bootloader), wait for the bootloader identity, and flash THAT port.
    // Falls back to the configured port (manual double-tap) on any failure.
    let flashPort = o.port;
    const flashNotes: string[] = [];
    if (probe.runner === 'bossac' && flashPort && chip.usb?.touchReset) {
      const touch = bossacTouchReset(flashPort, chip.usb.touchReset);
      flashNotes.push(`-- ${touch.note}`);
      if (touch.port) flashPort = touch.port;
    }
    const args = buildFlashArgs(buildDir, board, probe.runner, flashPort, probe.args);

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
      success: classifyUploadResult(probe.runner, result.status, raw),
      output: [...flashNotes, cleanseUploadOutput(probe.runner, result.status, raw)]
        .filter(Boolean).join('\n'),
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
    // Launch an interactive GDB session for the last build. The probe method
    // resolves exactly like flashing (zephyr.probe / zephyr.runner — the same
    // attach session, so the same quirks apply); debug-incapable methods
    // (bootloaders) are rejected with the debug-capable list. west debug
    // resolves the GDB binary from the build dir's CMakeCache — no
    // hand-authored gdbinit needed. Inherits stdio so GDB runs interactively.
    const projectRoot = projectRootFromOptions(o);
    const buildDir = join(projectRoot, 'build');
    const board = targetFromOptions(o);
    const zc = o.zephyrConfig as Record<string, unknown> | undefined;
    const probe = resolveProbeMethod(zc, chipForBuild(projectRoot, board), 'debug');
    if (!probe.ok) {
      console.error(`-- west debug: ${probe.error}`);
      process.exitCode = 1;
      return;
    }
    const debugArgs = ['debug', '-d', buildDir];
    if (probe.runner) debugArgs.push('--runner', probe.runner);
    debugArgs.push(...probe.args);
    const inv = westSpawn(debugArgs, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    spawnSync(inv.command, inv.args, inv.options);
  },
};
