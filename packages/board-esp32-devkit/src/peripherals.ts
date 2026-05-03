// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit — Peripheral instances
//
// Concrete HAL class instances. Method calls are inlined by the transpiler
// as direct Arduino C++ (Wire, SPI, Serial library calls).
//
// ESP32 DevKit peripherals:
//   - I2C0  (Wire)  on pins D21/D22
//   - I2C1  (Wire1) no fixed pins (remappable)
//   - SPI0  (FSPI)  on pins D13/D12/D14/D15
//   - SPI1  (VSPI)  on pins D23/D19/D18/D5
//   - UART0 (Serial)  on pins D1/D3 (USB serial)
//   - UART2 (Serial2) on pins D17/D16
// ---------------------------------------------------------------------------

import { I2CBus, SPIBus, SerialPort, i2cName, spiName, serialName } from '@typehal/typehal';

/** I2C bus 0 (Wire library, pins D21=SDA / D22=SCL). */
export const I2C0 = new I2CBus(i2cName(0));

/** I2C bus 1 (no fixed default pins — remap via Wire1.begin(SDA, SCL)). */
export const I2C1 = new I2CBus(i2cName(1));

/** SPI bus 0 / FSPI (pins D13=MOSI, D12=MISO, D14=SCK, D15=CS). */
export const SPI0 = new SPIBus(spiName(0));

/** SPI bus 1 / VSPI (pins D23=MOSI, D19=MISO, D18=SCK, D5=CS). */
export const SPI1 = new SPIBus(spiName(1));

/** Hardware serial 0 / UART0 (pins D1=TX, D3=RX, USB-CDC). */
export const UART0 = new SerialPort(serialName(0));

/** Hardware serial 2 / UART2 (pins D17=TX, D16=RX). */
export const UART2 = new SerialPort(serialName(2));
