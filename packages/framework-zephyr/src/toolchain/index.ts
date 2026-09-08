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
// ToolchainOptions.buildTarget by the typecad-hal CLI), defaulting to the
// framework's canonical MVP target (xiao_ble).
//
// Mirrors framework-esp32/src/toolchain/index.ts structure: projectRoot derived
// from outputDir, prepare is a no-op (scaffold happens in compile when the
// target is known), GCC errors parsed via the shared parseCompileErrors helper.
// ---------------------------------------------------------------------------

import { spawn, spawnSync } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { basename, delimiter, dirname, join } from 'node:path';
import { readdirSync, readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import type { ToolchainOptions, CompileResult, UploadResult } from '@typecad/cuttlefish/api/shared';
import { parseCompileErrors } from '@typecad/cuttlefish/api/shared';
import { scaffoldZephyrProject, writeIfChanged, appendLibraryOverlayFragments } from './scaffold.js';
import { parseZephyrDts, asBuiltJson } from '../as-built.js';
import { westSpawn, buildEnv } from './west-spawn.js';
import { discoverWest } from './west-discover.js';
import { writeDebugConfig, resolveDebugLocations, debugArtifactsNeedRewrite, DEBUG_SERVER_PORT, DEBUG_SERVER_TCL_PORT } from './debug-config.js';
import { readRunnersFacts } from './runners.js';
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
      'No build target: set board: in typecad-hal.config.ts (or frameworkData.buildTarget for custom-board projects).',
    );
  }
  return board;
}

/**
 * Derive the Zephyr project root from the typecad-hal-emitted source path.
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
 *   - An explicit `zephyr.runner` (from typecad-hal.config.ts) always wins.
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

/**
 * The board a cached build dir was configured for (CMakeCache.txt's
 * BOARD:STRING — the exact value passed to `west build -b`), or undefined
 * when no cache exists. compile() compares it against the requested board
 * and nukes the dir on mismatch: `west build`'s --pristine=auto covers
 * cmake/config churn, NOT a board switch — west aborts with "refusing to
 * proceed without --force", and cuttlefish doesn't forward that flag.
 */
export function cachedBuildBoard(buildDir: string): string | undefined {
  try {
    return readFileSync(join(buildDir, 'CMakeCache.txt'), 'utf-8')
      .match(/^BOARD:STRING=(.+)$/m)?.[1]?.trim() || undefined;
  } catch {
    return undefined; // no build dir / unreadable cache — treat as fresh
  }
}

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
        `typecad-hal.config.ts sets both zephyr.probe ('${probe}') and zephyr.runner ('${runner}'). ` +
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
/**
 * Resolve the openocd binary (plus script search dirs) for the probe session.
 *
 * Resolution order mirrors how west's own openocd runner finds the binary, so
 * the session and `west flash` drive the SAME openocd:
 *   1. $OPENOCD — the variable Zephyr's CMake reads into the build cache.
 *   2. A Zephyr-SDK-hosted install ($ZEPHYR_SDK_INSTALL_DIR, else the
 *      discovered west install's SDK). Layout differs by SDK generation —
 *      hosttools/openocd/share/openocd/scripts vs hosttools/openocd/scripts —
 *      so both script dirs are collected.
 *   3. PATH — Linux distro / conda / micromamba installs (a micromamba-env
 *      openocd is the common Linux setup; the SDK layout check alone made the
 *      deterministic probe session unreachable there, silently dropping every
 *      Linux flash to the racy `west flash` fallback).
 *
 * A non-SDK binary resolves with no explicit -s dirs: it finds its own
 * interface/target scripts via its compiled-in search path. Returns undefined
 * when no openocd can be found (the caller then uses the west fallback).
 *
 * Exported (pure) so the resolution contract is unit-testable without
 * spawning openocd.
 */
export interface SessionOpenOcd {
  readonly exe: string;
  readonly searchDirs: readonly string[];
}

export function resolveSessionOpenOcd(
  env: {
    OPENOCD?: string | undefined;
    ZEPHYR_SDK_INSTALL_DIR?: string | undefined;
    PATH?: string | undefined;
  } = process.env,
  sdkInstallDir?: string,
): SessionOpenOcd | undefined {
  const exeName = process.platform === 'win32' ? 'openocd.exe' : 'openocd';
  if (env.OPENOCD && existsSync(env.OPENOCD)) {
    return { exe: env.OPENOCD, searchDirs: [] };
  }
  const sdkRoot = env.ZEPHYR_SDK_INSTALL_DIR || sdkInstallDir;
  if (sdkRoot) {
    const exe = join(sdkRoot, 'hosttools', 'openocd', 'bin', exeName);
    if (existsSync(exe)) {
      const searchDirs = [
        join(sdkRoot, 'hosttools', 'openocd', 'share', 'openocd', 'scripts'),
        join(sdkRoot, 'hosttools', 'openocd', 'scripts'),
      ].filter((d) => existsSync(d));
      return { exe, searchDirs };
    }
  }
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exeName);
    if (existsSync(candidate)) return { exe: candidate, searchDirs: [] };
  }
  return undefined;
}

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
  // Session reset policy: `reset_config none`. The session's resets are
  // core-domain by design — vector-catch halt before the flash write,
  // SYSRESETREQ to boot — so they must not depend on the SRST pin. Boards
  // like the WeAct Black Pill don't break NRST out at all: under the board
  // cfg's `srst_only`, every `reset` asserts a pin that reaches nothing
  // (the target never resets, `reset halt` catches the core mid-app in
  // dirty state and the flash algorithm times out) while the probe's
  // floating SRST sense reports phantom "external reset detected" events
  // that leave the session's halt state inconsistent. Method-declared west
  // quirks (`--cmd-pre-init=…`) are appended after and override the
  // default for boards whose facts carry one.
  const preInit = [
    'reset_config none',
    ...(method?.args ?? [])
      .filter((a) => a.startsWith('--cmd-pre-init='))
      .map((a) => a.slice('--cmd-pre-init='.length)),
  ];

  const install = discoverWest();
  const sessionOpenOcd = resolveSessionOpenOcd(process.env, install?.sdkInstallDir);
  if (!sessionOpenOcd) return undefined;
  const openocdExe = sessionOpenOcd.exe;
  const searchArgs = sessionOpenOcd.searchDirs.flatMap((d) => ['-s', d] as [string, string]);

  let cfgArgs: string[] | undefined;
  let sessionCfg: string | undefined;
  if (cfgLines && cfgLines.length > 0) {
    sessionCfg = join(buildDir, 'typecad-hal-probe.cfg');
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
      ...searchArgs, ...cfgArgs!,
      // Pre-init TCL AFTER the cfg (overrides its reset_config) and BEFORE
      // init — the same position west gives --cmd-pre-init.
      ...preInit.map((c) => ['-c', c] as [string, string]).flat(),
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

/**
 * Whether a flash runner carries the upload over a serial port. Runner-gated,
 * never board-name-gated: esptool and bossac are the only runners
 * `buildFlashArgs` forwards `--port` to, so they are the only ones that
 * cannot flash without one. Probe runners (openocd, jlink) and USB flows
 * (dfu-util, uf2 mass storage) need no port — a missing `--port` must not
 * block them.
 *
 * Exported (pure) so the port-requirement contract is unit-testable without
 * spawning west.
 */
export function uploadRequiresPort(runner: string | undefined): boolean {
  return runner === 'esptool' || runner === 'bossac';
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
 * Whether a `west flash` (openocd) output carries one of the known
 * target-ignored-SWD signatures — the DAP connect failing ("init mode
 * failed (unable to connect to the target)", i.e. the DPIDR read never
 * succeeded) or a reset/halt never landing ("timed out while waiting for
 * target halted" / "TARGET: <name> - Not halted"). Both mean the board (or
 * probe) needs a power-cycle or the SWD-free DFU path, not a retry of the
 * same command. Centralized so the upload hint stays testable.
 */
export function isTargetSwdFailure(output: string): boolean {
  return /unable to connect to the target|timed out while waiting for target halted|TARGET: \S+ - Not halted/.test(output);
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
    const configChanged = scaffoldZephyrProject(projectRoot, isGdbDebug, userKconfig, o.psram);

    // Regenerate the DT overlay for the ACTUAL target board. prepare() writes
    // it for the default board (the real target is unknown until compile), so
    // the <default>.overlay it wrote does not match `west build -b <board>`.
    // Zephyr auto-detects boards/<board>.overlay under APPLICATION_CONFIG_DIR.
    try {
      const chip = chipForBuild(projectRoot, board);
      // Custom-board generation: an MCU-only target (no board package) has no
      // upstream Zephyr board — generate one under boards/typecad/<name>/ from
      // the chip's silicon data. Opt-in via `zephyr.customBoard: true` in
      // typecad-hal.config.ts; the board takes its name from the build target.
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
    // Board switches DO need a nuke: `west build`'s --pristine=auto covers
    // cmake/config churn, not a -b <board> mismatch — west aborts with
    // "refusing to proceed without --force" and cuttlefish doesn't forward
    // that flag, so the user would be stuck deleting the dir by hand. The
    // cache names the board it was configured for (BOARD:STRING); detect the
    // mismatch and apply west's own suggested remedy automatically.
    const cachedBoard = cachedBuildBoard(buildDir);
    const boardChanged = Boolean(cachedBoard && cachedBoard !== board);
    if (configChanged || boardChanged) {
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
    // Append user cmake args from typecad-hal.config.ts zephyr.cmakeArgs.
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
      ? '\n[typecad-hal] dependency cycle detected in the cached build dir — retried with a pristine build'
      : '');
    // Prefix the build log with how west was resolved, for transparency.
    const header = `Using west via ${inv.install.source}` +
      (inv.install.zephyrBase ? ` (ZEPHYR_BASE=${inv.install.zephyrBase})` : '') + '\n';

    // After a successful build on a gdb-capable board, keep the VS Code debug
    // artifacts current: always under --debug, or on a plain build when they
    // need it (still in create-time starter shape, an outDir rename moved the
    // app root, or a pre-west self-managed-server entry). Non-fatal on
    // failure — a missing artifact doesn't block the build.
    if (result.status === 0 && debugMode === 'gdb') {
      try {
        const { workspaceRoot, appRel } = resolveDebugLocations(projectRoot);
        if (isGdbDebug
          || debugArtifactsNeedRewrite(workspaceRoot, appRel, readRunnersFacts(buildDir)?.gdb?.replace(/\\/g, '/'))) {
          writeDebugConfig({
            projectRoot,
            workspaceRoot,
            appRel,
            target: board,
            buildDir,
            sourceMapPath: join(dirname(o.sourcePath), `${basename(o.sourcePath)}.thcppmap.json`),
          });
        }
      } catch (e) {
        console.warn(`[typecad-hal] gdb debug config generation failed: ${(e as Error).message}`);
      }
    }

    // As-built snapshot: after a successful build, the resolved devicetree
    // at <buildDir>/zephyr/zephyr.dts carries the board's pinctrl labels —
    // the STABLE name grammar, immune to vendor macro churn. Harvest its
    // routes into .typecad-hal/as-built.json; the next build's board-module
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
          // Write beside the project's board module — the .typecad-hal dir the
          // config loader reads from, discovered by walking up to the
          // generated board.json (the scaffold root and the config root are
          // different dirs in the standard layout: src/out vs project root).
          let cfDir = join(projectRoot, '.typecad-hal');
          for (let dir = projectRoot; ; dir = dirname(dir)) {
            if (existsSync(join(dir, '.typecad-hal', 'board.json'))) {
              cfDir = join(dir, '.typecad-hal');
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
    // Flashing over a probe needs it EXCLUSIVE: a debug server still bound to
    // the gdb port (live session or an orphan whose wrapper died — a VS Code
    // window reload kills task terminals without killing their children on
    // Windows) makes openocd fail with LIBUSB_ERROR_ACCESS before any retry
    // logic can help. Reclaim it up front — it is ours by convention.
    {
      const holder = portOwnerPid(DEBUG_SERVER_PORT);
      if (holder !== undefined && holder !== process.pid) {
        console.log(`-- west flash: stopping debug server (pid ${holder}) — flashing needs exclusive probe access`);
        killPidTree(holder);
        try {
          rmSync(join(projectRoot, '.typecad-hal', 'debug-server.pid'), { force: true });
        } catch { /* already gone */ }
      }
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
    // Serial-port runners cannot flash without a port; every other runner
    // (probe or USB) proceeds — whether a port is required is the runner's
    // call, not the CLI's blanket gate.
    if (uploadRequiresPort(flashRunner) && !flashPort) {
      return {
        success: false,
        output: `-- upload requires a port for ${flashRunner} flashing. Set --port <port> on the command line (or the TYPECAD_HAL_PORT env var).`,
      };
    }
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
          // openocd's generic reset run. A halted core STAYS halted across
          // a core-initiated reset (debug halt state survives — that is how
          // reset halt works), so resume it; on a running core resume errors
          // and the catch swallows it.
          'if {[catch {$_tgt cortex_m maskisr on}] == 0} { $_tgt cortex_m maskisr off; mww 0xE000ED0C 0x05FA0004 } else { reset run }',
          'sleep 100',
          'catch { resume }',
          'sleep 200',
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
      // A SUCCESSFUL west openocd flash can still leave the core HALTED:
      // west's trailing `reset run` does not reach a core behind an unwired
      // SRST, and the user's only recourse is the NRST button. Boot it from
      // a probe session instead — one core reset (a halted core re-halts at
      // the reset vector; a running core restarts the just-flashed app)
      // plus a resume.
      if (ok && probe.runner === 'openocd') {
        const booted = openocdProbeSession(buildDir, zc, chip, [
          'set _tgt [lindex [target names] 0]',
          'if {[catch {$_tgt cortex_m maskisr on}] == 0} { $_tgt cortex_m maskisr off; mww 0xE000ED0C 0x05FA0004 } else { reset run }',
          'sleep 100',
          'catch { resume }',
          'sleep 200',
        ]);
        if (booted) flashNotes.push('-- probe boot ok: SYSRESETREQ → resume');
      }
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
        // Known SWD-failure signatures get a recovery pointer — a board that
        // ignores SWD until power-cycled (low-power state, lockup, a wedged
        // probe) otherwise reads as a toolchain bug.
        if (isTargetSwdFailure(raw)) {
          flashNotes.push(
            '-- target ignored SWD — if a retry fails too: power-cycle the board, replug the probe, or skip SWD entirely (hold BOOT0, tap reset, re-run with --probe dfu)',
          );
        }
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
    // explicit --baud when given, else 115200.
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

  debugServer(o: ToolchainOptions, action: 'start' | 'stop'): void {
    const projectRoot = projectRootFromOptions(o);
    const buildDir = join(projectRoot, 'build');
    const pidFile = join(projectRoot, '.typecad-hal', 'debug-server.pid');

    if (action === 'stop') {
      stopDebugServer(pidFile);
      return;
    }

    // start: wrap `west debugserver` as a long-running foreground process (the
    // VS Code background task owns this process; postDebugTask runs `stop`).
    if (!existsSync(join(buildDir, 'zephyr', 'runners.yaml'))) {
      console.error(
        `! No build at ${buildDir} — run 'npm run compile' (or F5's preLaunchTask) first.`,
      );
      process.exitCode = 1;
      return;
    }
    const stale = readStaleServerPid(pidFile);
    if (stale !== undefined) {
      // Already running (pid alive): just re-emit the ready marker so the
      // task's problem matcher completes immediately.
      console.log(`[typecad-hal] west debugserver already running (pid ${stale})`);
      console.log(`TYPECAD_HAL: debug server ready on ${DEBUG_SERVER_PORT}`);
      return;
    }
    try { rmSync(pidFile, { force: true }); } catch { /* already gone */ }
    // A wrapper/west that died without cleanup can leave openocd bound to
    // the gdb port with a stale pidfile — reclaim it or the new server
    // cannot bind (and gdb would attach to the orphan).
    const orphan = portOwnerPid(DEBUG_SERVER_PORT);
    if (orphan !== undefined && orphan !== process.pid) {
      console.log(`[typecad-hal] reclaiming orphaned debug server on :${DEBUG_SERVER_PORT} (pid ${orphan})`);
      killPidTree(orphan);
    }

    // Runner + quirk parity with flash (resolveProbeMethod, same as `west
    // debug`): an explicit zephyr.probe selects the runner; either way, an
    // srst-based openocd cfg behind an unwired NRST (the probeRunnerQuirks
    // condition, read from the board's own method data) makes `reset init`
    // time out — the IDE's post-attach reset would hang the session. Apply
    // the core-reset override server-side unless the config's runnerArgs
    // already carry it (the create flow bakes it in).
    const board = targetFromOptions(o);
    const chip = chipForBuild(projectRoot, board);
    const zc = o.zephyrConfig as Record<string, unknown> | undefined;
    const probe = resolveProbeMethod(zc, chip, 'debug');
    // The runner west will actually drive: the explicit choice, else the
    // board's declared debug-runner default from the build's runners.yaml.
    const runner = ((probe.ok && probe.runner) || undefined)
      ?? readRunnersFacts(buildDir)?.debugRunner;
    const isOcd = runner === undefined || runner === 'openocd' || runner.startsWith('openocd');
    if (!isOcd) {
      console.warn(`! debug-server: the IDE wiring (ready marker, quirk args) targets the ` +
        `openocd runner; this build's debug runner is '${runner}'. Starting it plain — ` +
        `the F5 session may not connect.`);
    }
    const serverArgs = ['debugserver', '-d', buildDir];
    if (probe.ok) {
      if (probe.runner) serverArgs.push('--runner', probe.runner);
      serverArgs.push(...probe.args);
    }
    if (isOcd) {
      serverArgs.push(
        '--gdb-port', String(DEBUG_SERVER_PORT),
        // Pinned so the readiness poll below has a deterministic port.
        '--tcl-port', String(DEBUG_SERVER_TCL_PORT),
        // The board's own openocd.cfg may declare gdb-attach/gdb-detach
        // events (reset-on-attach for standalone sessions). Under an
        // IDE-managed session a stop event mid-initialization aborts
        // debugger setup, so neutralize them: west's --cmd-pre-init lands
        // AFTER the cfg files in the openocd command line, so these win.
        '--cmd-pre-init', '$_TARGETNAME configure -event gdb-attach {}',
        '--cmd-pre-init', '$_TARGETNAME configure -event gdb-detach {}',
      );
      const method = (zc?.probe as string | undefined)
        ? chip.probeMethods?.find((m) => m.id === zc?.probe)
        : chip.probeMethods?.find((m) => m.debug !== false);
      const cfg = method?.debugCfg ?? [];
      const srst = cfg.some((l) => /reset_config\s+srst/.test(l));
      const connectAssert = cfg.some((l) => /connect_assert_srst/.test(l));
      if (method?.runner === 'openocd' && srst && !connectAssert
        && !(probe.ok && probe.args.includes('--cmd-pre-init=reset_config none'))) {
        serverArgs.push('--cmd-pre-init', 'reset_config none');
      }
    }
    const inv = westSpawn(serverArgs, { cwd: projectRoot });
    const child = spawn(inv.command, inv.args, {
      ...inv.options,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group on POSIX so `stop` can signal the whole tree.
      ...(process.platform !== 'win32' ? { detached: true } : {}),
    });
    mkdirSync(join(projectRoot, '.typecad-hal'), { recursive: true });
    writeFileSync(pidFile, String(child.pid), 'utf-8');
    console.log(`[typecad-hal] starting west debugserver (gdb on localhost:${DEBUG_SERVER_PORT})`);
    // A reader that goes away (closed task terminal, piped head) must not
    // take the server down with an EPIPE.
    process.stdout?.on?.('error', () => { /* EPIPE — server keeps running */ });
    process.stderr?.on?.('error', () => { /* EPIPE — server keeps running */ });
    child.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));

    // Ready = the TCL port accepts connections. NOT the gdb port: openocd's
    // gdb server takes ONE client, so a TCP probe there both logs
    // "attempted 'gdb' connection rejected" and can race the real gdb
    // connection for the slot. The tcl listener opens at the END of openocd
    // init (after the gdb listener and the startup halt) — a truer signal —
    // and probes there are inert.
    const deadline = Date.now() + DEBUG_SERVER_START_TIMEOUT_MS;
    const poll = (): void => {
      const sock = netConnect(DEBUG_SERVER_TCL_PORT, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        console.log(`TYPECAD_HAL: debug server ready on ${DEBUG_SERVER_PORT}`);
      });
      sock.once('error', () => {
        sock.destroy();
        if (child.exitCode !== null) return; // server died — exit handler reports
        if (Date.now() > deadline) {
          console.error(`! west debugserver did not open :${DEBUG_SERVER_TCL_PORT} within `
            + `${DEBUG_SERVER_START_TIMEOUT_MS / 1000}s — see its output above.`);
          stopDebugServer(pidFile);
          process.exitCode = 1;
          return;
        }
        setTimeout(poll, 250);
      });
    };
    poll();

    child.on('exit', (code) => {
      try { rmSync(pidFile, { force: true }); } catch { /* already gone */ }
      // Exit before ready: surface as a task failure (the debugger never
      // connects and VS Code reports the background task's non-zero exit).
      if (code !== null && code !== 0) process.exitCode = code;
    });
    const forwardSignal = (): void => {
      stopDebugServer(pidFile);
      child.once('exit', () => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', forwardSignal);
    process.on('SIGTERM', forwardSignal);
  },
};

/** How long `debug-server start` waits for the gdb port before failing. */
const DEBUG_SERVER_START_TIMEOUT_MS = 45_000;

/**
 * Read the pidfile and return the pid when that process is still alive,
 * undefined otherwise (no file, dead pid, or unparseable). Best-effort.
 */
function readStaleServerPid(pidFile: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (!Number.isInteger(pid)) return undefined;
    process.kill(pid, 0); // throws ESRCH when dead
    return pid;
  } catch {
    return undefined;
  }
}

/**
 * The pid of whatever process is LISTENING on the gdb port — the recovery
 * path for orphaned servers (the wrapper and west can die while openocd
 * survives, e.g. a killed task terminal; the pidfile is then stale but the
 * port stays bound and the next session would attach to the orphan).
 * Best-effort: netstat on Windows, lsof on POSIX; undefined when the port is
 * free or the platform tool is unavailable.
 */
function portOwnerPid(port: number): number | undefined {
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf-8' });
      if (out.status !== 0) return undefined;
      for (const line of (out.stdout ?? '').split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 5 && cols[3] === 'LISTENING'
          && cols[1].endsWith(`:${port}`)) {
          const pid = Number.parseInt(cols[4], 10);
          if (Number.isInteger(pid)) return pid;
        }
      }
      return undefined;
    }
    const out = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8' });
    if (out.status !== 0 || !out.stdout?.trim()) return undefined;
    const pid = Number.parseInt(out.stdout.trim().split(/\s+/)[0]!, 10);
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Kill a pid tree (Windows: taskkill /T; POSIX: the process group). */
function killPidTree(pid: number): void {
  if (process.platform === 'win32') {
    // /T: the whole tree (the pid may be the micromamba/west wrapper; openocd
    // is its grandchild). /F: force — the server has no stdin to close.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf-8' });
  } else {
    try {
      process.kill(-pid, 'SIGTERM'); // the detached process group
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }
}

/** Kill the debug server tree (micromamba/west → openocd) and drop the pidfile.
 *  Falls back to the gdb-port owner when the recorded pid is already dead —
 *  that orphan would otherwise serve stale sessions forever. */
function stopDebugServer(pidFile: string): void {
  const pid = readStaleServerPid(pidFile) ?? portOwnerPid(DEBUG_SERVER_PORT);
  if (pid === undefined) {
    try { rmSync(pidFile, { force: true }); } catch { /* already gone */ }
    console.log('[typecad-hal] debug server not running');
    return;
  }
  killPidTree(pid);
  try { rmSync(pidFile, { force: true }); } catch { /* already gone */ }
  console.log(`[typecad-hal] debug server stopped (pid ${pid})`);
}
