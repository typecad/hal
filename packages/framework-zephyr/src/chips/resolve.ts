// ---------------------------------------------------------------------------
// Derive ZephyrChipDescriptor from board/MCU package constants
//
// The board constants resolver extracts flat dot-path scalars from the board
// and MCU definition files. This utility reconstructs the structured
// ZephyrChipDescriptor from those flat keys, merging SoC-level defaults
// (from the MCU package's zephyr field) with board-level overrides (from the
// board package's zephyr field).
//
// This is the ONE resolution path: every board's chip view reconstructs
// from its generated manifest — there is no curated registry to fall back
// to.
// ---------------------------------------------------------------------------

import type { BoardConstants } from '@typecad/cuttlefish/api/shared';
import type {
  ZephyrChipDescriptor,
  ZephyrProbeMethod,
  ZephyrGpioDtSpec,
  ZephyrGpioController,
  ZephyrBusController,
  ZephyrPwmSpec,
  ZephyrInterruptPin,
  ZephyrAdcChannel,
  ZephyrDacChannel,
} from './types.js';

/** Collect an indexed array of objects reconstructed from flat dot-path keys. */
function collectIndexed<T>(
  bc: BoardConstants,
  prefix: string,
  build: (bc: BoardConstants, index: number) => T | null,
): T[] {
  const result: T[] = [];
  for (let i = 0; i < 256; i++) {
    const checkKey = `${prefix}.${i}`;
    let hasAny = false;
    for (const [k] of bc) {
      if (k.startsWith(checkKey)) { hasAny = true; break; }
    }
    if (!hasAny) break;
    const item = build(bc, i);
    if (item) result.push(item);
  }
  return result;
}

function collectBusControllers(
  bc: BoardConstants,
  prefix: string,
): ZephyrBusController[] {
  return collectIndexed<ZephyrBusController>(bc, prefix, (m, i) => {
    const nodeLabel = m.get(`${prefix}.${i}.nodeLabel`) as string;
    if (!nodeLabel) return null;
    // Optional pinctrl synthesis data (nested object; string arrays arrive
    // comma-joined from the board-constants flattener).
    const splitCsv = (v: unknown): string[] | undefined =>
      typeof v === 'string' && v.length > 0
        ? v.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
    const include = m.get(`${prefix}.${i}.pinctrl.include`) as string | undefined;
    const pinmux = splitCsv(m.get(`${prefix}.${i}.pinctrl.pinmux`));
    const inputPinmux = splitCsv(m.get(`${prefix}.${i}.pinctrl.inputPinmux`));
    const defines = splitCsv(m.get(`${prefix}.${i}.pinctrl.defines`));
    const pinctrlRef = m.get(`${prefix}.${i}.pinctrlRef`) as string | undefined;
    const props = splitCsv(m.get(`${prefix}.${i}.props`));
    return {
      nodeLabel,
      ...(include && pinmux
        ? {
            pinctrl: {
              include,
              pinmux,
              ...(inputPinmux ? { inputPinmux } : {}),
              ...(defines ? { defines } : {}),
            },
          }
        : {}),
      ...(pinctrlRef ? { pinctrlRef } : {}),
      ...(props ? { props } : {}),
    };
  });
}

/**
 * Try to derive a ZephyrChipDescriptor from board/MCU package constants.
 *
 * Returns null when no zephyr info is available in the board constants
 * (the caller should treat the board as unresolved — NO_BOARD_CHIP).
 */
export function resolveChipFromBoard(
  bc: BoardConstants | undefined,
): ZephyrChipDescriptor | null {
  if (!bc) return null;

  const boardTarget = bc.get('build.frameworks.zephyr') as string | undefined;
  // MCU-silicon entry: an MCU-only config (no board package) carries the
  // chip facts under zephyr.* without any build.frameworks target (the
  // build target comes from frameworkData instead — a custom board name).
  const socsRaw = bc.get('zephyr.socs') as string | undefined;
  if (!boardTarget && !socsRaw) return null;

  const socs = typeof socsRaw === 'string' && socsRaw.length > 0
    ? socsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  // Chip identity: the board target when a board resolved it, else the SoC
  // (an MCU-only chip — its "board" is the generated custom board).
  const id = boardTarget ?? socs[0] ?? 'custom';

  const zGpioController = bc.get('zephyr.gpioController') as string | undefined;
  // The soc name: MCU packages key it under mcu.id; generated board
  // manifests carry it as the second segment of the qualified target.
  const soc = (bc.get('mcu.id') as string)
    ?? (socs.length > 0 ? socs[0] : undefined)
    ?? (boardTarget && boardTarget.includes('/') ? boardTarget.split('/')[1] : '');

  // ── Build mutable sub-objects, then construct the final descriptor ──────

  const gc = collectIndexed<ZephyrGpioController>(bc, 'zephyr.gpioControllers', (m, i) => {
    const nodelabel = m.get(`zephyr.gpioControllers.${i}.nodelabel`) as string;
    const minPin = m.get(`zephyr.gpioControllers.${i}.minPin`) as number;
    const maxPin = m.get(`zephyr.gpioControllers.${i}.maxPin`) as number;
    if (nodelabel != null && minPin != null && maxPin != null) {
      return { nodelabel, minPin, maxPin };
    }
    return null;
  });

  const dtSpecs = collectIndexed<ZephyrGpioDtSpec>(bc, 'zephyr.gpio.dtSpecs', (m, i) => {
    const pin = m.get(`zephyr.gpio.dtSpecs.${i}.pin`) as number;
    const dtSpec = m.get(`zephyr.gpio.dtSpecs.${i}.dtSpec`) as string;
    if (pin != null && dtSpec) return { pin, dtSpec };
    return null;
  });

  const intPins = collectIndexed<ZephyrInterruptPin>(bc, 'zephyr.gpio.interruptPins', (m, i) => {
    const pin = m.get(`zephyr.gpio.interruptPins.${i}.pin`) as number;
    const dtSpec = m.get(`zephyr.gpio.interruptPins.${i}.dtSpec`) as string;
    if (pin != null && dtSpec) return { pin, dtSpec };
    return null;
  });

  const i2cControllers = collectBusControllers(bc, 'zephyr.i2c.controllers');
  const spiControllers = collectBusControllers(bc, 'zephyr.spi.controllers');
  const uartControllers = collectBusControllers(bc, 'zephyr.uart.controllers');

  const pwmSpecs = collectIndexed<ZephyrPwmSpec>(bc, 'zephyr.pwm.specs', (m, i) => {
    const pin = m.get(`zephyr.pwm.specs.${i}.pin`) as number;
    const dtSpec = m.get(`zephyr.pwm.specs.${i}.dtSpec`) as string | undefined;
    const controller = m.get(`zephyr.pwm.specs.${i}.controller`) as string | undefined;
    const channel = m.get(`zephyr.pwm.specs.${i}.channel`) as number | undefined;
    const periodNs = m.get(`zephyr.pwm.specs.${i}.periodNs`) as number | undefined;
    const polarity = m.get(`zephyr.pwm.specs.${i}.polarity`) as string | undefined;
    const pinctrl = m.get(`zephyr.pwm.specs.${i}.pinctrl`) as string | undefined;
    // Board-shipped alias form (dtSpec) or synthesized form (controller +
    // channel → overlay-generated alias) — at least one, else drop the entry.
    if (pin == null || !(dtSpec || (controller && channel != null))) return null;
    return {
      pin,
      ...(dtSpec ? { dtSpec } : {}),
      ...(controller ? { controller } : {}),
      ...(channel != null ? { channel } : {}),
      ...(periodNs != null ? { periodNs } : {}),
      ...(polarity ? { polarity } : {}),
      ...(pinctrl ? { pinctrl } : {}),
    };
  });

  const adcNodeLabel = bc.get('zephyr.adc.nodeLabel') as string | undefined;
  // PWM timer input clock — feeds the overlay's 16-bit prescaler derivation.
  const pwmClockHz = bc.get('zephyr.pwm.clockHz') as number | undefined;

  // PWM matrix (ESP32 LEDC): any listed pin can carry any channel; channels
  // are assigned to the driven pins at build time (dt-config/overlay.ts).
  const matrixController = bc.get('zephyr.pwm.matrix.controller') as string | undefined;
  const matrixChannelCount = bc.get('zephyr.pwm.matrix.channelCount') as number | undefined;
  const matrixPins = collectIndexed<number>(
    bc, 'zephyr.pwm.matrix.pins',
    (m, i) => (m.get(`zephyr.pwm.matrix.pins.${i}`) as number | undefined) ?? null,
  );
  const pwmMatrix = matrixController && matrixChannelCount
    ? { controller: matrixController, channelCount: matrixChannelCount, pins: matrixPins }
    : undefined;

  const adcResolution = bc.get('zephyr.adc.resolution') as number | undefined;
  const adcVref = bc.get('zephyr.adc.vrefMv') as number | undefined;
  const adcGain = bc.get('zephyr.adc.gain') as string | undefined;
  const adcReference = bc.get('zephyr.adc.reference') as string | undefined;
  const adcChannels = collectIndexed<ZephyrAdcChannel>(bc, 'zephyr.adc.channels', (m, i) => {
    const pin = m.get(`zephyr.adc.channels.${i}.pin`) as number;
    const channel = m.get(`zephyr.adc.channels.${i}.channel`) as number;
    const pinctrl = m.get(`zephyr.adc.channels.${i}.pinctrl`) as string | undefined;
    const controller = m.get(`zephyr.adc.channels.${i}.controller`) as string | undefined;
    if (pin != null && channel != null) {
      return { pin, channel, ...(pinctrl ? { pinctrl } : {}), ...(controller ? { controller } : {}) };
    }
    return null;
  });

  const dacDevice = bc.get('zephyr.dac.device') as string | undefined;
  const dacChannels = collectIndexed<ZephyrDacChannel>(bc, 'zephyr.dac.channels', (m, i) => {
    const pin = m.get(`zephyr.dac.channels.${i}.pin`) as number;
    const channel = m.get(`zephyr.dac.channels.${i}.channel`) as number;
    const resolution = m.get(`zephyr.dac.channels.${i}.resolution`) as number | undefined;
    if (pin != null && channel != null) {
      return { pin, channel, resolution: resolution ?? 12 };
    }
    return null;
  });

  const wdtNodeLabel = bc.get('zephyr.wdt.nodeLabel') as string | undefined;

  // Hardware counters (Zephyr counter devices): nodeLabel always; the child
  // form carries the timer parent the overlay attaches the (label-less)
  // counter child to.
  const hwtimerControllers = collectIndexed<ZephyrBusController>(bc, 'zephyr.hwtimer.controllers', (m, i) => {
    const nodeLabel = m.get(`zephyr.hwtimer.controllers.${i}.nodeLabel`) as string;
    const counterParent = m.get(`zephyr.hwtimer.controllers.${i}.counterParent`) as string | undefined;
    if (!nodeLabel) return null;
    return { nodeLabel, ...(counterParent ? { counterParent } : {}) };
  });

  // Storage partition synthesis (boards whose DTS ships no storage_partition
  // — see ZephyrChipDescriptor.storage).
  const storageOffset = bc.get('zephyr.storage.offset') as number | undefined;
  const storageSize = bc.get('zephyr.storage.size') as number | undefined;
  const storagePreexisting = bc.get('zephyr.storage.preexisting') as boolean | undefined;

  // USB device (CDC-ACM): zephyr.usb.controller + zephyr.usb.cdcInstances
  // (+ optional vid/pid for the device descriptor).
  const usbController = bc.get('zephyr.usb.controller') as string | undefined;
  const usbCdcInstances = bc.get('zephyr.usb.cdcInstances') as number | undefined;
  const usbVid = bc.get('zephyr.usb.vid') as string | undefined;
  const usbPid = bc.get('zephyr.usb.pid') as string | undefined;
  // Optional 1200-baud touch-to-reset data (BOSSA-bootloader boards).
  const trFlag = bc.get('zephyr.usb.touchReset.flagAddress') as number | undefined;
  const trMagic = bc.get('zephyr.usb.touchReset.magic') as number | undefined;
  const trVid = bc.get('zephyr.usb.touchReset.bootloaderVid') as string | undefined;
  const trPid = bc.get('zephyr.usb.touchReset.bootloaderPid') as string | undefined;

  const probeMethods = collectIndexed<ZephyrProbeMethod>(bc, 'zephyr.probeMethods', (m, i) => {    const id = m.get(`zephyr.probeMethods.${i}.id`) as string;
    const runner = m.get(`zephyr.probeMethods.${i}.runner`) as string;
    if (!id || !runner) return null;
    const argsRaw = m.get(`zephyr.probeMethods.${i}.args`) as string | undefined;
    const description = m.get(`zephyr.probeMethods.${i}.description`) as string | undefined;
    const debugRaw = m.get(`zephyr.probeMethods.${i}.debug`) as boolean | undefined;
    const debugInterface = m.get(`zephyr.probeMethods.${i}.debugInterface`) as string | undefined;
    const debugDevice = m.get(`zephyr.probeMethods.${i}.debugDevice`) as string | undefined;
    const debugCfgRaw = m.get(`zephyr.probeMethods.${i}.debugCfg`) as string | undefined;
    const debugCfgSourceRaw = m.get(`zephyr.probeMethods.${i}.debugCfgSource`) as string | undefined;
    // Args are comma-joined (west flags never carry commas); cfg lines are
    // newline-joined (tcl legally contains commas).
    const split = (v: string | undefined): string[] | undefined =>
      typeof v === 'string' && v.length > 0 ? v.split(',') : undefined;
    const splitLines = (v: string | undefined): string[] | undefined =>
      typeof v === 'string' && v.length > 0 ? v.split('\n') : undefined;
    const args = split(argsRaw);
    return {
      id,
      runner,
      ...(args ? { args } : {}),
      ...(description ? { description } : {}),
      ...(debugRaw !== undefined ? { debug: debugRaw } : {}),
      ...(debugInterface ? { debugInterface: debugInterface as 'swd' | 'jtag' } : {}),
      ...(debugDevice ? { debugDevice } : {}),
      ...(split(debugCfgRaw) ? { debugCfg: splitLines(debugCfgRaw) } : {}),
      ...(split(debugCfgSourceRaw) ? { debugCfgSource: splitLines(debugCfgSourceRaw) } : {}),
    };
  });
  const wifiSupported = bc.get('zephyr.wifi.supported') as boolean | undefined;

  // ── Custom-board generator inputs (MCU silicon) ─────────────────────────
  // Only complete when the MCU package carried a default console + clock
  // plan — without those there is nothing to generate a board from.
  const consoleNodeLabel = bc.get('zephyr.console.nodeLabel') as string | undefined;
  const consoleTx = bc.get('zephyr.console.tx') as string | undefined;
  const consoleRx = bc.get('zephyr.console.rx') as string | undefined;
  const consoleSpeed = bc.get('zephyr.console.speed') as number | undefined;
  const hseMHz = bc.get('zephyr.clocks.hseMHz') as number | undefined;
  const pllDivM = bc.get('zephyr.clocks.pll.divM') as number | undefined;
  const pllMulN = bc.get('zephyr.clocks.pll.mulN') as number | undefined;
  const pllDivP = bc.get('zephyr.clocks.pll.divP') as number | undefined;
  const pllDivQ = bc.get('zephyr.clocks.pll.divQ') as number | undefined;
  const sysMHz = bc.get('zephyr.clocks.sysMHz') as number | undefined;
  const dtsIncludesRaw = bc.get('zephyr.dtsIncludes') as string | undefined;
  const usbNode = bc.get('zephyr.usb.usbNode') as string | undefined;
  const usbPinctrlRaw = bc.get('zephyr.usb.pinctrl') as string | undefined;
  const usbPinctrl = typeof usbPinctrlRaw === 'string' && usbPinctrlRaw.length > 0
    ? usbPinctrlRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const cbAdcNodeLabel = bc.get('zephyr.adcNode.nodeLabel') as string | undefined;
  const cbAdcClockSource = bc.get('zephyr.adcNode.clockSource') as string | undefined;
  const cbAdcPrescaler = bc.get('zephyr.adcNode.prescaler') as number | undefined;
  const cbAdcPinctrl = bc.get('zephyr.adcNode.pinctrl') as string | undefined;
  const customBoard =
    socs.length > 0 &&
    consoleNodeLabel && consoleTx && consoleRx &&
    hseMHz != null && pllDivM != null && pllMulN != null && pllDivP != null &&
    pllDivQ != null && sysMHz != null
      ? {
          socs,
          dtsIncludes: typeof dtsIncludesRaw === 'string' && dtsIncludesRaw.length > 0
            ? dtsIncludesRaw.split(',').map((s) => s.trim()).filter(Boolean)
            : [],
          console: {
            nodeLabel: consoleNodeLabel,
            tx: consoleTx,
            rx: consoleRx,
            speed: consoleSpeed ?? 115200,
          },
          clocks: {
            hseMHz,
            pll: { divM: pllDivM, mulN: pllMulN, divP: pllDivP, divQ: pllDivQ },
            sysMHz,
            ahbPrescaler: (bc.get('zephyr.clocks.ahbPrescaler') as number) ?? 1,
            apb1Prescaler: (bc.get('zephyr.clocks.apb1Prescaler') as number) ?? 1,
            apb2Prescaler: (bc.get('zephyr.clocks.apb2Prescaler') as number) ?? 1,
          },
          ...(usbNode ? { usbNode } : {}),
          ...(usbPinctrl ? { usbPinctrl } : {}),
          ...(cbAdcNodeLabel && cbAdcClockSource && cbAdcPrescaler != null && cbAdcPinctrl
            ? { adcNode: { nodeLabel: cbAdcNodeLabel, clockSource: cbAdcClockSource, prescaler: cbAdcPrescaler, pinctrl: cbAdcPinctrl } }
            : {}),
        }
      : undefined;

  // ── Construct the final readonly descriptor ─────────────────────────────

  const gpio: ZephyrChipDescriptor['gpio'] = {
    dtSpecs,
    ...(intPins.length > 0 ? { interruptPins: intPins } : {}),
  };

  return {
    id,
    soc,
    gpioController: zGpioController ?? 'gpio0',
    ...(gc.length > 0 ? { gpioControllers: gc } : {}),
    gpio,
    ...(i2cControllers.length > 0 ? { i2c: { controllers: i2cControllers } } : {}),
    ...(spiControllers.length > 0 ? { spi: { controllers: spiControllers } } : {}),
    ...(uartControllers.length > 0 ? { uart: { controllers: uartControllers } } : {}),
    ...(pwmSpecs.length > 0 || pwmMatrix
      ? {
          pwm: {
            specs: pwmSpecs,
            ...(pwmMatrix ? { matrix: pwmMatrix } : {}),
            ...(pwmClockHz ? { clockHz: pwmClockHz } : {}),
          },
        }
      : {}),
    ...(adcNodeLabel || adcResolution != null || adcVref != null || adcChannels.length > 0
      ? {
          adc: {
            nodeLabel: adcNodeLabel ?? 'adc',
            resolution: adcResolution ?? 12,
            vrefMv: adcVref ?? 3000,
            channels: adcChannels,
            ...(adcGain ? { gain: adcGain } : {}),
            ...(adcReference ? { reference: adcReference } : {}),
          },
        }
      : {}),
    ...(dacDevice && dacChannels.length > 0 ? { dac: { device: dacDevice, channels: dacChannels } } : {}),
    ...(wdtNodeLabel ? { wdt: { nodeLabel: wdtNodeLabel } } : {}),
    ...(hwtimerControllers.length > 0 ? { hwtimer: { controllers: hwtimerControllers } } : {}),
    ...(storageOffset != null && storageSize != null
      ? { storage: { offset: storageOffset, size: storageSize, ...(storagePreexisting ? { preexisting: true } : {}) } }
      : {}),
    ...(usbController && usbCdcInstances && usbCdcInstances > 0
      ? {
          usb: {
            controller: usbController,
            cdcInstances: usbCdcInstances,
            ...(usbVid ? { vid: usbVid } : {}),
            ...(usbPid ? { pid: usbPid } : {}),
            ...(trFlag != null && trMagic != null
              ? {
                  touchReset: {
                    flagAddress: trFlag,
                    magic: trMagic,
                    ...(trVid ? { bootloaderVid: trVid } : {}),
                    ...(trPid ? { bootloaderPid: trPid } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(wifiSupported ? { wifi: { supported: true as const } } : {}),
    ...(probeMethods.length > 0 ? { probeMethods } : {}),
    ...(customBoard ? { customBoard } : {}),
  };
}

/**
 * Board-level PWM specs from the generated board manifest (zephyr.pwm.specs.*
 * — the pwm-leds facts boardgen emits on virtual pins 8192+). The active
 * chip's spec table is silicon-curated; these JOIN it (see mergeBoardPwmSpecs)
 * so a board's own devicetree-aliased PWM LED is addressable without curation.
 */
export function boardPwmSpecsFromConstants(
  bc: BoardConstants | undefined,
): ZephyrPwmSpec[] {
  if (!bc) return [];
  const specs: ZephyrPwmSpec[] = [];
  for (let i = 0; i < 256; i++) {
    const pin = bc.get(`zephyr.pwm.specs.${i}.pin`) as number | undefined;
    if (pin == null) break;
    const dtSpec = bc.get(`zephyr.pwm.specs.${i}.dtSpec`) as string | undefined;
    const controller = bc.get(`zephyr.pwm.specs.${i}.controller`) as string | undefined;
    const channel = bc.get(`zephyr.pwm.specs.${i}.channel`) as number | undefined;
    if (!(dtSpec || (controller && channel != null))) continue;
    specs.push({
      pin,
      ...(dtSpec ? { dtSpec } : {}),
      ...(controller ? { controller } : {}),
      ...(channel != null ? { channel } : {}),
    });
  }
  return specs;
}

/**
 * Merge board-level PWM specs into a chip descriptor. Collision rule: a
 * board spec whose pin OR dtSpec already exists in the chip's table is
 * dropped (the curated entry wins — e.g. the XIAO's hand-tuned pwm-led0
 * spec). Returns the chip unchanged when nothing joins.
 */
export function mergeBoardPwmSpecs(
  chip: ZephyrChipDescriptor,
  boardSpecs: readonly ZephyrPwmSpec[],
): ZephyrChipDescriptor {
  if (boardSpecs.length === 0) return chip;
  const existing = chip.pwm?.specs ?? [];
  const joining = boardSpecs.filter(
    (s) => !existing.some((e) => e.pin === s.pin || (s.dtSpec != null && e.dtSpec === s.dtSpec)),
  );
  if (joining.length === 0) return chip;
  return {
    ...chip,
    pwm: {
      specs: [...existing, ...joining],
      ...(chip.pwm?.matrix ? { matrix: chip.pwm.matrix } : {}),
      ...(chip.pwm?.clockHz ? { clockHz: chip.pwm.clockHz } : {}),
    },
  };
}
