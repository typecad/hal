// ---------------------------------------------------------------------------
// @typehal/mcu-atmega328p — Arduino core pin mapping
//
// Maps MCU port names to Arduino framework pin numbers.
// Source: Arduino AVR core, variants/standard/pins_arduino.h
//
// This mapping is per-chip — an ATtiny85 has A2=PB4 while ATmega328P has
// A2=PC2. It lives in the MCU package, NOT in the framework package.
// ---------------------------------------------------------------------------

/**
 * Arduino pin number for each MCU port name.
 * Port name → Arduino digital/analog pin number.
 */
export const ARDUINO_PIN_MAP: Readonly<Record<string, number>> = {
  // Port D — Arduino digital pins 0–7
  PD0: 0,  PD1: 1,  PD2: 2,  PD3: 3,
  PD4: 4,  PD5: 5,  PD6: 6,  PD7: 7,

  // Port B — Arduino digital pins 8–13
  PB0: 8,  PB1: 9,  PB2: 10, PB3: 11,
  PB4: 12, PB5: 13,

  // Port C — Arduino analog pins A0–A5 (pin numbers 14–19)
  PC0: 14, PC1: 15, PC2: 16, PC3: 17,
  PC4: 18, PC5: 19,
};

/**
 * The offset where analog pin numbering starts.
 * Arduino analogRead(A0) maps to pin 14 on ATmega328P.
 */
export const ARDUINO_ANALOG_OFFSET = 14;

/**
 * Reverse map: Arduino pin number → MCU port name.
 * Used by the transpiler to resolve bare names like D13 → PB5.
 */
export const ARDUINO_PIN_REVERSE: Readonly<Record<number, string>> = {};
for (const [port, num] of Object.entries(ARDUINO_PIN_MAP)) {
  (ARDUINO_PIN_REVERSE as Record<number, string>)[num] = port;
}
