// ---------------------------------------------------------------------------
// @typecad/mcu-nrf52840 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use the nRF52840
// P0.<n> / P1.<n> port notation (P0 = GPIO 0..31, P1 = GPIO 32..47). The
// numeric Pin identity is the GPIO number (P0.X → X, P1.X → 32 + X), which
// matches the Zephyr `gpio0`/`gpio1` controller pin numbering.
//
// The preferred way to refer to a pin is by its port/number form (P0_28,
// P1_11, …) because that is the notation printed in the datasheet and on a
// schematic — see "Pin Naming Conventions" in the root AGENTS.md. The
// board-silkscreen D0–D10 names and the I2C/SPI/UART convenience aliases
// below point at the same pins.
//
// MVP scope: the XIAO nRF52840 exposes 11 edge pins (D0–D10), a user LED and
// a user button. This package models those plus the I2C/SPI/UART default pins
// the XIAO exposes via its Grove connector. ADC/PWM channel details are
// recorded for future use but not yet lowered by @typecad/framework-zephyr.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---------------------------------------------------------------------------
// Port/number pin exports — the canonical, schematic-facing form.
//
// `P0.<n>` / `P1.<n>` are not legal JS identifiers, so the exports below use
// an underscore: P0_28 == Pin.fromPort("P0.28"). The transpiler resolves the
// port string to the GPIO number via the MCU manifest (mcuPinForwardMap).
// ---------------------------------------------------------------------------

export const P0_02 = Pin.fromPort('P0.02');
export const P0_03 = Pin.fromPort('P0.03');
export const P0_04 = Pin.fromPort('P0.04');
export const P0_05 = Pin.fromPort('P0.05');
export const P0_06 = Pin.fromPort('P0.06');
export const P0_08 = Pin.fromPort('P0.08');
export const P0_09 = Pin.fromPort('P0.09');
export const P0_10 = Pin.fromPort('P0.10');
export const P0_13 = Pin.fromPort('P0.13');
export const P0_14 = Pin.fromPort('P0.14');
export const P0_15 = Pin.fromPort('P0.15');
export const P0_17 = Pin.fromPort('P0.17');
export const P0_24 = Pin.fromPort('P0.24');
export const P0_25 = Pin.fromPort('P0.25');
export const P0_26 = Pin.fromPort('P0.26');
export const P0_28 = Pin.fromPort('P0.28');
export const P0_29 = Pin.fromPort('P0.29');
export const P1_02 = Pin.fromPort('P1.02');
export const P1_11 = Pin.fromPort('P1.11');
export const P1_12 = Pin.fromPort('P1.12');

// ---------------------------------------------------------------------------
// Onboard LED + button
// ---------------------------------------------------------------------------

/** Onboard user LED (active-low). DT alias `led0` on XIAO nRF52840. */
export const LED = P0_26;

/** Onboard user button. DT alias `sw0` on XIAO nRF52840. */
export const BUTTON = P0_04;

// ---------------------------------------------------------------------------
// XIAO edge pins D0–D10 (silkscreen order)
// ---------------------------------------------------------------------------

export const D0  = P0_02;   // A0 / ADC0
export const D1  = P0_03;   // A1 / ADC1
export const D2  = P0_28;   // A2 / ADC2
export const D3  = P0_29;   // A3 / ADC3
export const D4  = P0_04;   // (also user button)
export const D5  = P0_05;   //
export const D6  = P1_11;   // (GPIO 43)
export const D7  = P1_12;   // (GPIO 44)
export const D8  = P0_08;   //
export const D9  = P0_09;   // NFC antenna (shared)
export const D10 = P0_10;   // NFC antenna (shared)

// ---------------------------------------------------------------------------
// Default I2C/SPI/UART pins (XIAO Grove / internal)
// ---------------------------------------------------------------------------

export const SDA = P0_24;   // I2C SDA
export const SCL = P0_25;   // I2C SCL
export const MOSI = P0_13;  // SPI MOSI
export const MISO = P0_14;  // SPI MISO
export const SCK = P0_15;   // SPI SCK
export const TX = P0_06;    // UART TX
export const RX = P1_02;    // UART RX (GPIO 34)
