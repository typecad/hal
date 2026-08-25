// ---------------------------------------------------------------------------
// Derive ZephyrChipDescriptor from board/MCU package constants
//
// The board constants resolver extracts flat dot-path scalars from the board
// and MCU definition files. This utility reconstructs the structured
// ZephyrChipDescriptor from those flat keys, merging SoC-level defaults
// (from the MCU package's zephyr field) with board-level overrides (from the
// board package's zephyr field).
//
// When a board package carries Zephyr config, this path replaces the
// hardcoded chip descriptor registry. When it doesn't (legacy), chipForTarget
// still works as the fallback.
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
 * (the caller should fall back to the hardcoded chipForTarget registry).
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
  const soc = (bc.get('mcu.id') as string) ?? (socs[0] ?? '');

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
    };
  });

  const adcNodeLabel = bc.get('zephyr.adc.nodeLabel') as string | undefined;
  // PWM timer input clock — feeds the overlay's 16-bit prescaler derivation.
  const pwmClockHz = bc.get('zephyr.pwm.clockHz') as number | undefined;

  // PWM capability constants (peripherals.pwm.* from the MCU manifest) — the
  // numbers the transpiler constant-folds getPwmFrequency()/getPwmResolution()
  // to; carried so the runtime lowering agrees with the fold.
  const pwmMaxFreq = bc.get('peripherals.pwm.maxFrequency') as number | undefined;
  const pwmResolution = bc.get('peripherals.pwm.resolution') as number | undefined;
  // Human text for the console.log destination build note.
  const consoleDescription = bc.get('zephyr.consoleDescription') as string | undefined;
  const adcResolution = bc.get('zephyr.adc.resolution') as number | undefined;
  const adcVref = bc.get('zephyr.adc.vrefMv') as number | undefined;
  const adcGain = bc.get('zephyr.adc.gain') as string | undefined;
  const adcReference = bc.get('zephyr.adc.reference') as string | undefined;
  const adcChannels = collectIndexed<ZephyrAdcChannel>(bc, 'zephyr.adc.channels', (m, i) => {
    const pin = m.get(`zephyr.adc.channels.${i}.pin`) as number;
    const channel = m.get(`zephyr.adc.channels.${i}.channel`) as number;
    const pinctrl = m.get(`zephyr.adc.channels.${i}.pinctrl`) as string | undefined;
    if (pin != null && channel != null) {
      return { pin, channel, ...(pinctrl ? { pinctrl } : {}) };
    }
    return null;
  });

  const wdtNodeLabel = bc.get('zephyr.wdt.nodeLabel') as string | undefined;

  // Storage partition synthesis (boards whose DTS ships no storage_partition
  // — see ZephyrChipDescriptor.storage).
  const storageOffset = bc.get('zephyr.storage.offset') as number | undefined;
  const storageSize = bc.get('zephyr.storage.size') as number | undefined;

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
    // The flattener stores string arrays comma-joined.
    const split = (v: string | undefined): string[] | undefined =>
      typeof v === 'string' && v.length > 0 ? v.split(',') : undefined;
    const args = split(argsRaw);
    return {
      id,
      runner,
      ...(args ? { args } : {}),
      ...(description ? { description } : {}),
      ...(debugRaw !== undefined ? { debug: debugRaw } : {}),
      ...(debugInterface ? { debugInterface: debugInterface as 'swd' | 'jtag' } : {}),
      ...(debugDevice ? { debugDevice } : {}),
      ...(split(debugCfgRaw) ? { debugCfg: split(debugCfgRaw) } : {}),
      ...(split(debugCfgSourceRaw) ? { debugCfgSource: split(debugCfgSourceRaw) } : {}),
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
    ...(pwmSpecs.length > 0
      ? {
          pwm: {
            specs: pwmSpecs,
            ...(pwmClockHz ? { clockHz: pwmClockHz } : {}),
            ...(pwmMaxFreq !== undefined ? { maxFrequencyHz: pwmMaxFreq } : {}),
            ...(pwmResolution !== undefined ? { resolutionBits: pwmResolution } : {}),
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
    ...(wdtNodeLabel ? { wdt: { nodeLabel: wdtNodeLabel } } : {}),
    ...(storageOffset != null && storageSize != null
      ? { storage: { offset: storageOffset, size: storageSize } }
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
    ...(consoleDescription
      ? { consoleDescription }
      : bc.get('zephyr.console.description')
        ? { consoleDescription: bc.get('zephyr.console.description') as string }
        : {}),
    ...(wifiSupported ? { wifi: { supported: true as const } } : {}),
    ...(probeMethods.length > 0 ? { probeMethods } : {}),
    ...(customBoard ? { customBoard } : {}),
  };
}
