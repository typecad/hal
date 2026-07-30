// ---------------------------------------------------------------------------
// @typecad/mcu-nrf52840 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use the nRF52840
// P0.<n> / P1.<n> port notation (P0 = GPIO 0..31, P1 = GPIO 32..47). The
// numeric Pin identity is the GPIO number (P0.X → X, P1.X → 32 + X), which
// matches the Zephyr `gpio0`/`gpio1` controller pin numbering.
//
// MVP scope: the XIAO nRF52840 exposes 11 edge pins (D0–D10), a user LED and
// a user button. This package models those plus the I2C/SPI/UART default pins
// the XIAO exposes via its Grove connector. ADC/PWM channel details are
// recorded for future use but not yet lowered by @typecad/framework-zephyr.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---------------------------------------------------------------------------
// Onboard LED + button
// ---------------------------------------------------------------------------

/** Onboard user LED (active-low). DT alias `led0` on XIAO nRF52840. */
export const LED = new Pin(26);     // P0.26

/** Onboard user button. DT alias `sw0` on XIAO nRF52840. */
export const BUTTON = new Pin(4);   // P0.04

// ---------------------------------------------------------------------------
// XIAO edge pins D0–D10 (silkscreen order)
// ---------------------------------------------------------------------------

export const D0  = new Pin(2);      // P0.02  — A0 / ADC0
export const D1  = new Pin(3);      // P0.03  — A1 / ADC1
export const D2  = new Pin(28);     // P0.28  — A2 / ADC2
export const D3  = new Pin(29);     // P0.29  — A3 / ADC3
export const D4  = new Pin(4);      // P0.04  — (also user button)
export const D5  = new Pin(5);      // P0.05  —
export const D6  = new Pin(43);     // P1.11  — (GPIO 43)
export const D7  = new Pin(44);     // P1.12  — (GPIO 44)
export const D8  = new Pin(8);      // P0.08  —
export const D9  = new Pin(9);      // P0.09  — NFC antenna (shared)
export const D10 = new Pin(10);     // P0.10  — NFC antenna (shared)

// ---------------------------------------------------------------------------
// Default I2C/SPI/UART pins (XIAO Grove / internal)
// ---------------------------------------------------------------------------

export const SDA = new Pin(24);     // P0.24  — I2C SDA
export const SCL = new Pin(25);     // P0.25  — I2C SCL
export const MOSI = new Pin(13);    // P0.13  — SPI MOSI
export const MISO = new Pin(14);    // P0.14  — SPI MISO
export const SCK = new Pin(15);     // P0.15  — SPI SCK
export const TX = new Pin(6);       // P0.06  — UART TX
export const RX = new Pin(34);      // P1.02  — UART RX (GPIO 34)
