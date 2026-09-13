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
  /** Alert pin, on parts that expose one. */
  alert?: number;
}

/**
 * A sensor from the board-support catalog — one shape for every supported
 * part: `const s = new Sensor(SENSOR.sensirion_sht3xd, I2C1.device(0x44))`.
 * `fetch()` reads a fresh sample from the device; `get(CHAN.AMBIENT_TEMP)`
 * returns one value from the last fetch. Constructing with a literal
 * `SENSOR.x` token narrows `get()` to that part's channels, with editor
 * completion.
 */
export class Sensor<P extends SensorPartId = SensorPartId> {
  private readonly _part: string;
  private readonly _bus: string = '';
  private readonly _port: number = 0;
  private readonly _kind: string = 'i2c';
  private readonly _spiHz: number = 1000000;
  private readonly _mode: number = 0;
  private readonly _alert: number = -1;

  /** Construct a sensor handle. `part` is a `SENSOR.<name>` token; `dev`
   *  is the bus device (e.g. `I2C1.device(0x44)`) carrying bus and
   *  address. The type parameter is editor-only — it narrows `get()` to
   *  this part's channels; the build validates against the driver's full
   *  channel list either way. */
  constructor(part: P, dev: SensorBusDevice<P>, opts?: SensorOptions) {
    this._part = part;
    void dev;
    void opts;
  }

  /** Read a fresh sample from the sensor. `get()` returns values from the
   *  last fetch. */
  fetch(): void {
    include('<zephyr/drivers/sensor.h>');
    sensorFetch(this._part, this._bus, this._port, this._kind, this._spiHz, this._mode, this._alert);
  }

  /** Read one channel of the last fetched sample as a number, in the
   *  part's natural unit (degrees C, %RH, Pa…). With a literal SENSOR
   *  token, the parameter completes to this part's channels and rejects
   *  the others in the editor. */
  get(chan: SensorChannelOf[P]): number {
    include('<zephyr/drivers/sensor.h>');
    return sensorGet(this._part, this._bus, this._port, this._kind, this._spiHz, this._mode, this._alert, chan);
  }
}
