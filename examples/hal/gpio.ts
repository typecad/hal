// Re-export from the new @typehal/typehal package for local development.
// In production, users import directly from '@typehal/typehal'.
//
// This file exists so examples/hal/ examples can use relative imports
// before the package is published.

export type { Pin } from '@typehal/typehal';
export { Pin as PinClass } from '@typehal/typehal';
export { emit } from '@typehal/typehal';
export { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, LED_BUILTIN } from '@typehal/typehal';
export { delay, millis, micros, delayMicroseconds } from '@typehal/typehal';
export { I2CBus, I2C0 } from '@typehal/typehal';
export { SPIBus, SPI0 } from '@typehal/typehal';
export { SerialPort, UART0 } from '@typehal/typehal';
