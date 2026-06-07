// ---------------------------------------------------------------------------
// @typecad/board-esp32-devkit — Pin aliases and header mappings
// ---------------------------------------------------------------------------

import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5,
  GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19,
  GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33,
  GPIO34, GPIO35, GPIO36, GPIO39,
} from '@typecad/mcu-esp32';

// ---------------------------------------------------------------------------
// Arduino-style pin aliases (D-numbers match GPIO numbers on ESP32 DevKit)
// ---------------------------------------------------------------------------

export const D0  = GPIO0;
export const D1  = GPIO1;
export const D2  = GPIO2;
export const D3  = GPIO3;
export const D4  = GPIO4;
export const D5  = GPIO5;
export const D12 = GPIO12;
export const D13 = GPIO13;
export const D14 = GPIO14;
export const D15 = GPIO15;
export const D16 = GPIO16;
export const D17 = GPIO17;
export const D18 = GPIO18;
export const D19 = GPIO19;
export const D21 = GPIO21;
export const D22 = GPIO22;
export const D23 = GPIO23;
export const D25 = GPIO25;
export const D26 = GPIO26;
export const D27 = GPIO27;
export const D32 = GPIO32;
export const D33 = GPIO33;
export const D34 = GPIO34;
export const D35 = GPIO35;
export const D36 = GPIO36;
export const D39 = GPIO39;

/** Analog input aliases (ADC1 channels on ESP32). */
export const A0 = GPIO36;
export const A1 = GPIO39;
export const A2 = GPIO34;
export const A3 = GPIO35;
export const A4 = GPIO32;
export const A5 = GPIO33;

// ---------------------------------------------------------------------------
// Board-specific aliases
// ---------------------------------------------------------------------------

/** On-board LED (GPIO2 on most ESP32 DevKit boards). */
export const LED = GPIO2;

// Re-export silicon-level aliases (SDA, MOSI, etc.) from MCU package
export { SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2 } from '@typecad/mcu-esp32';