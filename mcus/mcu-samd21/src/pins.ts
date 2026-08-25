// ---------------------------------------------------------------------------
// @typecad/mcu-samd21 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use the SAM D21
// P<port><bit> notation (PA2, PB8) matching the datasheet and the schematic.
// The numeric Pin identity uses port-block numbering — PA<bit> → bit,
// PB<bit> → 32 + bit — which matches Zephyr's per-port `porta`/`portb`
// controller split (see the board package's `zephyr.gpioControllers`).
//
// The preferred way to refer to a pin is its port form (PA2, PB8, …) because
// that is the notation printed in the datasheet and on a schematic — see
// "Pin Naming Conventions" in the root AGENTS.md. Each pin is constructed via
// Pin.fromPort("PA2") so the port string is the pin's canonical identity; the
// transpiler resolves it to the framework pin number via the MCU manifest.
//
// The SAMD21G18A (48-pin TQFP) bonds more pads than any one board exposes;
// this package models the pins reachable on the Arduino Nano 33 IoT (header
// pins + onboard wiring — the u-blox NINA-W102 radio, USB, SWD), verified
// against Zephyr 4.3's boards/arduino/nano_33_iot devicetree (the board dts
// + arduino_nano_33_iot-pinctrl.dtsi + arduino_nano_connector.dtsi).
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---- Port A (pin numbers 0–31) ---------------------------------------------
export const PA2  = Pin.fromPort('PA2');   // AIN0 / A0 header
export const PA4  = Pin.fromPort('PA4');
export const PA5  = Pin.fromPort('PA5');
export const PA6  = Pin.fromPort('PA6');
export const PA7  = Pin.fromPort('PA7');
export const PA8  = Pin.fromPort('PA8');
export const PA9  = Pin.fromPort('PA9');   // AIN17 / A6 header
export const PA10 = Pin.fromPort('PA10');  // AIN18 / A3 header
export const PA11 = Pin.fromPort('PA11');  // AIN19 / A2 header
export const PA12 = Pin.fromPort('PA12');
export const PA13 = Pin.fromPort('PA13');
export const PA14 = Pin.fromPort('PA14');
export const PA15 = Pin.fromPort('PA15');
export const PA16 = Pin.fromPort('PA16');
export const PA17 = Pin.fromPort('PA17');  // AIN? no — TCC2/WO1 PWM + LED + SCK
export const PA18 = Pin.fromPort('PA18');
export const PA19 = Pin.fromPort('PA19');
export const PA20 = Pin.fromPort('PA20');
export const PA21 = Pin.fromPort('PA21');
export const PA22 = Pin.fromPort('PA22');
export const PA23 = Pin.fromPort('PA23');
export const PA24 = Pin.fromPort('PA24');  // USB D-
export const PA25 = Pin.fromPort('PA25');  // USB D+
export const PA27 = Pin.fromPort('PA27');
export const PA28 = Pin.fromPort('PA28');
export const PA30 = Pin.fromPort('PA30');  // SWCLK
export const PA31 = Pin.fromPort('PA31');  // SWDIO

// ---- Port B (pin numbers 32–55) --------------------------------------------
export const PB2  = Pin.fromPort('PB2');   // 32+2  — AIN10 / A1 header
export const PB3  = Pin.fromPort('PB3');   // 32+3  — A7 header
export const PB8  = Pin.fromPort('PB8');   // 32+8  — AIN2 / A4 / I2C SDA
export const PB9  = Pin.fromPort('PB9');   // 32+9  — AIN3 / A5 / I2C SCL
export const PB10 = Pin.fromPort('PB10');  // 32+10 — D2 header
export const PB11 = Pin.fromPort('PB11');  // 32+11 — D3 header
export const PB22 = Pin.fromPort('PB22');  // 32+22 — D1 / UART TX
export const PB23 = Pin.fromPort('PB23');  // 32+23 — D0 / UART RX

// Bus aliases (Nano 33 IoT default wiring — matches the Zephyr board DTS's
// default-enabled sercom4 (I2C), sercom1 (SPI), sercom5 (UART/console))
export const SDA  = PB8;   // SERCOM4 SDA
export const SCL  = PB9;   // SERCOM4 SCL
export const MOSI = PA16;  // SERCOM1 MOSI (D11)
export const MISO = PA19;  // SERCOM1 MISO (D12)
export const SCK  = PA17;  // SERCOM1 SCK (D13)
export const SS   = PA21;  // SPI chip select (D10)
export const TX   = PB22;  // SERCOM5 TX (D1, console)
export const RX   = PB23;  // SERCOM5 RX (D0, console)
