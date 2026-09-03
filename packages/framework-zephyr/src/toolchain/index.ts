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
import { readdirSync, readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import type { ToolchainOptions, CompileResult, UploadResult } from '@typecad/cuttlefish/api/shared';
import { parseCompileErrors } from '@typecad/cuttlefish/api/shared';
import { scaffoldZephyrProject, writeIfChanged, appendLibraryOverlayFragments } from './scaffold.js';
import { parseZephyrDts, asBuiltJson } from '../as-built.js';
import { westSpawn, buildEnv } from './west-spawn.js';
import { discoverWest } from './west-discover.js';
import { writeDebugConfig, resolveDebugLocations } from './debug-config.js';
import { bossacTouchReset } from './bossac-touch.js';
import { ZephyrStrategy } from '../strategy.js';
import { generateOverlay, type DisplayWiring, type TouchWiring, type OverlayDiagnostic } from '../dt-config/overlay.js';
import { generateCustomBoard } from '../dt-config/custom-board.js';
import { NO_BOARD_CHIP } from '../chips/index.js';
import { resolveChipFromBoard } from '../chips/resolve.js';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { pwmDtAliasToken } from '../lowering/pwm.js';
import { detectZephyrVersion, checkZephyrCompat, resolveBoardTarget } from './compat.js';
import { DEFAULT_ZEPHYR_DISPLAY_PROFILE } from '../display/profiles.js';

/**
 * Resolve the chip for a build the same way the strategy does at emit time —
 * from the board constants the transpile persisted next to the emitted
 * source (`board-constants.json`). There is no registry fallback: a build
 * whose constants did not persist stays NO_BOARD_CHIP, exactly like the
 * emit-time path.
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
      const bc = new Map(Object.entries(raw));
      const fromBoard = resolveChipFromBoard(bc);
      if (fromBoard) return fromBoard;
    }
  } catch { /* constants unreadable — no board resolved */ }
  return NO_BOARD_CHIP;
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
  // Two used-signal forms:
  //  - `__tc_adc<N>_setup()` / `__tc_adc_<ctrl>_<N>_setup()` CALL SITES
  //    (empty parens — the adcInitLines definitions have `(void)` and would
  //    otherwise mark every descriptor channel as used).
  //  - `__tc_adct<pin>_done` lazy-guard vars — the thin-ADC read lowering's
  //    inline setup (families without pinctrl groups, e.g. ESP32 SARADC,
  //    never emit the setup-function form at all).
  // Channel indices are unique per CONTROLLER, so the labeled form resolves
  // (controller, channel) before mapping back to the HAL pin.
  for (const m of src.matchAll(/__tc_adc(?:(\w+?)_)?(\d+)_setup\(\)/g)) {
    const ch = Number(m[2]);
    const label = m[1];
    const c = chip.adc?.channels.find(
      (x) => x.channel === ch && (x.controller ?? chip.adc?.nodeLabel) === (label ?? chip.adc?.nodeLabel),
    );
    if (c && !pins.includes(c.pin)) pins.push(c.pin);
  }
  for (const m of src.matchAll(/__tc_adct(\d+)_done/g)) {
    const pin = Number(m[1]);
    if (chip.adc?.channels.some((x) => x.pin === pin) && !pins.includes(pin)) pins.push(pin);
  }
  return pins;
}

/**
 * HAL pins the emitted sources drive with dac.* — the DAC lowering's lazy
 * per-pin setup guard is `__tc_dact<pin>_done` (lowering/dac.ts), so
 * var-presence is the authoritative used-signal. Feeds the overlay's DAC
 * pinctrl gating (same pattern as scanAdcReadPins).
 */
function scanDacWritePins(src: string): number[] {
  const pins: number[] = [];
  for (const m of src.matchAll(/__tc_dact(\d+)_done/g)) {
    const pin = Number(m[1]);
    if (!pins.includes(pin)) pins.push(pin);
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
/**
 * Inline-override markers (the escape hatch): the adc/pwm lowerings emit
 * `/* cuttlefish-user-facts: <kind> pin=N [device=X] [pinctrl=P] channel=C *​/`
 * comments when a construction carries routing overrides. Merged into the
 * chip so the overlay synthesis + used-pin scans treat them as facts —
 * the transpiler cannot create DT nodes, but this regen can.
 */
function applyUserFactMarkers(chip: ZephyrChipDescriptor, src: string): ZephyrChipDescriptor {
  const adcAdds: { pin: number; channel: number; controller?: string; pinctrl?: string }[] = [];
  const pwmAdds: { pin: number; controller: string; channel: number }[] = [];
  for (const m of src.matchAll(/\/\* cuttlefish-user-facts: (adc|pwm) ([^*]*?) \*\//g)) {
    const kind = m[1];
    const fields = new Map<string, string>();
    for (const kv of m[2]!.split(/\s+/).filter(Boolean)) {
      const eq = kv.indexOf('=');
      if (eq > 0) fields.set(kv.slice(0, eq), kv.slice(eq + 1));
    }
    const pin = Number(fields.get('pin'));
    const channel = Number(fields.get('channel'));
    if (!Number.isFinite(pin) || !Number.isFinite(channel)) continue;
    if (kind === 'adc') {
      adcAdds.push({
        pin,
        channel,
        ...(fields.get('device') ? { controller: fields.get('device') } : {}),
        ...(fields.get('pinctrl') ? { pinctrl: fields.get('pinctrl') } : {}),
      });
    } else if (fields.get('controller')) {
      pwmAdds.push({ pin, channel, controller: fields.get('controller')! });
    }
  }
  if (adcAdds.length === 0 && pwmAdds.length === 0) return chip;
  const adc = chip.adc
    ? chip.adc
    : { nodeLabel: adcAdds.find((a) => !a.controller)?.controller ?? 'adc', resolution: 12, vrefMv: 3000, channels: [] };
  const adcChannels = [...adc.channels];
  for (const a of adcAdds) {
    const existing = adcChannels.findIndex((c) => c.pin === a.pin);
    if (existing >= 0) adcChannels.splice(existing, 1);
    adcChannels.push({ pin: a.pin, channel: a.channel, ...(a.controller ? { controller: a.controller } : {}), ...(a.pinctrl ? { pinctrl: a.pinctrl } : {}) });
  }
  const pwmSpecs = [...(chip.pwm?.specs ?? [])];
  for (const p of pwmAdds) {
    const existing = pwmSpecs.findIndex((s) => s.pin === p.pin);
    if (existing >= 0) pwmSpecs.splice(existing, 1);
    pwmSpecs.push({ pin: p.pin, controller: p.controller, channel: p.channel });
  }
  return {
    ...chip,
    adc: { ...adc, channels: adcChannels },
    pwm: { ...(chip.pwm ?? { specs: [] }), specs: pwmSpecs },
  };
}

function scanPwmUsedPins(src: string, chip: ZephyrChipDescriptor): number[] {  const pins = (chip.pwm?.specs ?? [])
    .filter((s) => src.includes(`__tc_pwm_${pwmDtAliasToken(s)}`))
    .map((s) => s.pin);
  // Matrix pins (ESP32 LEDC) have no static specs — recover the driven pins
  // from the same alias-var presence signal (`__tc_pwm_tc_pwm<N>`), keeping
  // only pins the descriptor's matrix allows (the regex grabs the full
  // number, so pin 4 never matches a reference to pin 45).
  const matrix = chip.pwm?.matrix;
  if (matrix) {
    const present = new Set<number>();
    for (const match of src.matchAll(/__tc_pwm_tc_pwm(\d+)/g)) {
      present.add(Number(match[1]));
    }
    for (const pin of matrix.pins) {
      if (present.has(pin)) pins.push(pin);
    }
  }
  return pins;
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

/**
 * Distinct DT-bound sensors the emitted sources reference — the lowering's
 * state blocks name each one `__tc_sensor_<part>_i2c<N>_0x<addr>_dev`
 * (lowering/sensor.ts sensorNames), so var-presence is the authoritative
 * signal. Feeds the overlay's DT child nodes; the part group is greedy so a
 * compatible containing '_i2c<N>_' still resolves to the longest part match.
 */
export interface ScannedSensorPart {
  part: string; busIndex: number; port: number; busKind: 'i2c' | 'spi';
  spiHz: number; spiMode: number; alertPin: number;
}

export interface ScannedSpiTarget {
  busIndex: number; cs: number; hz: number; mode: number;
}

/** Scan the emitted source for thin SPI targets (hal/spi-target.ts): the
 *  spi_dt_spec state block's tc-spit-cfg comment carries the construction
 *  facts, the same channel tc-sensor-cfg uses. */
export function scanSpiTargets(src: string): ScannedSpiTarget[] {
  const out = new Map<string, ScannedSpiTarget>();
  for (const m of src.matchAll(/tc-spit-cfg: tc_spit_spi(\d+)_cs(\d+) hz=(\d+) mode=(\d+)/g)) {
    const ref: ScannedSpiTarget = { busIndex: parseInt(m[1], 10), cs: parseInt(m[2], 10), hz: parseInt(m[3], 10), mode: parseInt(m[4], 10) };
    out.set(`${ref.busIndex}|${ref.cs}`, ref);
  }
  return [...out.values()];
}

export function scanSensorParts(src: string): ScannedSensorPart[] {
  const out = new Map<string, ScannedSensorPart>();
  for (const m of src.matchAll(/__tc_sensor_([a-z0-9_]+)_(i2c|spi)(\d+)_(0x[0-9a-f]+|cs[0-9]+)_dev\b/g)) {
    const port = m[4].startsWith('0x') ? parseInt(m[4], 16) : parseInt(m[4].slice(2), 10);
    const ref: ScannedSensorPart = { part: m[1], busIndex: parseInt(m[3], 10), port, busKind: m[2] as 'i2c' | 'spi', spiHz: 0, spiMode: 0, alertPin: -1 };
    out.set(`${ref.part}|${ref.busKind}${ref.busIndex}|${ref.port}`, ref);
  }
  // Construction facts ride the state block's config comment — merge by
  // nodelabel so the scanner stays the single source for the overlay.
  for (const m of src.matchAll(/tc-sensor-cfg: tc_([a-z0-9_]+)_(i2c|spi)(\d+)_(0x[0-9a-f]+|cs[0-9]+) hz=(\d+) mode=(\d+) alert=(-?\d+)/g)) {
    const port = m[4].startsWith('0x') ? parseInt(m[4], 16) : parseInt(m[4].slice(2), 10);
    const key = `${m[1]}|${m[2]}${m[3]}|${port}`;
    const existing = out.get(key);
    if (existing) {
      existing.spiHz = parseInt(m[5], 10);
      existing.spiMode = parseInt(m[6], 10);
      existing.alertPin = parseInt(m[7], 10);
    }
  }
  return [...out.values()];
}

function targetFromOptions(o: ToolchainOptions): string {
  // The cuttlefish CLI populates ToolchainOptions.buildTarget from the
  // config's board: (frameworkData.buildTarget for board-less projects).
  // Accept frameworkData.target as an alias. No silent default: building for
  // a wrong hard-coded board is the split-brain trap.
  const fcTarget = (o.frameworkConfig?.target as string | undefined);
  const board = (o.buildTarget as string | undefined) ?? fcTarget;
  if (!board) {
    throw new Error(
      'No build target: set board: in cuttlefish.config.ts (or frameworkData.buildTarget for custom-board projects).',
    );
  }
  return board;
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

/**
 * Run an openocd session against the board's probe config — the shared
 * engine for the pre-flash quiesce and the post-flash SYSRESETREQ (see the
 * call sites in upload()). The config is the probe method's verbatim
 * debugCfg from the board catalog (the same lines `west debug` uses);
 * `commands` are appended after `-f <cfg> -c init`. Returns a flash note on
 * success, undefined when skipped or failed (best-effort by design).
 */
function openocdProbeSession(
  buildDir: string,
  zc: Record<string, unknown> | undefined,
  chip: ZephyrChipDescriptor,
  commands: readonly string[],
): string | undefined {
  // Config resolution — two sources, in order:
  //   1. The named probe method's verbatim debugCfg from the board catalog
  //      (written to a temp cfg), when zephyr.probe names a method that has
  //      one.
  //   2. The board's own support/openocd.cfg in the Zephyr tree — the exact
  //      config `west flash` resolves for the openocd runner. This covers
  //      raw `zephyr.runner: 'openocd'` (no named probe) and probe methods
  //      that ship no debugCfg of their own.
  const probeId = zc?.probe as string | undefined;
  const method = chip.probeMethods?.find((m) => m.id === probeId);
  const cfgLines = method?.debugCfg;

  const install = discoverWest();
  const sdkRoot = process.env.ZEPHYR_SDK_INSTALL_DIR || install?.sdkInstallDir;
  if (!sdkRoot) return undefined;
  const openocdExe = join(sdkRoot, 'hosttools', 'openocd', 'bin',
    process.platform === 'win32' ? 'openocd.exe' : 'openocd');
  if (!existsSync(openocdExe)) return undefined;
  // Script search path: the SDK layouts differ across versions — prefer the
  // share/ form west's own runner uses, fall back to the scripts/ form.
  const shareScripts = join(sdkRoot, 'hosttools', 'openocd', 'share', 'openocd', 'scripts');
  const binScripts = join(sdkRoot, 'hosttools', 'openocd', 'scripts');
  const searchDir = existsSync(shareScripts) ? shareScripts : binScripts;

  let cfgArgs: string[] | undefined;
  let sessionCfg: string | undefined;
  if (cfgLines && cfgLines.length > 0) {
    sessionCfg = join(buildDir, 'cuttlefish-probe.cfg');
  } else {
    // The board target's qualifier ('blackpill_f411ce/stm32f411xe' →
    // 'blackpill_f411ce') identifies the board dir; the vendor segment is
    // not part of the target, so probe the boards/ tree for it.
    const zephyrBase = process.env.ZEPHYR_BASE || install?.zephyrBase;
    const boardDir = (chip.id ?? '').split('/')[0];
    if (!zephyrBase || !boardDir) return undefined;
    const boardsRoot = join(zephyrBase, 'boards');
    let supportCfg: string | undefined;
    try {
      for (const vendor of readdirSync(boardsRoot)) {
        const candidate = join(boardsRoot, vendor, boardDir, 'support', 'openocd.cfg');
        if (existsSync(candidate)) { supportCfg = candidate; break; }
      }
    } catch {
      return undefined;
    }
    if (!supportCfg) return undefined;
    cfgArgs = ['-s', dirname(supportCfg), '-f', supportCfg];
  }

  try {
    mkdirSync(buildDir, { recursive: true });
    if (sessionCfg) {
      writeFileSync(sessionCfg, cfgLines!.join('\n') + '\n', 'utf-8');
      cfgArgs = ['-f', sessionCfg];
    }
    const res = spawnSync(openocdExe, [
      '-s', searchDir, ...cfgArgs!,
      '-c', 'init',
      ...commands.map((c) => ['-c', c]).flat(),
      '-c', 'shutdown',
    ], {
      cwd: buildDir,
      encoding: 'utf-8' as const,
      timeout: 20_000,
    });
    return res.status === 0 ? `-- probe session ok: ${commands.join('; ')}` : undefined;
  } catch {
    return undefined;
  }
}

export function buildFlashArgs(
  buildDir: string,
  userRunner: string | undefined,
  port: string | undefined,
  flashRunner?: string,
  runnerArgs?: readonly string[],
): string[] {
  // flashRunner is the runner the flash will actually use — the explicit
  // zephyr.runner when set, else the board's declared default from its probe
  // table. It gates the esptool port forwarding below; only an EXPLICIT
  // userRunner forces west's --runner (board defaults stay board.cmake's
  // choice). Runner-gated, never board-name-gated: any board whose flash
  // runs esptool gets the same forwarding.
  const args = ['flash', '-d', buildDir];
  if (userRunner) {
    args.push('--runner', userRunner);
  }
  if (port && flashRunner === 'esptool') {
    args.push('--esp-device', port);
  }
  // The bossac runner defaults its port to /dev/ttyACM0 — on Windows that
  // never matches, so the port MUST be forwarded or bossac fails with
  // "No device found on /dev/ttyACM0" (same class of port-forwarding
  // problem as the esptool --esp-device above).
  if (port && flashRunner === 'bossac') {
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
    // Inline-override markers (the escape hatch): the lowerings emit
    // `cuttlefish-user-facts` comments carrying routing the transpiler
    // cannot synthesize (adc device/pinctrl, pwm controller/channel).
    // Merged into the chip BEFORE the scans + overlay generation, so the DT
    // nodes, pinctrl groups, and used-pin recovery treat them as facts.
    const chip = applyUserFactMarkers(chipForBuild(projectRoot, ''), src);
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
    const sensorParts = scanSensorParts(src);
    const spiTargetParts = scanSpiTargets(src);
    const overlay = generateOverlay(chip, {
      // __tc_<bus> matches the shim state block — a begin()-only program
      // emits no driver API call but still declares the DT device. A
      // constructed sensor is also a bus user (its device handle is the
      // only i2c reference a sensor-only program carries).
      usesI2c: uses('i2c_') || uses('__tc_i2c') || sensorParts.length > 0,
      usesSensor: uses('sensor_') || sensorParts.length > 0,
      usesFloatFormat: /%[-0-9.]*[eEfFgG]/.test(src),
      sensorParts,
      spiTargets: spiTargetParts,
      usesSpi: uses('spi_') || uses('__tc_spi') || spiTargetParts.length > 0,
      usesUart: uses('__tc_uart'),
      usesUsb: uses('__tc_usb'),
      usesPwm: uses('pwm_'),
      usesAdc: uses('adc_'),
      adcReadPins: scanAdcReadPins(src, chip),
      dacWritePins: scanDacWritePins(src),
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
      usesHwtimer: uses('counter_') || uses('__tc_hw'),
      usesDisplay,
      usesTouch: usesTouch || usesXpt,
      touchController: usesXpt ? 'xpt2046' : 'ft6336u',
    }, displayProfile);
    const overlayDir = join(projectRoot, 'boards');
    mkdirSync(overlayDir, { recursive: true });
    // prepare() runs before the real target is known — the placeholder name
    // never matches `west build -b <board>` (compile rewrites the overlay
    // under the actual board's name below).
    writeIfChanged(join(overlayDir, 'board.overlay'), overlay);
    // Thin SPI targets need an app-local binding: a compatible-less DT node
    // generates NO property macros, so SPI_DT_SPEC_GET's spi-max-frequency
    // lookup would not exist. The binding has no driver — it exists so
    // gen_defines emits the spi properties for the target nodes.
    if (spiTargetParts.length > 0) {
      const bindingsDir = join(projectRoot, 'dts', 'bindings');
      mkdirSync(bindingsDir, { recursive: true });
      writeIfChanged(join(bindingsDir, 'cuttlefish,spi-target.yaml'), [
        'description: |',
        '  Cuttlefish thin SPITarget (hal/spi-target.ts) — a raw spi_dt_spec',
        '  peer. No driver binds this compatible; it exists so devicetree',
        '  generation emits the spi properties (spi-max-frequency,',
        '  spi-cpol/spi-cpha, reg = the cs-gpios index) that SPI_DT_SPEC_GET',
        '  consumes from the generated C++.',
        'compatible: "cuttlefish,spi-target"',
        'include: spi-device.yaml',
        '',
      ].join('\n'));
    }
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
      const sensorParts = scanSensorParts(src);
      const spiTargetParts = scanSpiTargets(src);
      const overlay = generateOverlay(chip, {
        // __tc_<bus> matches the shim state block — a begin()-only program
        // emits no driver API call but still declares the DT device. A
        // constructed sensor is also a bus user (see scanSensorParts).
        usesI2c: uses('i2c_') || uses('__tc_i2c') || sensorParts.length > 0,
        usesSensor: uses('sensor_') || sensorParts.length > 0,
        usesFloatFormat: /%[-0-9.]*[eEfFgG]/.test(src),
        sensorParts,
        spiTargets: spiTargetParts,
        usesSpi: uses('spi_') || uses('__tc_spi') || spiTargetParts.length > 0,
        usesUart: uses('__tc_uart'),
        usesUsb: uses('__tc_usb'),
        usesPwm: uses('pwm_'),
        usesAdc: uses('adc_'),
        adcReadPins: scanAdcReadPins(src, chip),
        usesDac: uses('dac_') || uses('__tc_dac'),
        dacWritePins: scanDacWritePins(src),
        pwmUsedPins: scanPwmUsedPins(src, chip),
        i2cUsedInstances: scanUsedBusInstances(src, chip.i2c?.controllers, 'i2c'),
        spiUsedInstances: scanUsedBusInstances(src, chip.spi?.controllers, 'spi'),
        uartUsedInstances: scanUsedBusInstances(src, chip.uart?.controllers, 'uart'),
        // Preferences/FS — same tokens scaffoldZephyrProject scans; drive the
        // storage-partition synthesis + /chosen settings pointer.
        usesPreferences: uses('settings_') || uses('__tc_prefs'),
        usesWdt: uses('wdt_'),
        usesHwtimer: uses('counter_') || uses('__tc_hw'),
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
      // Thin SPI targets need the app-local binding (see the transpile-side
      // write for the rationale): no compatible → no generated spi props →
      // SPI_DT_SPEC_GET's spi-max-frequency lookup does not exist.
      if (spiTargetParts.length > 0) {
        const bindingsDir = join(projectRoot, 'dts', 'bindings');
        mkdirSync(bindingsDir, { recursive: true });
        writeIfChanged(join(bindingsDir, 'cuttlefish,spi-target.yaml'), [
          'description: |',
          '  Cuttlefish thin SPITarget (hal/spi-target.ts) — a raw spi_dt_spec',
          '  peer. No driver binds this compatible; it exists so devicetree',
          '  generation emits the spi properties (spi-max-frequency,',
          '  spi-cpol/spi-cpha, reg = the cs-gpios index) that SPI_DT_SPEC_GET',
          '  consumes from the generated C++.',
          'compatible: "cuttlefish,spi-target"',
          'include: spi-device.yaml',
          '',
        ].join('\n'));
      }
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
        const { workspaceRoot, appRel } = resolveDebugLocations(projectRoot);
        writeDebugConfig({
          projectRoot,
          workspaceRoot,
          appRel,
          target: board,
          buildDir,
          sourceMapPath: join(dirname(o.sourcePath), `${basename(o.sourcePath)}.thcppmap.json`),
        });
      } catch (e) {
        console.warn(`[cuttlefish] gdb debug config generation failed: ${(e as Error).message}`);
      }
    }

    // As-built snapshot: after a successful build, the resolved devicetree
    // at <buildDir>/zephyr/zephyr.dts carries the board's pinctrl labels —
    // the STABLE name grammar, immune to vendor macro churn. Harvest its
    // routes into .cuttlefish/as-built.json; the next build's board-module
    // generation merges them per-pin over the catalog harvest (build wins,
    // silently when they agree). One-build freshness lag on first setup,
    // self-maintaining after. Best-effort — a missing/unparseable artifact
    // never fails the build.
    if (result.status === 0) {
      try {
        const dtsPath = join(buildDir, 'zephyr', 'zephyr.dts');
        const dtsText = readFileSync(dtsPath, 'utf8');
        const facts = parseZephyrDts(dtsText);
        const total = facts.adc.length + facts.pwm.length + facts.dac.length;
        if (total > 0) {
          // Write beside the project's board module — the .cuttlefish dir the
          // config loader reads from, discovered by walking up to the
          // generated board.json (the scaffold root and the config root are
          // different dirs in the standard layout: src/out vs project root).
          let cfDir = join(projectRoot, '.cuttlefish');
          for (let dir = projectRoot; ; dir = dirname(dir)) {
            if (existsSync(join(dir, '.cuttlefish', 'board.json'))) {
              cfDir = join(dir, '.cuttlefish');
              break;
            }
            const parent = dirname(dir);
            if (parent === dir) break;
          }
          mkdirSync(cfDir, { recursive: true });
          writeIfChanged(join(cfDir, 'as-built.json'), asBuiltJson(board, facts));
        }
      } catch { /* best-effort snapshot — nothing to harvest or unreadable */ }
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
    // The runner this flash will actually use: the explicit choice, else the
    // board's declared default (first probe-method entry). Gates port
    // forwarding and the bossac touch below — board.cmake still resolves
    // the default runner itself.
    const flashRunner = probe.runner ?? chip.probeMethods?.[0]?.runner;
    if (flashRunner === 'bossac' && flashPort && chip.usb?.touchReset) {
      const touch = bossacTouchReset(flashPort, chip.usb.touchReset);
      flashNotes.push(`-- ${touch.note}`);
      if (touch.port) flashPort = touch.port;
    }
    const args = buildFlashArgs(buildDir, probe.runner, flashPort, flashRunner, probe.args);

    // openocd flashes go through a dedicated session instead of `west flash`.
    // west's flow has three sequential races that each strand the board: the
    // connect happens against a running (often USB-active) application, the
    // erase precedes the write so the vector table is 0xFFFFFFFF while the
    // RAM algorithm runs (any exception → core LOCKUP at 0xFFFFFFFE, "timeout
    // waiting for algorithm"), and the trailing `reset run` frequently does
    // not reach the core. This session is deterministic end to end: halt at
    // the reset vector (static target for the DAP), mask interrupts for the
    // algorithm (exceptions cannot vector through erased flash), unmask
    // after, and boot the flashed app with a direct SYSRESETREQ. Falls back
    // to `west flash` when the image or session is unavailable.
    let westFallback = true;
    if (probe.runner === 'openocd') {
      const hex = join(buildDir, 'zephyr', 'zephyr.hex');
      if (existsSync(hex)) {
        // Forward slashes + TCL quoting so project paths with spaces work.
        const hexArg = `"${hex.replace(/\\/g, '/')}"`;
        // Target addressing: `cortex_m` is a PER-TARGET subcommand — a bare
        // `cortex_m maskisr on` is an unknown command (a silent no-op inside
        // catch). Resolve the session's target object once and address it.
        // Cortex-M-only, self-gating: on other cores the cortex_m method
        // errors and catch contains it (the plain flash path is safe there
        // without masking — the lockup class is Cortex-M vectoring).
        const flashed = openocdProbeSession(buildDir, zc, chip, [
          'set _tgt [lindex [target names] 0]',
          'reset halt',
          'catch { $_tgt cortex_m maskisr on }',
          `flash write_image erase ${hexArg}`,
          'catch { $_tgt cortex_m maskisr off }',
          // Boot the flashed app. Cortex-M: a direct SYSRESETREQ via AIRCR —
          // pin-independent, always reaches the core, and clears PRIMASK
          // (so the masked algorithm leaves nothing behind). Other cores:
          // openocd's generic reset run.
          'if {[catch {$_tgt cortex_m maskisr on}] == 0} { $_tgt cortex_m maskisr off; mww 0xE000ED0C 0x05FA0004 } else { reset run }',
          'sleep 300',
        ]);
        if (flashed) {
          westFallback = false;
          flashNotes.push('-- probe flash ok: halt → masked write → SYSRESETREQ');
        }
      }
    }

    let result: ReturnType<typeof spawnSync> | undefined;
    let raw = '';
    let ok = false;
    if (westFallback) {
      const inv = westSpawn(args, {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: FLASH_TIMEOUT_MS,
      });
      result = spawnSync(inv.command, inv.args, inv.options);
      const fstdout = typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString() ?? '');
      const fstderr = typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString() ?? '');
      raw = fstdout + fstderr;
      ok = classifyUploadResult(probe.runner, result.status, raw);
      // Fallback-path recovery: a failed west flash leaves the core in
      // lockup; a direct SYSRESETREQ clears it so the caller's retry (or a
      // later flash) starts from a clean chip.
      if (!ok && probe.runner === 'openocd') {
        const revived = openocdProbeSession(buildDir, zc, chip, [
          'init',
          'set _tgt [lindex [target names] 0]',
          'if {[catch {$_tgt cortex_m maskisr on}] == 0} { $_tgt cortex_m maskisr off; mww 0xE000ED0C 0x05FA0004 } else { reset run }',
          'sleep 300',
        ]);
        if (revived) flashNotes.push(revived);
      }
    } else {
      ok = true;
    }
    return {
      success: ok,
      output: [...flashNotes, cleanseUploadOutput(probe.runner, westFallback ? result!.status : 0, raw)]
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
