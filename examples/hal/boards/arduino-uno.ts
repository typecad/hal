import { PinClass as Pin, HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, LED_BUILTIN, delay, I2C0, SPI0, UART0 } from '../gpio';

// Digital pins
export const D0:  Pin = new Pin(0);
export const D1:  Pin = new Pin(1);
export const D2:  Pin = new Pin(2);
export const D3:  Pin = new Pin(3);
export const D4:  Pin = new Pin(4);
export const D5:  Pin = new Pin(5);
export const D6:  Pin = new Pin(6);
export const D7:  Pin = new Pin(7);
export const D8:  Pin = new Pin(8);
export const D9:  Pin = new Pin(9);
export const D10: Pin = new Pin(10);
export const D11: Pin = new Pin(11);
export const D12: Pin = new Pin(12);
export const D13: Pin = new Pin(13);

// Analog pins (Arduino Uno: A0=14, A1=15, ..., A5=19)
export const A0: Pin = new Pin(14);
export const A1: Pin = new Pin(15);
export const A2: Pin = new Pin(16);
export const A3: Pin = new Pin(17);
export const A4: Pin = new Pin(18);
export const A5: Pin = new Pin(19);

// Aliases
export { D13 as LED };

// Re-export primitives
export { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, LED_BUILTIN, delay, I2C0, SPI0, UART0 };
