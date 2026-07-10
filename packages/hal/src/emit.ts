// ---------------------------------------------------------------------------
// HAL compile-time semantic functions
//
// These functions are resolved to HALOpIR nodes by the transpiler's HAL
// resolver.  The framework strategy translates each operation into
// framework-specific C++ at code generation time.
//
// Pin parameters accept both `number` (legacy framework pin number) and
// `string` (MCU port name like "PB5"). The transpiler resolves port names
// to framework pin numbers via the MCU package's pin mapping.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GPIO — digital pin control
// ---------------------------------------------------------------------------

/** Set a digital pin HIGH or LOW. */
export function gpioWrite(pin: number | string, value: number | boolean): void {}
/** Read a digital pin. Returns HIGH (1) or LOW (0). */
export function gpioRead(pin: number | string): number { return 0; }
/** Toggle a digital pin. */
export function gpioToggle(pin: number | string): void {}
/** Set pin mode: "output" | "input" | "input_pullup" | "input_pulldown". */
export function gpioSetMode(pin: number | string, mode: string): void {}

// ---------------------------------------------------------------------------
// PWM — pulse-width modulation
// ---------------------------------------------------------------------------

/** Write PWM duty cycle to a pin. */
export function pwmWrite(pin: number | string, duty: number): void {}

// ---------------------------------------------------------------------------
// ADC — analog-to-digital conversion
// ---------------------------------------------------------------------------

/** Read analog value from a pin. */
export function adcRead(pin: number | string): number { return 0; }
/** Read analog voltage from a pin (ADC value converted to voltage). */
export function adcReadVoltage(pin: number | string): number { return 0; }
/** Set the analog reference. */
export function adcSetReference(ref: string | number): void {}

// ---------------------------------------------------------------------------
// Interrupts
// ---------------------------------------------------------------------------

/** Attach an interrupt handler to a pin. */
export function interruptAttach(pin: number | string, handler: string, mode: string): void {}
/** Detach an interrupt from a pin. */
export function interruptDetach(pin: number | string): void {}

// ---------------------------------------------------------------------------
// Tone / audio output
// ---------------------------------------------------------------------------

/** Play a tone on a pin at the given frequency, optionally for a duration. */
export function tonePlay(pin: number | string, frequency: number, duration?: number): void {}
/** Stop tone playback on a pin. */
export function toneStop(pin: number | string): void {}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Delay for the given number of milliseconds. */
export function delayMs(ms: number): void {}
/** Delay for the given number of microseconds. */
export function delayMicro(us: number): void {}
/** Get milliseconds since boot. */
export function getMillis(): number { return 0; }
/** Get microseconds since boot. */
export function getMicros(): number { return 0; }

// ---------------------------------------------------------------------------
// I2C — inter-integrated circuit bus
// ---------------------------------------------------------------------------

/** Initialize I2C bus (master mode if no address, slave mode with address). */
export function i2cBegin(bus: string, address?: number): void {}
/** Disable I2C bus. */
export function i2cEnd(bus: string): void {}
/** Set I2C bus clock speed. */
export function i2cSetClock(bus: string, hz: number): void {}
/** Begin I2C transmission to a slave address. */
export function i2cBeginTx(bus: string, address: number): void {}
/** Write data to I2C bus. */
export function i2cWrite(bus: string, data: string | number | number[] | Uint8Array): void {}
/** Write a byte buffer to I2C bus (expands array literals to per-byte writes). */
export function i2cWriteBuffer(bus: string, data: number[] | Uint8Array): void {}
/** Read bytes from I2C bus into a buffer (or discard when no buffer is bound). */
export function i2cReadBuffer(bus: string, count: number): void {}
/** End I2C transmission. Returns status. */
export function i2cEndTx(bus: string, stop: boolean): number { return 0; }
/** Request bytes from I2C slave. */
export function i2cRequestFrom(bus: string, address: number, quantity: number, stop?: boolean): number { return 0; }
/** Check if bytes are available from I2C. */
export function i2cAvailable(bus: string): number { return 0; }
/** Read a byte from I2C. */
export function i2cRead(bus: string): number { return 0; }

// ---------------------------------------------------------------------------
// SPI — serial peripheral interface
// ---------------------------------------------------------------------------

/** Initialize SPI bus. */
export function spiBegin(bus: string): void {}
/** Disable SPI bus. */
export function spiEnd(bus: string): void {}
/** Transfer data on SPI bus. */
export function spiTransfer(bus: string, data: string | number | Uint8Array): number { return 0; }
/** Begin SPI transaction with settings. */
export function spiBeginTx(bus: string, settings: string | any): void {}
/** End SPI transaction. */
export function spiEndTx(bus: string): void {}
/** Set SPI chip-select pin LOW. */
export function spiCsLow(pin: number | string): void {}
/** Set SPI chip-select pin HIGH. */
export function spiCsHigh(pin: number | string): void {}
/** Set SPI data mode. */
export function spiSetMode(bus: string, mode: number): void {}
/** Set SPI bit order. */
export function spiSetBitOrder(bus: string, order: string): void {}

// ---------------------------------------------------------------------------
// UART — serial communication
// ---------------------------------------------------------------------------

/** Initialize serial port with baud rate. */
export function uartBegin(port: string, baud: number): void {}
/** Disable serial port. */
export function uartEnd(port: string): void {}
/** Print value to serial. */
export function uartPrint(port: string, value: any): void {}
/** Print value with newline to serial. */
export function uartPrintln(port: string, value: any): void {}
/** Write raw data to serial. */
export function uartWrite(port: string, data: any): void {}
/** Read a byte from serial. */
export function uartRead(port: string): number { return 0; }
/** Peek at next byte from serial without consuming. */
export function uartPeek(port: string): number { return 0; }
/** Check if bytes are available from serial. */
export function uartAvailable(port: string): number { return 0; }
/** Flush serial output. */
export function uartFlush(port: string): void {}

// ---------------------------------------------------------------------------
// Pulse measurement
// ---------------------------------------------------------------------------

/** Measure pulse duration on a pin. */
export function pulseIn_(pin: number | string, value: number, timeout?: number): number { return 0; }
/** Measure long pulse using high-precision timer. */
export function pulseInLong_(pin: number | string, value: number): number { return 0; }

// ---------------------------------------------------------------------------
// Shift register
// ---------------------------------------------------------------------------

/** Shift a byte out to a pin. */
export function shiftOut_(dataPin: number | string, clockPin: number | string, bitOrder: number, value: number): void {}
/** Shift a byte in from a pin. */
export function shiftIn_(dataPin: number | string, clockPin: number | string, bitOrder: number): number { return 0; }

// ---------------------------------------------------------------------------
// Board constant resolution
// ---------------------------------------------------------------------------

/** Write a value to a DAC pin. */
export function dacWrite(pin: number | string, value: number): void {}

/** Resolve a board definition path to a compile-time constant. */
export function boardResolve(path: string): any { return undefined as any; }

// ---------------------------------------------------------------------------
// Raw C++ escape hatch
// ---------------------------------------------------------------------------

/** Emit raw C++ code (escape hatch for unsupported operations). */
export function rawCpp(code: string): void {}

/** Alias for rawCpp() — inject raw C++ text at the call site during transpilation. */
export function emit(code: string): void {}
