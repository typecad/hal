// Re-export from the new @typecad/hal package for local development.
// In production, users import directly from '@typecad/hal'.
//
// This file exists so examples/hal/ examples can use relative imports
// before the package is published.

export type { Pin } from '@typecad/hal';
export { Pin as PinClass } from '@typecad/hal';
export { emit } from '@typecad/hal';
export { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, LED_BUILTIN } from '@typecad/hal';
export { delay, millis, micros, delayMicroseconds } from '@typecad/hal';
export { I2CBus, I2C0 } from '@typecad/hal';
export { SPIBus, SPI0 } from '@typecad/hal';
export { SerialPort, UART0 } from '@typecad/hal';
