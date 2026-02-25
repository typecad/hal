// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Typed pin exports
//
// Pin numbers equal GPIO numbers on the ESP32.  All output-capable GPIOs
// can use PWM (via the LEDC peripheral) and edge interrupts.
// GPIOs 34, 35, 36, 39 are input-only (no internal pull-up/down).
//
// ADC note: ADC2 pins (D0, D2, D4, D12–D15, D25–D27) cannot be sampled
// while the WiFi stack is active — prefer ADC1 pins (D32, D33, A0–A3)
// for analog reads in WiFi sketches.
// ---------------------------------------------------------------------------

import type {
  IDigitalPin,
  IPWMPin,
  IAnalogInput,
  IInterruptPin,
} from '@typecode/core';

// ---------------------------------------------------------------------------
// Internal stub factories
//
// Return type is `number` (→ C++ `int`) so the transpiler emits the correct
// return type.  The TypeScript-level interface casts on the export sites
// preserve full compile-time type-safety without affecting code-gen.
// ---------------------------------------------------------------------------

function createDigitalPin(pin: number, _gpio: number): number {
  return pin;
}

function createPWMPin(pin: number, _gpio: number): number {
  return pin;
}

function createAnalogPWMPin(pin: number, _gpio: number): number {
  return pin;
}

function createAnalogInputPin(pin: number, _gpio: number): number {
  return pin;
}

// ---------------------------------------------------------------------------
// Digital + PWM pins (output-capable; no ADC)
// ---------------------------------------------------------------------------

/** GPIO 1 — UART0 TX (USB).  Avoid for general use. */
export const D1  = createDigitalPin(1,  1)  as unknown as IDigitalPin & IInterruptPin;
/** GPIO 3 — UART0 RX (USB).  Avoid for general use. */
export const D3  = createDigitalPin(3,  3)  as unknown as IDigitalPin & IInterruptPin;

/** GPIO 5  — VSPI CS / boot-strapping. */
export const D5  = createPWMPin(5,  5)  as unknown as IPWMPin & IInterruptPin;
/** GPIO 16 — UART2 RX default. */
export const D16 = createPWMPin(16, 16) as unknown as IPWMPin & IInterruptPin;
/** GPIO 17 — UART2 TX default. */
export const D17 = createPWMPin(17, 17) as unknown as IPWMPin & IInterruptPin;
/** GPIO 18 — VSPI SCK. */
export const D18 = createPWMPin(18, 18) as unknown as IPWMPin & IInterruptPin;
/** GPIO 19 — VSPI MISO. */
export const D19 = createPWMPin(19, 19) as unknown as IPWMPin & IInterruptPin;
/** GPIO 21 — I2C SDA (Wire default). */
export const D21 = createPWMPin(21, 21) as unknown as IPWMPin & IInterruptPin;
/** GPIO 22 — I2C SCL (Wire default). */
export const D22 = createPWMPin(22, 22) as unknown as IPWMPin & IInterruptPin;
/** GPIO 23 — VSPI MOSI. */
export const D23 = createPWMPin(23, 23) as unknown as IPWMPin & IInterruptPin;

// ---------------------------------------------------------------------------
// Digital + PWM + ADC2 pins (ADC unavailable during WiFi)
// ---------------------------------------------------------------------------

/** GPIO 0  — ADC2_CH1, TOUCH1.  Boot-strapping pin (pull HIGH for normal boot). */
export const D0  = createAnalogPWMPin(0,  0)  as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 2  — ADC2_CH2, TOUCH2.  On-board LED on most DOIT DevKit boards. */
export const D2  = createAnalogPWMPin(2,  2)  as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 4  — ADC2_CH0, TOUCH0. */
export const D4  = createAnalogPWMPin(4,  4)  as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 12 — ADC2_CH5, TOUCH5.  Boot-strapping pin — affects flash voltage. */
export const D12 = createAnalogPWMPin(12, 12) as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 13 — ADC2_CH4, TOUCH4. */
export const D13 = createAnalogPWMPin(13, 13) as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 14 — ADC2_CH6, TOUCH6. */
export const D14 = createAnalogPWMPin(14, 14) as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 15 — ADC2_CH3, TOUCH3.  Boot-strapping pin. */
export const D15 = createAnalogPWMPin(15, 15) as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 25 — ADC2_CH8, DAC channel 1. */
export const D25 = createAnalogPWMPin(25, 25) as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 26 — ADC2_CH9, DAC channel 2. */
export const D26 = createAnalogPWMPin(26, 26) as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 27 — ADC2_CH7, TOUCH7. */
export const D27 = createAnalogPWMPin(27, 27) as unknown as IAnalogInput & IPWMPin & IInterruptPin;

// ---------------------------------------------------------------------------
// Digital + PWM + ADC1 pins (WiFi-safe ADC)
// ---------------------------------------------------------------------------

/** GPIO 32 — ADC1_CH4, TOUCH9.  WiFi-safe analog read. */
export const D32 = createAnalogPWMPin(32, 32) as unknown as IAnalogInput & IPWMPin & IInterruptPin;
/** GPIO 33 — ADC1_CH5, TOUCH8.  WiFi-safe analog read. */
export const D33 = createAnalogPWMPin(33, 33) as unknown as IAnalogInput & IPWMPin & IInterruptPin;

// ---------------------------------------------------------------------------
// Input-only ADC1 pins (no output, no pull-up/down)
// ---------------------------------------------------------------------------

/** GPIO 36 — ADC1_CH0, VP.  Input-only.  WiFi-safe. */
export const A0 = createAnalogInputPin(36, 36) as unknown as IAnalogInput;
/** GPIO 39 — ADC1_CH3, VN.  Input-only.  WiFi-safe. */
export const A1 = createAnalogInputPin(39, 39) as unknown as IAnalogInput;
/** GPIO 34 — ADC1_CH6.  Input-only.  WiFi-safe. */
export const A2 = createAnalogInputPin(34, 34) as unknown as IAnalogInput;
/** GPIO 35 — ADC1_CH7.  Input-only.  WiFi-safe. */
export const A3 = createAnalogInputPin(35, 35) as unknown as IAnalogInput;
/** GPIO 32 — ADC1_CH4 (alias for D32).  WiFi-safe. */
export const A4: IAnalogInput & IPWMPin & IInterruptPin = D32;
/** GPIO 33 — ADC1_CH5 (alias for D33).  WiFi-safe. */
export const A5: IAnalogInput & IPWMPin & IInterruptPin = D33;

// ---------------------------------------------------------------------------
// Convenience aliases
// ---------------------------------------------------------------------------

/** On-board LED — GPIO 2 (DOIT DevKit V1). */
export const LED  = createAnalogPWMPin(2, 2) as unknown as IPWMPin & IInterruptPin;

/** I2C data line — GPIO 21. */
export const SDA  = D21;
/** I2C clock line — GPIO 22. */
export const SCL  = D22;

/** VSPI master-out / slave-in — GPIO 23. */
export const MOSI = D23;
/** VSPI master-in / slave-out — GPIO 19. */
export const MISO = D19;
/** VSPI clock — GPIO 18. */
export const SCK  = D18;
/** VSPI chip select — GPIO 5. */
export const SS   = D5;

/** UART0 transmit — GPIO 1 (USB). */
export const TX   = D1;
/** UART0 receive  — GPIO 3 (USB). */
export const RX   = D3;

/** UART2 transmit — GPIO 17. */
export const TX2  = D17;
/** UART2 receive  — GPIO 16. */
export const RX2  = D16;

/** DAC channel 1 output — GPIO 25. */
export const DAC1 = D25;
/** DAC channel 2 output — GPIO 26. */
export const DAC2 = D26;
