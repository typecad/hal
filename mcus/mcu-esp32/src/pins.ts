// ---------------------------------------------------------------------------
// @typecad/mcu-esp32 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal.
// Pin names use GPIO numbers matching the ESP32 datasheet.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---------------------------------------------------------------------------
// Output-capable GPIOs
// ---------------------------------------------------------------------------

// Boot strapping pins (unsafe — affect boot mode)
export const GPIO0  = new Pin(0);   // Boot: HIGH for normal boot. Touch1. ADC2_CH1.
export const GPIO2  = new Pin(2);   // Touch2. ADC2_CH2.
export const GPIO5  = new Pin(5);   // Boot: must be HIGH. VSPI CS0.
export const GPIO12 = new Pin(12);  // Boot: must be LOW (flash voltage). Touch5. HSPI MISO.
export const GPIO15 = new Pin(15);  // Boot: must be HIGH. Touch3. HSPI CS0.

// UART0 pins (unsafe — interferes with programming serial)
export const GPIO1  = new Pin(1);   // UART0 TX
export const GPIO3  = new Pin(3);   // UART0 RX

// General purpose GPIOs
export const GPIO4  = new Pin(4);   // Touch0. ADC2_CH0.
export const GPIO13 = new Pin(13);  // HSPI MOSI. Touch4. ADC2_CH4.
export const GPIO14 = new Pin(14);  // HSPI SCK. Touch6. ADC2_CH6.
export const GPIO16 = new Pin(16);  // UART2 RX
export const GPIO17 = new Pin(17);  // UART2 TX
export const GPIO18 = new Pin(18);  // VSPI SCK
export const GPIO19 = new Pin(19);  // VSPI MISO
export const GPIO21 = new Pin(21);  // I2C0 SDA
export const GPIO22 = new Pin(22);  // I2C0 SCL
export const GPIO23 = new Pin(23);  // VSPI MOSI

// DAC pins
export const GPIO25 = new Pin(25);  // DAC1. ADC2_CH8.
export const GPIO26 = new Pin(26);  // DAC2. ADC2_CH9.

// Touch + ADC pins
export const GPIO27 = new Pin(27);  // Touch7. ADC2_CH7.
export const GPIO32 = new Pin(32);  // Touch9. ADC1_CH4.
export const GPIO33 = new Pin(33);  // Touch8. ADC1_CH5.

// ---------------------------------------------------------------------------
// Input-only GPIOs — no output, no pull-up/pull-down
// ---------------------------------------------------------------------------

export const GPIO34 = new Pin(34);  // ADC1_CH6
export const GPIO35 = new Pin(35);  // ADC1_CH7
export const GPIO36 = new Pin(36);  // ADC1_CH0 (VP)
export const GPIO39 = new Pin(39);  // ADC1_CH3 (VN)

// ---------------------------------------------------------------------------
// Convenience aliases (Silicon-level defaults)
// ---------------------------------------------------------------------------

/** I2C data line (GPIO21). */
export const SDA = GPIO21;
/** I2C clock line (GPIO22). */
export const SCL = GPIO22;

/** SPI MOSI — VSPI (GPIO23). */
export const MOSI = GPIO23;
/** SPI MISO — VSPI (GPIO19). */
export const MISO = GPIO19;
/** SPI clock — VSPI (GPIO18). */
export const SCK = GPIO18;
/** SPI slave select — VSPI (GPIO5). */
export const SS = GPIO5;

/** UART0 transmit (GPIO1). */
export const TX = GPIO1;
/** UART0 receive (GPIO3). */
export const RX = GPIO3;

/** UART2 transmit (GPIO17). */
export const TX2 = GPIO17;
/** UART2 receive (GPIO16). */
export const RX2 = GPIO16;

/** DAC channel 1 (GPIO25). */
export const DAC1 = GPIO25;
/** DAC channel 2 (GPIO26). */
export const DAC2 = GPIO26;