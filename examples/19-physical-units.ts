// ---------------------------------------------------------------------------
// Example 19 — Peripheral Configuration with Enums and Bare Numbers
//
// Demonstrates configuring peripherals using enum shorthand and bare numbers.
// ---------------------------------------------------------------------------

import { I2C0, UART0 } from '@typehal/board-arduino-uno';
import { BaudRate, I2CSpeed } from '@typehal/core';

// Use enum values for standard peripheral configurations
const serial = UART0.begin(BaudRate.B115200);
const sensor = I2C0.begin();
sensor.setClock(I2CSpeed.Fast);  // 400kHz

// Or use bare numbers directly
sensor.setClock(400_000);
serial.begin(9600);

// Higher baud rate
serial.begin(115200);
