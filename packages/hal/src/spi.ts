// ---------------------------------------------------------------------------
// SPI — controller identity + device-fact carriers (legacy transfer API removed)
//
// The bus singletons (SPI0/SPI1…) are CONTROLLER SELECTORS; the only method
// they keep is device(cs), producing the fact-carrier the generic Sensor
// catalog consumes (`new Sensor(SENSOR.x, SPI0.device(PA4), { spiHz })`).
// Register/byte access to arbitrary devices is the thin `SPITarget`
// (spi-target.ts): construction emits a devicetree child node (hardware CS,
// spi-max-frequency, mode bits) and the verbs are spi_transceive_dt /
// spi_write_dt / readReg — no manual chip-select toggling, no runtime
// spi_config rebuilding. The former begin/beginTransaction/setMode/transfer
// surface was removed with the legacy Arduino surface.
// ----------------------------------------------------------------------------

import type { Pin } from './gpio.js';

export class SPIDevice {
  private _bus: string;
  private _cs: number;

  constructor(bus: string, chipSelect: number) {
    this._bus = bus;
    this._cs = chipSelect;
  }
}

export class SPIBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  /** Produce the fact-carrier for one chip-select on this controller.
   *  Pass it to `new Sensor(...)`; use `SPITarget` directly instead when you
   *  need transceive/write/readReg verbs. */
  device(chipSelect: Pin): SPIDevice {
    return new SPIDevice(this._bus, chipSelect.number);
  }
}
