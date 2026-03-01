"use strict";
// ---------------------------------------------------------------------------
// Typecode SDK symbol kind inference
//
// Maps known typecode symbol names to their receiver kind.
// This is the ONLY place that knows the mapping — no regexes elsewhere.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferKindByName = inferKindByName;
/**
 * Static mapping of every known typecode export name to its receiver kind.
 * Covers Arduino Uno board exports, ESP32 DevKit exports, and common peripheral names.
 */
const STATIC_KINDS = {
    // ---- Digital-only pins (Arduino Uno) -----------------------------------
    D0: 'digital',
    D1: 'digital',
    D2: 'digital',
    D4: 'digital',
    D7: 'digital',
    D8: 'digital',
    D12: 'digital',
    D13: 'digital',
    // ---- PWM-capable pins (Arduino Uno) ------------------------------------
    D3: 'pwm',
    D5: 'pwm',
    D6: 'pwm',
    D9: 'pwm',
    D10: 'pwm',
    D11: 'pwm',
    // ---- ESP32 DevKit additional PWM-capable pins --------------------------
    D14: 'pwm',
    D15: 'pwm',
    D16: 'pwm',
    D17: 'pwm',
    D18: 'pwm',
    D19: 'pwm',
    D21: 'pwm',
    D22: 'pwm',
    D23: 'pwm',
    D25: 'pwm',
    D26: 'pwm',
    D27: 'pwm',
    D32: 'pwm',
    D33: 'pwm',
    // ---- Analog input pins -----------------------------------------------
    A0: 'analog-input',
    A1: 'analog-input',
    A2: 'analog-input',
    A3: 'analog-input',
    A4: 'analog-input',
    A5: 'analog-input',
    // ---- Named aliases ---------------------------------------------------
    LED: 'digital', // D13 on Uno / D2 on ESP32 DevKit
    SDA: 'analog-input', // A4 on Uno (also I2C when used as bus pin)
    SCL: 'analog-input', // A5 on Uno
    MOSI: 'pwm', // D11 on Uno / D23 on ESP32
    MISO: 'digital', // D12 on Uno / D19 on ESP32
    SCK: 'digital', // D13 on Uno / D18 on ESP32
    SS: 'pwm', // D10 on Uno / D5 on ESP32
    TX: 'digital', // D1
    RX: 'digital', // D0
    // ESP32-specific aliases
    TX2: 'pwm', // D17 on ESP32 (UART2 TX)
    RX2: 'pwm', // D16 on ESP32 (UART2 RX)
    DAC1: 'pwm', // D25 on ESP32 (DAC channel 1)
    DAC2: 'pwm', // D26 on ESP32 (DAC channel 2)
    // ---- NANO 33 IoT additional analog pins (A6, A7) ----------------------
    A6: 'analog-input',
    A7: 'analog-input',
    // ---- Peripheral objects ----------------------------------------------
    Serial: 'serial',
    Serial2: 'serial',
    I2C0: 'i2c',
    SPI0: 'spi',
};
/**
 * Infer the typecode receiver kind for a given symbol name.
 * Returns `'unknown'` for anything that is not a recognised typecode symbol.
 */
function inferKindByName(name) {
    return STATIC_KINDS[name] ?? 'unknown';
}
//# sourceMappingURL=typecode-symbols.js.map