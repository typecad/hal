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
  | 'analog-input'  // IAnalogInput  — A0-A5, SDA, SCL
  | 'digital'       // IDigitalPin   — D0-D13 (non-PWM), LED, TX, RX, MISO, SCK, SS_DIGITAL
  | 'pwm'           // IPWMPin       — D3, D5, D6, D9, D10, D11 (MOSI, SS are also PWM)
  | 'serial'        // ISerialPort   — Serial
  | 'i2c'           // II2CBus       — I2C0
  | 'spi'           // ISPIBus       — SPI0
  | 'unknown';      // Not a typecode symbol

/**
 * Static mapping of every known typecode export name to its receiver kind.
 * Covers all Arduino Uno board exports plus common peripheral names.
 */
const STATIC_KINDS: Readonly<Record<string, TypecodeReceiverKind>> = {
  // ---- Digital-only pins ------------------------------------------------
  D0:  'digital',
  D1:  'digital',
  D2:  'digital',
  D4:  'digital',
  D7:  'digital',
  D8:  'digital',
  D12: 'digital',
  D13: 'digital',

  // ---- PWM-capable pins ------------------------------------------------
  D3:  'pwm',
  D5:  'pwm',
  D6:  'pwm',
  D9:  'pwm',
  D10: 'pwm',
  D11: 'pwm',

  // ---- Analog input pins -----------------------------------------------
  A0:  'analog-input',
  A1:  'analog-input',
  A2:  'analog-input',
  A3:  'analog-input',
  A4:  'analog-input',
  A5:  'analog-input',

  // ---- Named aliases ---------------------------------------------------
  LED:  'digital',        // D13
  SDA:  'analog-input',   // A4  (also I2C when used as bus pin)
  SCL:  'analog-input',   // A5
  MOSI: 'pwm',            // D11
  MISO: 'digital',        // D12
  SCK:  'digital',        // D13
  SS:   'pwm',            // D10
  TX:   'digital',        // D1
  RX:   'digital',        // D0

  // ---- Peripheral objects ----------------------------------------------
  Serial: 'serial',
  I2C0:   'i2c',
  SPI0:   'spi',
};

/**
 * Infer the typecode receiver kind for a given symbol name.
 * Returns `'unknown'` for anything that is not a recognised typecode symbol.
 */
export function inferKindByName(name: string): TypecodeReceiverKind {
  return STATIC_KINDS[name] ?? 'unknown';
}
