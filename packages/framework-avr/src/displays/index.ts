// Barrel for AVR native display adapters.
//
// AVR's 2KB RAM (ATmega328P) constrains support to page-buffered displays.
// Only SSD1309 (1KB page buffer) is supported. ILI9341/ST7796S/SSD1680 need
// framebuffers that exceed AVR's RAM; the strategy's resolveDisplayAdapter
// throws a clear error for those drivers instead of routing here.

export { avrSsd1309Adapter } from "./ssd1309-avr.js";
