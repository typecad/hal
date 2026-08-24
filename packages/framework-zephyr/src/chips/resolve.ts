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
    return nodeLabel ? { nodeLabel } : null;
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
  if (!boardTarget) return null;

  const zGpioController = bc.get('zephyr.gpioController') as string | undefined;
  const soc = (bc.get('mcu.id') as string) ?? '';

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

  // USB device (CDC-ACM): zephyr.usb.controller + zephyr.usb.cdcInstances
  // (+ optional vid/pid for the device descriptor).
  const usbController = bc.get('zephyr.usb.controller') as string | undefined;
  const usbCdcInstances = bc.get('zephyr.usb.cdcInstances') as number | undefined;
  const usbVid = bc.get('zephyr.usb.vid') as string | undefined;
  const usbPid = bc.get('zephyr.usb.pid') as string | undefined;

  const probeMethods = collectIndexed<ZephyrProbeMethod>(bc, 'zephyr.probeMethods', (m, i) => {
    const id = m.get(`zephyr.probeMethods.${i}.id`) as string;
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

  // ── Construct the final readonly descriptor ─────────────────────────────

  const gpio: ZephyrChipDescriptor['gpio'] = {
    dtSpecs,
    ...(intPins.length > 0 ? { interruptPins: intPins } : {}),
  };

  return {
    id: boardTarget,
    soc,
    gpioController: zGpioController ?? 'gpio0',
    ...(gc.length > 0 ? { gpioControllers: gc } : {}),
    gpio,
    ...(i2cControllers.length > 0 ? { i2c: { controllers: i2cControllers } } : {}),
    ...(spiControllers.length > 0 ? { spi: { controllers: spiControllers } } : {}),
    ...(uartControllers.length > 0 ? { uart: { controllers: uartControllers } } : {}),
    ...(pwmSpecs.length > 0
      ? { pwm: { specs: pwmSpecs, ...(pwmClockHz ? { clockHz: pwmClockHz } : {}) } }
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
    ...(usbController && usbCdcInstances && usbCdcInstances > 0
      ? {
          usb: {
            controller: usbController,
            cdcInstances: usbCdcInstances,
            ...(usbVid ? { vid: usbVid } : {}),
            ...(usbPid ? { pid: usbPid } : {}),
          },
        }
      : {}),
    ...(wifiSupported ? { wifi: { supported: true as const } } : {}),
    ...(probeMethods.length > 0 ? { probeMethods } : {}),
  };
}
