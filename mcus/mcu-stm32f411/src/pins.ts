// ---------------------------------------------------------------------------
// @typecad/mcu-stm32f411 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use the STM32
// P<port><bit> notation (PA0, PB8, PC13) matching the datasheet and the
// schematic. The numeric Pin identity uses port-block numbering —
// PA<bit> → bit, PB<bit> → 16 + bit, PC<bit> → 32 + bit — which matches the
// per-port Zephyr `gpioa`/`gpiob`/`gpioc` controller split (see the board
// package's `zephyr.gpioControllers`).
//
// The preferred way to refer to a pin is its port form (PA5, PB8, …) because
// that is the notation printed in the datasheet and on a schematic — see
// "Pin Naming Conventions" in the root AGENTS.md. Each pin is constructed via
// Pin.fromPort("PA5") so the port string is the pin's canonical identity; the
// transpiler resolves it to the framework pin number via the MCU manifest.
//
// Pin list verified against the STM32F411xC/xE UFQFPN48 package (the F411CEU6
// in the WeAct Black Pill V2.0): PA0–PA15, PB0–PB10, PB12–PB15 (PB11 is not
// bonded on this package), PC13–PC15. PH0/PH1 are the external 25 MHz
// oscillator pins on the Black Pill and are deliberately not exposed.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---- Port A (pin numbers 0–15) --------------------------------------------
export const PA0  = Pin.fromPort('PA0');
export const PA1  = Pin.fromPort('PA1');
export const PA2  = Pin.fromPort('PA2');
export const PA3  = Pin.fromPort('PA3');
export const PA4  = Pin.fromPort('PA4');
export const PA5  = Pin.fromPort('PA5');
export const PA6  = Pin.fromPort('PA6');
export const PA7  = Pin.fromPort('PA7');
export const PA8  = Pin.fromPort('PA8');
export const PA9  = Pin.fromPort('PA9');
export const PA10 = Pin.fromPort('PA10');
export const PA11 = Pin.fromPort('PA11');
export const PA12 = Pin.fromPort('PA12');
export const PA13 = Pin.fromPort('PA13');
export const PA14 = Pin.fromPort('PA14');
export const PA15 = Pin.fromPort('PA15');

// ---- Port B (pin numbers 16–31; PB11 not bonded on UFQFPN48) --------------
export const PB0  = Pin.fromPort('PB0');
export const PB1  = Pin.fromPort('PB1');
export const PB2  = Pin.fromPort('PB2');
export const PB3  = Pin.fromPort('PB3');
export const PB4  = Pin.fromPort('PB4');
export const PB5  = Pin.fromPort('PB5');
export const PB6  = Pin.fromPort('PB6');
export const PB7  = Pin.fromPort('PB7');
export const PB8  = Pin.fromPort('PB8');
export const PB9  = Pin.fromPort('PB9');
export const PB10 = Pin.fromPort('PB10');
export const PB12 = Pin.fromPort('PB12');
export const PB13 = Pin.fromPort('PB13');
export const PB14 = Pin.fromPort('PB14');
export const PB15 = Pin.fromPort('PB15');

// ---- Port C (pin numbers 32–47; only PC13–PC15 on UFQFPN48) ---------------
export const PC13 = Pin.fromPort('PC13');
export const PC14 = Pin.fromPort('PC14');
export const PC15 = Pin.fromPort('PC15');

// Bus aliases (Black Pill default wiring — matches the Zephyr board DTS's
// default-enabled i2c1/spi1/usart1 pinctrl on the same pins)
export const SDA  = PB9;   // I2C1 SDA
export const SCL  = PB8;   // I2C1 SCL
export const MOSI = PA7;   // SPI1 MOSI
export const MISO = PA6;   // SPI1 MISO
export const SCK  = PA5;   // SPI1 SCK
export const SS   = PA4;   // SPI1 NSS
export const TX   = PA9;   // USART1 TX (console)
export const RX   = PA10;  // USART1 RX (console)
