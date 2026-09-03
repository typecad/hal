// ---------------------------------------------------------------------------
// Sensor — generic DT-bound sensor part (Zephyr's uniform sensor API)
//
// `new Sensor(SENSOR.sensirion_sht3xd, I2C1.device(0x44))` covers every part
// in the generated catalog: the constructor's facts (part token + bus +
// address) become a devicetree child node in the generated overlay, and the
// methods lower to Zephyr's one-shape sensor API (sensor_sample_fetch /
// sensor_channel_get). No per-part code exists anywhere — the catalog
// (sensor-catalog.generated.ts) is data, generated from Zephyr's own binding
// YAMLs and driver channel tables.
//
// The channel names are Zephyr verbiage minus the SENSOR_CHAN_ prefix
// (CHAN.AMBIENT_TEMP ↔ SENSOR_CHAN_AMBIENT_TEMP), so any Zephyr sample or
// binding doc greps straight into user code.
// ---------------------------------------------------------------------------

import { sensorFetch, sensorGet } from './emit.js';
import { include } from './include.js';
import type { I2CTarget } from './i2c-target.js';
import type { SPITarget } from './spi-target.js';
import type { SensorChannelOf, SensorBusOf } from './sensor-catalog.generated.js';

/** Part ids the catalog knows (the Sensor<P> narrowing keys). */
type SensorPartId = keyof SensorChannelOf;

/** The bus-device argument a part accepts, from its generated bus map:
 *  SPI-only parts take SPITarget, I2C-only take I2CTarget, dual-bus either. */
type BusDeviceFor<B extends string> = B extends 'spi' ? SPITarget : B extends 'i2c' ? I2CTarget : I2CTarget | SPITarget;
export type SensorBusDevice<P extends SensorPartId = SensorPartId> = BusDeviceFor<SensorBusOf[P]>;

/** Construction options. */
export interface SensorOptions {
  /** SPI clock in Hz, SPI parts only. Default 1 MHz (safe for every
   *  catalog part); raise to the breakout's datasheet maximum. */
  spiHz?: number;
  /** SPI mode (CPOL/CPHA bits), 0-3. Default 0. */
  mode?: 0 | 1 | 2 | 3;
  /** Alert GPIO, for parts whose binding declares alert-gpios. */
  alert?: number;
}

export class Sensor<P extends SensorPartId = SensorPartId> {
  private readonly _part: string;
  private readonly _bus: string = '';
  private readonly _port: number = 0;
  private readonly _kind: string = 'i2c';
  private readonly _spiHz: number = 1000000;
  private readonly _mode: number = 0;
  private readonly _alert: number = -1;

  /** Construct a sensor handle. `part` is a `SENSOR.<name>` token;
   *  `dev` is the bus device (e.g. `I2C1.device(0x44)`) carrying the bus
   *  and address. The transpiler resolves the bus instance and address from
   *  `dev` — the class fields are the IR carrier, not runtime state.
   *  The `P` parameter is editor-only: it narrows `get()` to this part's
   *  channels (from the generated SensorChannelOf map); the transpiler
   *  re-validates at build time with the driver's full channel list. */
  constructor(part: P, dev: SensorBusDevice<P>, opts?: SensorOptions) {
    this._part = part;
    void dev;
    void opts;
  }

  /** Fetch a fresh sample (sensor_sample_fetch). Reads reflect the last
   *  fetch — Zephyr's own fetch/get split, kept verbatim. */
  fetch(): void {
    include('<zephyr/drivers/sensor.h>');
    sensorFetch(this._part, this._bus, this._port, this._kind, this._spiHz, this._mode, this._alert);
  }

  /** Read one channel from the fetched sample (sensor_channel_get).
   *  Returns the value as a double (val1 + val2/1e6). The parameter is
   *  narrowed to this part's channels when constructed from a literal
   *  SENSOR token — `sht3x.get(` completes AMBIENT_TEMP | HUMIDITY and
   *  rejects the rest in the editor. */
  get(chan: SensorChannelOf[P]): number {
    include('<zephyr/drivers/sensor.h>');
    return sensorGet(this._part, this._bus, this._port, this._kind, this._spiHz, this._mode, this._alert, chan);
  }
}
