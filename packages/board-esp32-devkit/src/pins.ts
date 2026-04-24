// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Typed pin exports
//
// Each pin is exported with the narrowest interface that matches its
// capabilities so that TypeScript prevents invalid operations at compile
// time (e.g. calling high() on an input-only pin).
//
// The factory stubs capture pin/gpio numbers as plain data. The transpiler
// replaces them with architecture-specific C++ during code-gen.
//
// ESP32 DevKit v1 (38-pin) usable GPIOs:
//   Output-capable: 0-5, 12-19, 21-23, 25-27, 32-33
//   Input-only:     34, 35, 36, 39
//   Flash-connected (unusable): 6-11
// ---------------------------------------------------------------------------

import type { PinCapabilityFlags } from '@typecode/core';
import type {
  IESP32FullGPIOPin,
  IESP32InputOnlyPin,
} from './pin-types';

// ---------------------------------------------------------------------------
// Internal stub factories (no-op at runtime; consumed by transpiler)
// ---------------------------------------------------------------------------

const FULL_GPIO_CAPS: PinCapabilityFlags = {
  digitalInput: true, digitalOutput: true,
  analogInput: false, analogOutput: false,
  pwm: true, interrupt: true,
  pullUp: true, pullDown: true,
  touch: false, openDrain: false,
};

const FULL_GPIO_ANALOG_CAPS: PinCapabilityFlags = {
  ...FULL_GPIO_CAPS,
  analogInput: true,
};

const FULL_GPIO_TOUCH_CAPS: PinCapabilityFlags = {
  ...FULL_GPIO_CAPS,
  touch: true,
};

const FULL_GPIO_ANALOG_TOUCH_CAPS: PinCapabilityFlags = {
  ...FULL_GPIO_CAPS,
  analogInput: true,
  touch: true,
};

const FULL_GPIO_DAC_CAPS: PinCapabilityFlags = {
  ...FULL_GPIO_CAPS,
  analogInput: true,
  analogOutput: true,
};

const INPUT_ONLY_CAPS: PinCapabilityFlags = {
  digitalInput: true, digitalOutput: false,
  analogInput: true, analogOutput: false,
  pwm: false, interrupt: true,
  pullUp: false, pullDown: false,
  touch: false, openDrain: false,
};

function createFullGPIOPin(pin: number, gpio: number, caps: PinCapabilityFlags = FULL_GPIO_CAPS): IESP32FullGPIOPin {
  return {
    number: pin,
    gpio,
    capabilities: caps,
  } as unknown as IESP32FullGPIOPin;
}

function createInputOnlyPin(pin: number, gpio: number): IESP32InputOnlyPin {
  return {
    number: pin,
    gpio,
    capabilities: INPUT_ONLY_CAPS,
  } as unknown as IESP32InputOnlyPin;
}

// ---------------------------------------------------------------------------
// Output-capable GPIOs — all support PWM + interrupt + pull-up + pull-down
// ---------------------------------------------------------------------------

// Boot strapping pins (unsafe — affect boot mode)
export const D0:  IESP32FullGPIOPin = createFullGPIOPin(0, 0, FULL_GPIO_ANALOG_TOUCH_CAPS);   // Boot: HIGH for normal boot. Touch1. ADC2_CH1.
export const D2:  IESP32FullGPIOPin = createFullGPIOPin(2, 2, FULL_GPIO_ANALOG_TOUCH_CAPS);   // Onboard LED. Touch2. ADC2_CH2.
export const D5:  IESP32FullGPIOPin = createFullGPIOPin(5, 5);                                 // Boot: must be HIGH. VSPI CS0.
export const D12: IESP32FullGPIOPin = createFullGPIOPin(12, 12, FULL_GPIO_ANALOG_TOUCH_CAPS);  // Boot: must be LOW (flash voltage). Touch5. HSPI MISO.
export const D15: IESP32FullGPIOPin = createFullGPIOPin(15, 15, FULL_GPIO_ANALOG_TOUCH_CAPS);  // Boot: must be HIGH. Touch3. HSPI CS0.

// UART0 pins (unsafe — interferes with USB serial)
export const D1:  IESP32FullGPIOPin = createFullGPIOPin(1, 1);   // UART0 TX
export const D3:  IESP32FullGPIOPin = createFullGPIOPin(3, 3);   // UART0 RX

// General purpose GPIOs
export const D4:  IESP32FullGPIOPin = createFullGPIOPin(4, 4, FULL_GPIO_ANALOG_TOUCH_CAPS);    // Touch0. ADC2_CH0.
export const D13: IESP32FullGPIOPin = createFullGPIOPin(13, 13, FULL_GPIO_ANALOG_TOUCH_CAPS);  // HSPI MOSI. Touch4. ADC2_CH4.
export const D14: IESP32FullGPIOPin = createFullGPIOPin(14, 14, FULL_GPIO_ANALOG_TOUCH_CAPS);  // HSPI SCK. Touch6. ADC2_CH6.
export const D16: IESP32FullGPIOPin = createFullGPIOPin(16, 16);   // UART2 RX
export const D17: IESP32FullGPIOPin = createFullGPIOPin(17, 17);   // UART2 TX
export const D18: IESP32FullGPIOPin = createFullGPIOPin(18, 18);   // VSPI SCK
export const D19: IESP32FullGPIOPin = createFullGPIOPin(19, 19);   // VSPI MISO
export const D21: IESP32FullGPIOPin = createFullGPIOPin(21, 21);   // I2C0 SDA
export const D22: IESP32FullGPIOPin = createFullGPIOPin(22, 22);   // I2C0 SCL
export const D23: IESP32FullGPIOPin = createFullGPIOPin(23, 23);   // VSPI MOSI

// DAC pins
export const D25: IESP32FullGPIOPin = createFullGPIOPin(25, 25, FULL_GPIO_DAC_CAPS);  // DAC1. ADC2_CH8.
export const D26: IESP32FullGPIOPin = createFullGPIOPin(26, 26, FULL_GPIO_DAC_CAPS);  // DAC2. ADC2_CH9.

// Touch + ADC pins
export const D27: IESP32FullGPIOPin = createFullGPIOPin(27, 27, FULL_GPIO_ANALOG_TOUCH_CAPS);  // Touch7. ADC2_CH7.
export const D32: IESP32FullGPIOPin = createFullGPIOPin(32, 32, FULL_GPIO_ANALOG_TOUCH_CAPS);  // Touch9. ADC1_CH4.
export const D33: IESP32FullGPIOPin = createFullGPIOPin(33, 33, FULL_GPIO_ANALOG_TOUCH_CAPS);  // Touch8. ADC1_CH5.

// ---------------------------------------------------------------------------
// Input-only GPIOs — no output, no pull-up/pull-down
// ---------------------------------------------------------------------------

export const D34: IESP32InputOnlyPin = createInputOnlyPin(34, 34);  // ADC1_CH6
export const D35: IESP32InputOnlyPin = createInputOnlyPin(35, 35);  // ADC1_CH7
export const D36: IESP32InputOnlyPin = createInputOnlyPin(36, 36);  // ADC1_CH0 (VP)
export const D39: IESP32InputOnlyPin = createInputOnlyPin(39, 39);  // ADC1_CH3 (VN)

// ---------------------------------------------------------------------------
// Analog aliases (Arduino ESP32 convention)
// ---------------------------------------------------------------------------

/** Analog input 0 — D36 (VP, input-only). */
export const A0 = D36;
/** Analog input 1 — D39 (VN, input-only). */
export const A1 = D39;
/** Analog input 2 — D34 (input-only). */
export const A2 = D34;
/** Analog input 3 — D35 (input-only). */
export const A3 = D35;
/** Analog input 4 — D32. */
export const A4 = D32;
/** Analog input 5 — D33. */
export const A5 = D33;

// ---------------------------------------------------------------------------
// Convenience aliases
// ---------------------------------------------------------------------------

/** On-board LED (D2 on most ESP32 DevKit boards). */
export const LED = D2;

/** I2C data line (D21). */
export const SDA = D21;
/** I2C clock line (D22). */
export const SCL = D22;

/** SPI MOSI — VSPI (D23). */
export const MOSI = D23;
/** SPI MISO — VSPI (D19). */
export const MISO = D19;
/** SPI clock — VSPI (D18). */
export const SCK = D18;
/** SPI slave select — VSPI (D5). */
export const SS = D5;

/** UART0 transmit (D1). */
export const TX = D1;
/** UART0 receive (D3). */
export const RX = D3;

/** UART2 transmit (D17). */
export const TX2 = D17;
/** UART2 receive (D16). */
export const RX2 = D16;

/** DAC channel 1 (D25). */
export const DAC1 = D25;
/** DAC channel 2 (D26). */
export const DAC2 = D26;
