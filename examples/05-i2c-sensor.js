"use strict";
// ---------------------------------------------------------------------------
// Example 5 — I2C Sensor Read
//
// Initialize Wire (I2C0), talk to a BME280 at 0x76, and print temperature.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const peripherals_1 = require("../code/board-arduino-uno/peripherals");
const timing_1 = require("../code/board-arduino-uno/timing");
peripherals_1.Serial.initialize({ baudRate: 9600 });
peripherals_1.I2C0.initialize();
const BME280_ADDR = 0x76;
while (true) {
    const tempRaw = peripherals_1.I2C0.readWord(BME280_ADDR, 0xFA);
    const temperature = tempRaw / 100.0;
    peripherals_1.Serial.println(temperature);
    (0, timing_1.delay)(1000);
}
