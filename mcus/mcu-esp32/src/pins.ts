// ---------------------------------------------------------------------------
// @typecad/mcu-esp32 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use GPIO numbers
// matching the ESP32 datasheet and the silkscreen. The preferred way to refer
// to a pin is its GPIO number form (GPIO0, GPIO2, …) because that is the
// notation printed in the datasheet and on a schematic — see "Pin Naming
// Conventions" in the root AGENTS.md. Each pin is constructed via
// Pin.fromPort("GPION") so the port string is the pin's canonical identity;
// the transpiler resolves it to the framework pin number via the MCU manifest.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---------------------------------------------------------------------------
// Output-capable GPIOs
// ---------------------------------------------------------------------------

// Boot strapping pins (unsafe — affect boot mode)
export const GPIO0  = Pin.fromPort('GPIO0');   // Boot: HIGH for normal boot. Touch1. ADC2_CH1.
export const GPIO2  = Pin.fromPort('GPIO2');   // Touch2. ADC2_CH2.
export const GPIO5  = Pin.fromPort('GPIO5');   // Boot: must be HIGH. VSPI CS0.
export const GPIO12 = Pin.fromPort('GPIO12');  // Boot: must be LOW (flash voltage). Touch5. HSPI MISO.
export const GPIO15 = Pin.fromPort('GPIO15');  // Boot: must be HIGH. Touch3. HSPI CS0.

// UART0 pins (unsafe — interferes with programming serial)
export const GPIO1  = Pin.fromPort('GPIO1');   // UART0 TX
export const GPIO3  = Pin.fromPort('GPIO3');   // UART0 RX

// General purpose GPIOs
export const GPIO4  = Pin.fromPort('GPIO4');   // Touch0. ADC2_CH0.
export const GPIO13 = Pin.fromPort('GPIO13');  // HSPI MOSI. Touch4. ADC2_CH4.
export const GPIO14 = Pin.fromPort('GPIO14');  // HSPI SCK. Touch6. ADC2_CH6.
export const GPIO16 = Pin.fromPort('GPIO16');  // UART2 RX
export const GPIO17 = Pin.fromPort('GPIO17');  // UART2 TX
export const GPIO18 = Pin.fromPort('GPIO18');  // VSPI SCK
export const GPIO19 = Pin.fromPort('GPIO19');  // VSPI MISO
export const GPIO21 = Pin.fromPort('GPIO21');  // I2C0 SDA
export const GPIO22 = Pin.fromPort('GPIO22');  // I2C0 SCL
export const GPIO23 = Pin.fromPort('GPIO23');  // VSPI MOSI

// DAC pins
export const GPIO25 = Pin.fromPort('GPIO25');  // DAC1. ADC2_CH8.
export const GPIO26 = Pin.fromPort('GPIO26');  // DAC2. ADC2_CH9.

// Touch + ADC pins
export const GPIO27 = Pin.fromPort('GPIO27');  // Touch7. ADC2_CH7.
export const GPIO32 = Pin.fromPort('GPIO32');  // Touch9. ADC1_CH4.
export const GPIO33 = Pin.fromPort('GPIO33');  // Touch8. ADC1_CH5.

// ---------------------------------------------------------------------------
// Input-only GPIOs — no output, no pull-up/pull-down
// ---------------------------------------------------------------------------

export const GPIO34 = Pin.fromPort('GPIO34');  // ADC1_CH6
export const GPIO35 = Pin.fromPort('GPIO35');  // ADC1_CH7
export const GPIO36 = Pin.fromPort('GPIO36');  // ADC1_CH0 (VP)
export const GPIO39 = Pin.fromPort('GPIO39');  // ADC1_CH3 (VN)

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