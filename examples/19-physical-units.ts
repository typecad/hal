// ---------------------------------------------------------------------------
// Example 19 — Peripheral Configuration with Bare Numbers
//
// Demonstrates configuring peripherals using bare numeric values. Standard
// baud rates and I2C clock speeds are passed directly.
// ---------------------------------------------------------------------------

import { I2C0, UART0 } from '@typecad/board-arduino-uno';

// Standard baud rates and I2C clock speeds are plain numbers.
const serial = UART0.begin(115200);
const sensor = I2C0.begin();
sensor.setClock(400_000);  // 400kHz Fast Mode

// Or use other standard values directly.
serial.begin(9600);
sensor.setClock(100_000);  // 100kHz Standard Mode
