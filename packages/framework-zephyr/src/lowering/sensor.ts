// ---------------------------------------------------------------------------
// Sensor lowering — Zephyr's uniform sensor API over the generated catalog
//
// One code shape for every part in @typecad/hal's sensor catalog: the op's
// part token resolves to the DT compatible, the bus string to the controller
// index, and the address to the I2C reg. The names are derived identically
// here (device handles), in strategy.ts state blocks, and in the overlay
// scanner (dt-config/overlay.ts + toolchain/index.ts) — the tc-pwm<pin>
// discipline: both sides derive from the same facts, so they cannot drift.
//
// Kconfig: nothing per-part. The in-tree driver Kconfigs are `default y` on
// DT_HAS_<COMPAT>_ENABLED, so the overlay's child node IS the enable switch;
// CONFIG_SENSOR (the umbrella under `if SENSOR`) is usage-gated in
// dt-config/kconfig.ts off the lowered `sensor_` tokens.
// ---------------------------------------------------------------------------

import { SENSOR_PART_INFO } from '@typecad/hal';
import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { parseControllerIndex } from './util.js';

/** Strip the 'SENSOR.' property-access prefix from a part token arg. */
export function sensorPartKey(part: string): string {
  return part.replace(/^SENSOR\./, '');
}

/** Strip the 'CHAN.' property-access prefix from a channel arg. */
export function sensorChanName(chan: string): string {
  return chan.replace(/^CHAN\./, '');
}

/** All names a constructed sensor is known by, derived from the op facts. */
export interface SensorNames {
  /** DT nodelabel of the child node the overlay emits
   *  (tc_<part>_i2c<N>_0x<addr> / tc_<part>_spi<N>_cs<pin>). */
  dtLabel: string;
  /** C device-handle variable (__tc_sensor_<stem>_dev). */
  devVar: string;
  /** C sensor_value scratch variable (__tc_sensor_<stem>_val). */
  valVar: string;
  /** The controller index the bus string carries. */
  busIndex: number;
  /** The bus port: I2C address or SPI CS pin. */
  port: number;
  /** 'i2c' | 'spi'. */
  busKind: 'i2c' | 'spi';
}

/** Derive a sensor's DT/C++ names. The scanner regexes the emitted __tc_
 *  prefix form, so the part group must stay [a-z0-9_]+ and greedy. */
export function sensorNames(part: string, bus: string, port: number | string, busKind: string = 'i2c'): SensorNames {
  const partKey = sensorPartKey(String(part));
  const busIndex = parseControllerIndex(typeof bus === 'string' ? bus : String(bus));
  const portNum = typeof port === 'number' ? port : parseInt(String(port));
  const stem = busKind === 'spi'
    ? `${partKey}_spi${busIndex}_cs${portNum}`
    : `${partKey}_i2c${busIndex}_0x${portNum.toString(16)}`;
  return {
    dtLabel: `tc_${stem}`,
    devVar: `__tc_sensor_${stem}_dev`,
    valVar: `__tc_sensor_${stem}_val`,
    busIndex,
    port: portNum,
    busKind: busKind === 'spi' ? 'spi' : 'i2c',
  };
}

/**
 * Resolve the part token against the generated catalog, validating the bus
 * kind and (when the driver scan knows them) the channel. Throws a build-time
 * error with the Zephyr-facing name — the same words the user would meet in
 * Zephyr docs, checked before west ever runs.
 */
/** @internal */
function requirePartInfo(partKey: string) {
  const info = SENSOR_PART_INFO[partKey];
  if (!info) {
    throw new Error(
      `Sensor part '${partKey}' is not in the Zephyr sensor catalog (SENSOR in @typecad/hal). ` +
        `Check the token against the catalog — it is the compatible with , and - replaced by _.`,
    );
  }
  return info;
}

/** Validate the op's bus kind against the part's bindings. */
function requireBusKind(partKey: string, info: ReturnType<typeof requirePartInfo>, busKind: string) {
  if (!info.buses.includes(busKind)) {
    throw new Error(
      `Sensor part '${partKey}' (${info.compatible}) does not bind on ${busKind.toUpperCase()} — ` +
        `its bindings are ${info.buses.join('/').toUpperCase()}.`,
    );
  }
}

/**
 * Emit the per-sensor state block (device handle + sensor_value scratch).
 * Called from shimLines for each distinct sensor the program's ops reference.
 */
export function sensorStateLines(part: string, bus: string, port: number | string, busKind: string = 'i2c', spiHz: number | string = 0, spiMode: number | string = 0, alertPin: number | string = -1): string[] {
  const partKey = sensorPartKey(String(part));
  requireBusKind(partKey, requirePartInfo(partKey), busKind);
  const n = sensorNames(part, bus, port, busKind);
  // The config comment carries construction facts (SPI clock, mode, alert
  // GPIO) to the overlay scanner — they shape the DT node, not the C++.
  const cfg = `// tc-sensor-cfg: ${n.dtLabel} hz=${Number(spiHz)} mode=${Number(spiMode)} alert=${Number(alertPin)}`;
  return [
    '// CUTTLEFISH_SENSOR_BEGIN',
    `static const struct device* ${n.devVar} = DEVICE_DT_GET(DT_NODELABEL(${n.dtLabel}));`,
    `static struct sensor_value ${n.valVar};`,
    cfg,
    '// CUTTLEFISH_SENSOR_END',
  ];
}

/**
 * Resolve a HAL sensor.* op to Zephyr C++.
 * Returns `{ code }` for fetch (statement), `{ expression }` for get (value).
 */
export function lowerSensor(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  const partKey = sensorPartKey(String(o.part));
  const info = requirePartInfo(partKey);
  requireBusKind(partKey, info, String(o.busKind ?? 'i2c'));
  const n = sensorNames(o.part, o.bus, o.port ?? o.address, String(o.busKind ?? 'i2c'));

  switch (op.operation) {
    case 'sensor.fetch':
      // sensor_sample_fetch. The leading (void) keeps the value scratch
      // referenced under Zephyr's -Werror when the program fetches but never
      // reads a channel (the state block is emitted per referenced sensor).
      return {
        code: `(void)${n.valVar}; sensor_sample_fetch(${n.devVar});`,
      };
    case 'sensor.get': {
      const chan = sensorChanName(String(o.chan));
      if (info.channels.length > 0 && !info.channels.includes(chan)) {
        throw new Error(
          `Sensor part '${partKey}' (${info.compatible}) does not serve channel '${chan}' — ` +
            `its driver serves: ${info.channels.join(', ')}.`,
        );
      }
      // sensor_value is val1 + val2 * 1e-6; evaluate once per read.
      return {
        expression:
          `(sensor_channel_get(${n.devVar}, SENSOR_CHAN_${chan}, &${n.valVar}), ` +
          `static_cast<double>(${n.valVar}.val1) + static_cast<double>(${n.valVar}.val2) / 1000000.0)`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
