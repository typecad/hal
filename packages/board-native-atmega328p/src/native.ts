// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Native AVR register mappings
//
// This module provides compile-time constants that map Arduino pin numbers
// to AVR port registers. The transpiler uses these to generate efficient
// C++ code with direct register access instead of Arduino framework calls.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Port register mappings for each Arduino pin (0-19)
// ---------------------------------------------------------------------------

/**
 * Output port register for each pin.
 * Used by digitalWrite() to set pin state.
 */
export const PIN_PORT: Record<number, string> = {
  // Port D (PD0-PD7) = Arduino D0-D7
  0: 'PORTD', 1: 'PORTD', 2: 'PORTD', 3: 'PORTD', 4: 'PORTD',
  5: 'PORTD', 6: 'PORTD', 7: 'PORTD',
  // Port B (PB0-PB5) = Arduino D8-D13
  8: 'PORTB', 9: 'PORTB', 10: 'PORTB', 11: 'PORTB', 12: 'PORTB', 13: 'PORTB',
  // Port C (PC0-PC5) = Arduino A0-A5 (D14-D19)
  14: 'PORTC', 15: 'PORTC', 16: 'PORTC', 17: 'PORTC', 18: 'PORTC', 19: 'PORTC',
};

/**
 * Data direction register for each pin.
 * Used by pinMode() to set input/output direction.
 */
export const PIN_DDR: Record<number, string> = {
  // Port D (PD0-PD7) = Arduino D0-D7
  0: 'DDRD', 1: 'DDRD', 2: 'DDRD', 3: 'DDRD', 4: 'DDRD',
  5: 'DDRD', 6: 'DDRD', 7: 'DDRD',
  // Port B (PB0-PB5) = Arduino D8-D13
  8: 'DDRB', 9: 'DDRB', 10: 'DDRB', 11: 'DDRB', 12: 'DDRB', 13: 'DDRB',
  // Port C (PC0-PC5) = Arduino A0-A5 (D14-D19)
  14: 'DDRC', 15: 'DDRC', 16: 'DDRC', 17: 'DDRC', 18: 'DDRC', 19: 'DDRC',
};

/**
 * Input port register for each pin.
 * Used by digitalRead() to read pin state.
 */
export const PIN_IN: Record<number, string> = {
  // Port D (PD0-PD7) = Arduino D0-D7
  0: 'PIND', 1: 'PIND', 2: 'PIND', 3: 'PIND', 4: 'PIND',
  5: 'PIND', 6: 'PIND', 7: 'PIND',
  // Port B (PB0-PB5) = Arduino D8-D13
  8: 'PINB', 9: 'PINB', 10: 'PINB', 11: 'PINB', 12: 'PINB', 13: 'PINB',
  // Port C (PC0-PC5) = Arduino A0-A5 (D14-D19)
  14: 'PINC', 15: 'PINC', 16: 'PINC', 17: 'PINC', 18: 'PINC', 19: 'PINC',
};

/**
 * Bit position within the port register for each pin.
 */
export const PIN_BIT: Record<number, number> = {
  // Port D (PD0-PD7)
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
  // Port B (PB0-PB5)
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5,
  // Port C (PC0-PC5)
  14: 0, 15: 1, 16: 2, 17: 3, 18: 4, 19: 5,
};

// ---------------------------------------------------------------------------
// PWM timer output compare registers
// ---------------------------------------------------------------------------

/**
 * PWM-capable pins and their corresponding output compare registers.
 * Only these pins support analogWrite():
 * - D3  (PD3) - OC2B (Timer2)
 * - D5  (PD5) - OC0B (Timer0)
 * - D6  (PD6) - OC0A (Timer0)
 * - D9  (PB1) - OC1A (Timer1)
 * - D10 (PB2) - OC1B (Timer1)
 * - D11 (PB3) - OC2A (Timer2)
 */
export const PWM_OCR: Record<number, string> = {
  3: 'OCR2B',   // Timer2 Compare B
  5: 'OCR0B',   // Timer0 Compare B
  6: 'OCR0A',   // Timer0 Compare A
  9: 'OCR1A',   // Timer1 Compare A
  10: 'OCR1B',  // Timer1 Compare B
  11: 'OCR2A',  // Timer2 Compare A
};

/**
 * Timer configuration registers for PWM pins.
 * Used to set up PWM mode and prescaler.
 */
export const PWM_TCCR: Record<number, { tccr: string; comBit: string; wgmBits: string[] }> = {
  3:  { tccr: 'TCCR2A', comBit: 'COM2B1', wgmBits: ['WGM20'] },  // Timer2, Phase Correct PWM
  5:  { tccr: 'TCCR0A', comBit: 'COM0B1', wgmBits: ['WGM00'] },  // Timer0, Phase Correct PWM
  6:  { tccr: 'TCCR0A', comBit: 'COM0A1', wgmBits: ['WGM00'] },  // Timer0, Phase Correct PWM
  9:  { tccr: 'TCCR1A', comBit: 'COM1A1', wgmBits: ['WGM10'] },  // Timer1, 8-bit Phase Correct PWM
  10: { tccr: 'TCCR1A', comBit: 'COM1B1', wgmBits: ['WGM10'] },  // Timer1, 8-bit Phase Correct PWM
  11: { tccr: 'TCCR2A', comBit: 'COM2A1', wgmBits: ['WGM20'] },  // Timer2, Phase Correct PWM
};

// ---------------------------------------------------------------------------
// ADC channel mappings
// ---------------------------------------------------------------------------

/**
 * ADC channel number for each analog pin.
 * A0-A5 map to ADC channels 0-5.
 */
export const ADC_CHANNEL: Record<number, number> = {
  14: 0,   // A0 = ADC0
  15: 1,   // A1 = ADC1
  16: 2,   // A2 = ADC2
  17: 3,   // A3 = ADC3
  18: 4,   // A4 = ADC4
  19: 5,   // A5 = ADC5
};

/**
 * Check if a pin is PWM-capable.
 */
export function isPWMPin(pin: number): boolean {
  return pin in PWM_OCR;
}

/**
 * Check if a pin is an analog input pin.
 */
export function isAnalogPin(pin: number): boolean {
  return pin >= 14 && pin <= 19;
}

/**
 * Check if a pin is a valid digital pin.
 */
export function isValidDigitalPin(pin: number): boolean {
  return pin >= 0 && pin <= 19;
}
