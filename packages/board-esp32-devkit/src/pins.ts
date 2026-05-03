// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit — Pin exports
//
// Each pin is a Pin instance from @typehal/typehal. The transpiler inlines
// method calls as direct Arduino C++.
//
// ESP32 DevKit v1 (38-pin) usable GPIOs:
//   Output-capable: 0-5, 12-19, 21-23, 25-27, 32-33
//   Input-only:     34, 35, 36, 39
//   Flash-connected (unusable): 6-11
// ---------------------------------------------------------------------------

import { Pin } from '@typehal/typehal';

// ---------------------------------------------------------------------------
// Output-capable GPIOs
// ---------------------------------------------------------------------------

// Boot strapping pins (unsafe — affect boot mode)
export const D0  = new Pin(0);   // Boot: HIGH for normal boot. Touch1. ADC2_CH1.
export const D2  = new Pin(2);   // Onboard LED. Touch2. ADC2_CH2.
export const D5  = new Pin(5);   // Boot: must be HIGH. VSPI CS0.
export const D12 = new Pin(12);  // Boot: must be LOW (flash voltage). Touch5. HSPI MISO.
export const D15 = new Pin(15);  // Boot: must be HIGH. Touch3. HSPI CS0.

// UART0 pins (unsafe — interferes with USB serial)
export const D1  = new Pin(1);   // UART0 TX
export const D3  = new Pin(3);   // UART0 RX

// General purpose GPIOs
export const D4  = new Pin(4);   // Touch0. ADC2_CH0.
export const D13 = new Pin(13);  // HSPI MOSI. Touch4. ADC2_CH4.
export const D14 = new Pin(14);  // HSPI SCK. Touch6. ADC2_CH6.
export const D16 = new Pin(16);  // UART2 RX
export const D17 = new Pin(17);  // UART2 TX
export const D18 = new Pin(18);  // VSPI SCK
export const D19 = new Pin(19);  // VSPI MISO
export const D21 = new Pin(21);  // I2C0 SDA
export const D22 = new Pin(22);  // I2C0 SCL
export const D23 = new Pin(23);  // VSPI MOSI

// DAC pins
export const D25 = new Pin(25);  // DAC1. ADC2_CH8.
export const D26 = new Pin(26);  // DAC2. ADC2_CH9.

// Touch + ADC pins
export const D27 = new Pin(27);  // Touch7. ADC2_CH7.
export const D32 = new Pin(32);  // Touch9. ADC1_CH4.
export const D33 = new Pin(33);  // Touch8. ADC1_CH5.

// ---------------------------------------------------------------------------
// Input-only GPIOs — no output, no pull-up/pull-down
// ---------------------------------------------------------------------------

export const D34 = new Pin(34);  // ADC1_CH6
export const D35 = new Pin(35);  // ADC1_CH7
export const D36 = new Pin(36);  // ADC1_CH0 (VP)
export const D39 = new Pin(39);  // ADC1_CH3 (VN)

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
