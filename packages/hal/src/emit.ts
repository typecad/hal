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
export declare function gpioWrite(pin: number | string, value: number | boolean): void;
/** Read a digital pin. Returns HIGH (1) or LOW (0). */
export declare function gpioRead(pin: number | string): number;
/** Toggle a digital pin. */
export declare function gpioToggle(pin: number | string): void;
/** Set pin mode: "output" | "input" | "input_pullup" | "input_pulldown". */
export declare function gpioSetMode(pin: number | string, mode: string): void;

// ---------------------------------------------------------------------------
// PWM — pulse-width modulation
// ---------------------------------------------------------------------------

/** Write PWM duty cycle to a pin. */
export declare function pwmWrite(pin: number | string, duty: number): void;

// ---------------------------------------------------------------------------
// ADC — analog-to-digital conversion
// ---------------------------------------------------------------------------

/** Read analog value from a pin. */
export declare function adcRead(pin: number | string): number;
/** Read analog voltage from a pin (ADC value converted to voltage). */
export declare function adcReadVoltage(pin: number | string): number;
/** Set the analog reference. */
export declare function adcSetReference(ref: string | number): void;

// ---------------------------------------------------------------------------
// Interrupts
// ---------------------------------------------------------------------------

/** Attach an interrupt handler to a pin. */
export declare function interruptAttach(pin: number | string, handler: string, mode: string): void;
/** Detach an interrupt from a pin. */
export declare function interruptDetach(pin: number | string): void;

// ---------------------------------------------------------------------------
// Tone / audio output
// ---------------------------------------------------------------------------

/** Play a tone on a pin at the given frequency, optionally for a duration. */
export declare function tonePlay(pin: number | string, frequency: number, duration?: number): void;
/** Stop tone playback on a pin. */
export declare function toneStop(pin: number | string): void;

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Delay for the given number of milliseconds. */
export declare function delayMs(ms: number): void;
/** Delay for the given number of microseconds. */
export declare function delayMicro(us: number): void;
/** Get milliseconds since boot. */
export declare function getMillis(): number;
/** Get microseconds since boot. */
export declare function getMicros(): number;

// ---------------------------------------------------------------------------
// I2C — inter-integrated circuit bus
// ---------------------------------------------------------------------------

/** Initialize I2C bus (master mode if no address, slave mode with address). */
export declare function i2cBegin(bus: string, address?: number): void;
/** Disable I2C bus. */
export declare function i2cEnd(bus: string): void;
/** Set I2C bus clock speed. */
export declare function i2cSetClock(bus: string, hz: number): void;
/** Begin I2C transmission to a slave address. */
export declare function i2cBeginTx(bus: string, address: number): void;
/** Write data to I2C bus. */
export declare function i2cWrite(bus: string, data: string | number | number[] | Uint8Array): void;
/** End I2C transmission. Returns status. */
export declare function i2cEndTx(bus: string, stop: boolean): number;
/** Request bytes from I2C slave. */
export declare function i2cRequestFrom(bus: string, address: number, quantity: number, stop?: boolean): number;
/** Check if bytes are available from I2C. */
export declare function i2cAvailable(bus: string): number;
/** Read a byte from I2C. */
export declare function i2cRead(bus: string): number;

// ---------------------------------------------------------------------------
// SPI — serial peripheral interface
// ---------------------------------------------------------------------------

/** Initialize SPI bus. */
export declare function spiBegin(bus: string): void;
/** Disable SPI bus. */
export declare function spiEnd(bus: string): void;
/** Transfer data on SPI bus. */
export declare function spiTransfer(bus: string, data: string | number | Uint8Array): number;
/** Begin SPI transaction with settings. */
export declare function spiBeginTx(bus: string, settings: string | any): void;
/** End SPI transaction. */
export declare function spiEndTx(bus: string): void;
/** Set SPI chip-select pin LOW. */
export declare function spiCsLow(pin: number | string): void;
/** Set SPI chip-select pin HIGH. */
export declare function spiCsHigh(pin: number | string): void;
/** Set SPI data mode. */
export declare function spiSetMode(bus: string, mode: number): void;
/** Set SPI bit order. */
export declare function spiSetBitOrder(bus: string, order: string): void;

// ---------------------------------------------------------------------------
// UART — serial communication
// ---------------------------------------------------------------------------

/** Initialize serial port with baud rate. */
export declare function uartBegin(port: string, baud: number): void;
/** Disable serial port. */
export declare function uartEnd(port: string): void;
/** Print value to serial. */
export declare function uartPrint(port: string, value: any): void;
/** Print value with newline to serial. */
export declare function uartPrintln(port: string, value: any): void;
/** Write raw data to serial. */
export declare function uartWrite(port: string, data: any): void;
/** Read a byte from serial. */
export declare function uartRead(port: string): number;
/** Peek at next byte from serial without consuming. */
export declare function uartPeek(port: string): number;
/** Check if bytes are available from serial. */
export declare function uartAvailable(port: string): number;
/** Flush serial output. */
export declare function uartFlush(port: string): void;

// ---------------------------------------------------------------------------
// Pulse measurement
// ---------------------------------------------------------------------------

/** Measure pulse duration on a pin. */
export declare function pulseIn_(pin: number | string, value: number, timeout?: number): number;
/** Measure long pulse using high-precision timer. */
export declare function pulseInLong_(pin: number | string, value: number): number;

// ---------------------------------------------------------------------------
// Shift register
// ---------------------------------------------------------------------------

/** Shift a byte out to a pin. */
export declare function shiftOut_(dataPin: number | string, clockPin: number | string, bitOrder: number, value: number): void;
/** Shift a byte in from a pin. */
export declare function shiftIn_(dataPin: number | string, clockPin: number | string, bitOrder: number): number;

// ---------------------------------------------------------------------------
// Board constant resolution
// ---------------------------------------------------------------------------

/** Write a value to a DAC pin. */
export declare function dacWrite(pin: number | string, value: number): void;

/** Resolve a board definition path to a compile-time constant. */
export declare function boardResolve(path: string): any;

// ---------------------------------------------------------------------------
// Raw C++ escape hatch
// ---------------------------------------------------------------------------

/** Emit raw C++ code (escape hatch for unsupported operations). */
export declare function rawCpp(code: string): void;
