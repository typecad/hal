// ---------------------------------------------------------------------------
// @typehal/board-arduino-uno — Peripheral instances
//
// Concrete HAL class instances. Method calls are inlined by the transpiler
// as direct Arduino C++ (Wire, SPI, Serial library calls).
//
// Arduino Uno only has ONE of each peripheral:
//   - I2C0 (Wire) on pins A4/A5
//   - SPI0 (SPI) on pins D11/D12/D13
//   - UART0 (Serial) on pins D0/D1 + USB
// ---------------------------------------------------------------------------

import { I2CBus, SPIBus, SerialPort, i2cName, spiName, serialName } from '@typehal/typehal';

/** I2C bus 0 (Wire library, pins A4=SDA / A5=SCL). */
export const I2C0 = new I2CBus(i2cName(0));

/** SPI bus 0 (pins D11=MOSI, D12=MISO, D13=SCK, D10=SS). */
export const SPI0 = new SPIBus(spiName(0));

/** Hardware serial (UART 0, pins D0/RX, D1/TX, + USB). */
export const UART0 = new SerialPort(serialName(0));
