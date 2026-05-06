// Re-export from the new @typehal/hal package for local development.
// In production, users import directly from '@typehal/hal'.
//
// This file exists so examples/hal/ examples can use relative imports
// before the package is published.

export type { Pin } from '@typehal/hal';
export { Pin as PinClass } from '@typehal/hal';
export { emit } from '@typehal/hal';
export { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, LED_BUILTIN } from '@typehal/hal';
export { delay, millis, micros, delayMicroseconds } from '@typehal/hal';
export { I2CBus, I2C0 } from '@typehal/hal';
export { SPIBus, SPI0 } from '@typehal/hal';
export { SerialPort, UART0 } from '@typehal/hal';
