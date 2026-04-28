// ---------------------------------------------------------------------------
// @typehal/core — Peripheral configuration enums
//
// Common preset values for peripheral bus configuration.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// UART Baud Rate
// ---------------------------------------------------------------------------

/**
 * Standard UART baud rates.
 *
 * **Usage:** `UART0.enable(BaudRate.B9600)`
 * **Direct:** `UART0.enable(12345)`
 */
export const BaudRate = {
  B300:    300,
  B1200:   1200,
  B2400:   2400,
  B4800:   4800,
  B9600:   9600,
  B19200:  19200,
  B38400:  38400,
  B57600:  57600,
  B115200: 115200,
  B230400: 230400,
  B460800: 460800,
  B921600: 921600,
} as const;

/** Union type of all standard baud rate values. */
export type BaudRate = typeof BaudRate[keyof typeof BaudRate];

// ---------------------------------------------------------------------------
// I2C Bus Speed
// ---------------------------------------------------------------------------

/**
 * Standard I2C bus speeds.
 *
 * **Usage:** `I2C0.enable(I2CSpeed.Fast)`
 * **Direct:** `I2C0.enable(); I2C0.setClock(350000)`
 */
export const I2CSpeed = {
  /** 100 kHz — Standard mode. */
  Standard:   100_000,
  /** 400 kHz — Fast mode. */
  Fast:       400_000,
  /** 1 MHz — Fast-mode Plus. */
  FastPlus:   1_000_000,
  /** 3.4 MHz — High-speed mode. */
  HighSpeed:  3_400_000,
} as const;

/** Union type of all standard I2C speed values. */
export type I2CSpeed = typeof I2CSpeed[keyof typeof I2CSpeed];

// ---------------------------------------------------------------------------
// SPI Clock Frequency
// ---------------------------------------------------------------------------

/**
 * Common SPI clock frequencies.
 *
 * **Usage:** `SPI0.setFrequency(SPIClock.MHz4)`
 * **Direct:** `SPI0.setFrequency(3_200000)`
 */
export const SPIClock = {
  KHz125:  125_000,
  KHz250:  250_000,
  KHz500:  500_000,
  MHz1:    1_000_000,
  MHz2:    2_000_000,
  MHz4:    4_000_000,
  MHz8:    8_000_000,
  MHz16:   16_000_000,
} as const;

/** Union type of all standard SPI clock values. */
export type SPIClock = typeof SPIClock[keyof typeof SPIClock];

// ---------------------------------------------------------------------------
// Analog Reference Voltage
// ---------------------------------------------------------------------------

/**
 * Analog reference voltage source selection.
 *
 * **Usage:** `A0.setReference(AnalogRef.Default)`
 */
export const AnalogRef = {
  /** Default analog reference (5V on Uno). */
  Default:      0,
  /** Internal reference (1.1V on ATmega328P). */
  Internal:     1,
  /** External reference on AREF pin. */
  External:     2,
  /** Internal 1.1V reference (ATmega specific). */
  Internal1V1:  3,
  /** Internal 2.56V reference (ATmega specific). */
  Internal2V56: 4,
} as const;

/** Union type of all analog reference values. */
export type AnalogRef = typeof AnalogRef[keyof typeof AnalogRef];
