// ---------------------------------------------------------------------------
// Typecode SDK symbol kind inference
//
// Maps known typecode symbol names to their receiver kind.
// This is the ONLY place that knows the mapping — no regexes elsewhere.
// ---------------------------------------------------------------------------

/**
 * Which category of typecode object a symbol belongs to.
 * Used by the emitter to select the correct Arduino built-in.
 */
export type TypecodeReceiverKind =
  | 'analog-input'  // AnalogPin     — A0-A5, SDA, SCL
  | 'digital'       // BasePin       — D4, D7, D8, D12, D13, LED, MISO, SCK
  | 'interrupt'     // InterruptPin  — D0, D1, D2 (interrupt-capable digital)
  | 'pwm'           // PWMPin        — D3, D5, D6, D9, D10, D11 (MOSI, SS are also PWM)
  | 'serial'        // ISerialPort   — Serial
  | 'i2c'           // II2CBus       — I2C0
  | 'spi'           // ISPIBus       — SPI0
  | 'pulse'         // Pulse namespace - pulseIn/pulseInLong
  | 'shift'         // Shift namespace - shiftIn/shiftOut
  | 'random'        // Random namespace - random/randomSeed
  | 'num'           // Num namespace - map/constrain/abs/min/max
  | 'eeprom'        // EEPROM namespace - read/write/update/length
  | 'timing'        // Timing namespace - millis/micros/delay/delayMicroseconds
  | 'wdt'           // WDT namespace - enable/reset/disable
  | 'preferences'   // Preferences namespace - key-value NVS (EEPROM-backed on AVR)
  | 'unknown';      // Not a typecode symbol

/**
 * Static mapping of every known typecode export name to its receiver kind.
 * Covers Arduino Uno board exports, ESP32 DevKit exports, and common peripheral names.
 */
const STATIC_KINDS: Readonly<Record<string, TypecodeReceiverKind>> = {
  // ---- Interrupt-capable digital pins (Arduino Uno: INT0=D2, INT1=D3) ----
  // Note: D0, D1 also have interrupt capability on many AVR boards
  D0:  'interrupt',
  D1:  'interrupt',
  D2:  'interrupt',

  // ---- Digital-only pins (Arduino Uno) -----------------------------------
  D4:  'digital',
  D7:  'digital',
  D8:  'digital',
  D12: 'digital',
  D13: 'digital',

  // ---- PWM-capable pins (Arduino Uno) ------------------------------------
  D3:  'pwm',
  D5:  'pwm',
  D6:  'pwm',
  D9:  'pwm',
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
  A0:  'analog-input',
  A1:  'analog-input',
  A2:  'analog-input',
  A3:  'analog-input',
  A4:  'analog-input',
  A5:  'analog-input',

  // ---- Named aliases ---------------------------------------------------
  LED:  'digital',        // D13 on Uno / D2 on ESP32 DevKit
  SDA:  'analog-input',   // A4 on Uno (also I2C when used as bus pin)
  SCL:  'analog-input',   // A5 on Uno
  MOSI: 'pwm',            // D11 on Uno / D23 on ESP32
  MISO: 'digital',        // D12 on Uno / D19 on ESP32
  SCK:  'digital',        // D13 on Uno / D18 on ESP32
  SS:   'pwm',            // D10 on Uno / D5 on ESP32
  TX:   'interrupt',      // D1 (interrupt-capable)
  RX:   'interrupt',      // D0 (interrupt-capable)
  // ESP32-specific aliases
  TX2:  'pwm',            // D17 on ESP32 (UART2 TX)
  RX2:  'pwm',            // D16 on ESP32 (UART2 RX)
  DAC1: 'pwm',            // D25 on ESP32 (DAC channel 1)
  DAC2: 'pwm',            // D26 on ESP32 (DAC channel 2)

  // ---- ESP32 DevKit input-only analog pins --------------------------------
  D34: 'analog-input',
  D35: 'analog-input',
  D36: 'analog-input',
  D39: 'analog-input',

  // ---- NANO 33 IoT additional analog pins (A6, A7) ----------------------
  A6:  'analog-input',
  A7:  'analog-input',

   // ---- Peripheral objects ----------------------------------------------
  I2C0:    'i2c',
  I2C1:    'i2c',
  I2C2:    'i2c',
  SPI0:    'spi',
  SPI1:    'spi',
  UART2:   'serial',

  // ---- Utility namespaces ----------------------------------------------
  Pulse:   'pulse',
  Shift:   'shift',
  Random:  'random',
  Num:     'num',

  // ---- Arduino peripheral namespaces ------------------------------------
  EEPROM:  'eeprom',
  Timing:  'timing',
  WDT:          'wdt',
  Preferences:  'preferences',
};

/**
 * Return all pin names (e.g. "A0", "D3") that have the given receiver kind.
 * Used by validators to suggest alternative pins in error messages.
 */
export function pinsWithKind(kind: TypecodeReceiverKind): string[] {
  return Object.entries(STATIC_KINDS)
    .filter(([_, k]) => k === kind)
    .filter(([name]) => /^[DA]\d+$/.test(name))
    .sort()
    .map(([name]) => name);
}

/**
 * Infer the typecode receiver kind for a given symbol name.
 * Returns `'unknown'` for anything that is not a recognised typecode symbol.
 */
export function inferKindByName(name: string): TypecodeReceiverKind {
  // Pattern match peripheral instances (I2C0, I2C1, I2C2, etc.)
  if (/^I2C\d+$/.test(name)) return 'i2c';
  if (/^SPI\d+$/.test(name)) return 'spi';
  if (/^UART\d+$/.test(name)) return 'serial';
  
  // Fall back to static mapping for pins and other symbols
  return STATIC_KINDS[name] ?? 'unknown';
}