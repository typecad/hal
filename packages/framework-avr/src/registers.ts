// ---------------------------------------------------------------------------
// @typehal/arch-avr-native — AVR register definitions and helpers
//
// Provides register-level mappings for ATmega328P and similar AVR chips.
// This module is architecture-specific but board-agnostic.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pin register information
// ---------------------------------------------------------------------------

/**
 * Information about a pin's register mappings.
 */
export interface PinRegisterInfo {
  /** Port output register (e.g., PORTB, PORTC, PORTD) */
  port: string;
  /** Data direction register (e.g., DDRB, DDRC, DDRD) */
  ddr: string;
  /** Pin input register (e.g., PINB, PINC, PIND) */
  pinReg: string;
  /** Bit position within the register (0-7) */
  bit: number;
}

/**
 * Map Arduino pin number to AVR port register info.
 * Returns { port, ddr, pinReg, bit } for the given pin.
 * 
 * Pin mapping for ATmega328P:
 * - Port D (PD0-PD7) = Arduino D0-D7
 * - Port B (PB0-PB5) = Arduino D8-D13
 * - Port C (PC0-PC5) = Arduino A0-A5 (D14-D19)
 */
export function getPinInfo(pin: number): PinRegisterInfo | null {
  // Port D (PD0-PD7) = Arduino D0-D7
  if (pin >= 0 && pin <= 7) {
    return { port: 'PORTD', ddr: 'DDRD', pinReg: 'PIND', bit: pin };
  }
  // Port B (PB0-PB5) = Arduino D8-D13
  if (pin >= 8 && pin <= 13) {
    return { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: pin - 8 };
  }
  // Port C (PC0-PC5) = Arduino A0-A5 (D14-D19)
  if (pin >= 14 && pin <= 19) {
    return { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: pin - 14 };
  }
  return null;
}

/**
 * Extract pin number from receiver name (e.g., "D13" -> 13, "A0" -> 14).
 */
export function parsePinFromReceiver(receiver: string): number | null {
  if (receiver === 'LED') return 13;
  if (receiver.startsWith('D')) {
    const num = parseInt(receiver.slice(1), 10);
    return isNaN(num) ? null : num;
  }
  if (receiver.startsWith('A')) {
    const num = parseInt(receiver.slice(1), 10);
    return isNaN(num) ? null : 14 + num;
  }
  return null;
}

/**
 * Get pre-computed bit mask for a pin (avoids runtime shift).
 */
export function getPinBitMask(pin: number): string {
  const info = getPinInfo(pin);
  if (!info) return '0';
  return `0x${(1 << info.bit).toString(16).toUpperCase()}`;
}

/**
 * Get port register name for a pin.
 */
export function getPortReg(pin: number): string | null {
  const info = getPinInfo(pin);
  return info?.port ?? null;
}

/**
 * Get DDR register name for a pin.
 */
export function getDDRReg(pin: number): string | null {
  const info = getPinInfo(pin);
  return info?.ddr ?? null;
}

// ---------------------------------------------------------------------------
// ADC definitions
// ---------------------------------------------------------------------------

/**
 * Get ADC channel for analog pin.
 * A0-A5 map to ADC channels 0-5.
 */
export function getADCChannel(pin: number): number | null {
  if (pin >= 14 && pin <= 19) {
    return pin - 14;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PWM definitions
// ---------------------------------------------------------------------------

/**
 * PWM timer information for a pin.
 */
export interface PWMInfo {
  /** Output compare register (e.g., OCR0A, OCR1B) */
  ocr: string;
  /** Timer control register (e.g., TCCR0A, TCCR1A) */
  tccr: string;
  /** Compare output mode bit (e.g., COM0A1, COM1B1) */
  comBit: string;
  /** Prescaler configuration code */
  prescaler: string;
  /** Timer identifier for grouping */
  timerId: string;
  /** Waveform generation mode bits */
  wgmBits: string;
}

/**
 * PWM pin mapping for ATmega328P.
 * 
 * Timer0 (8-bit): D5 (OC0B), D6 (OC0A)
 * Timer1 (16-bit): D9 (OC1A), D10 (OC1B)
 * Timer2 (8-bit): D3 (OC2B), D11 (OC2A)
 */
const PWM_MAP: Record<number, PWMInfo> = {
  // Timer0 (8-bit) - pins 5 and 6
  5:  { ocr: 'OCR0B', tccr: 'TCCR0A', comBit: 'COM0B1', prescaler: 'TCCR0B |= (1 << CS01) | (1 << CS00)', timerId: 'timer0', wgmBits: '(1 << WGM00)' },
  6:  { ocr: 'OCR0A', tccr: 'TCCR0A', comBit: 'COM0A1', prescaler: 'TCCR0B |= (1 << CS01) | (1 << CS00)', timerId: 'timer0', wgmBits: '(1 << WGM00)' },
  // Timer1 (16-bit) - pins 9 and 10
  9:  { ocr: 'OCR1A', tccr: 'TCCR1A', comBit: 'COM1A1', prescaler: 'TCCR1B |= (1 << CS11)', timerId: 'timer1', wgmBits: '(1 << WGM10)' },
  10: { ocr: 'OCR1B', tccr: 'TCCR1A', comBit: 'COM1B1', prescaler: 'TCCR1B |= (1 << CS11)', timerId: 'timer1', wgmBits: '(1 << WGM10)' },
  // Timer2 (8-bit) - pins 3 and 11
  3:  { ocr: 'OCR2B', tccr: 'TCCR2A', comBit: 'COM2B1', prescaler: 'TCCR2B |= (1 << CS22)', timerId: 'timer2', wgmBits: '(1 << WGM20)' },
  11: { ocr: 'OCR2A', tccr: 'TCCR2A', comBit: 'COM2A1', prescaler: 'TCCR2B |= (1 << CS22)', timerId: 'timer2', wgmBits: '(1 << WGM20)' },
};

/**
 * Get PWM timer info for PWM-capable pins.
 * Returns null if the pin doesn't support PWM.
 */
export function getPWMInfo(pin: number): PWMInfo | null {
  return PWM_MAP[pin] ?? null;
}

/**
 * Check if a pin is PWM-capable.
 */
export function isPWMPin(pin: number): boolean {
  return pin in PWM_MAP;
}

/**
 * Get all PWM-capable pins.
 */
export function getPWMPins(): number[] {
  return Object.keys(PWM_MAP).map(Number);
}

// ---------------------------------------------------------------------------
// Pin kind inference
// ---------------------------------------------------------------------------

/**
 * Infer receiver kind from pin number.
 * Returns 'analog-input' for A0-A5, 'pwm' for PWM-capable pins, 'digital' otherwise.
 */
export function inferReceiverKind(pin: number): 'analog-input' | 'digital' | 'pwm' {
  // A0-A5 are analog inputs (pins 14-19 in Arduino numbering)
  if (pin >= 14 && pin <= 19) return 'analog-input';
  // PWM-capable pins: 3, 5, 6, 9, 10, 11
  if (isPWMPin(pin)) return 'pwm';
  // All other pins are digital
  return 'digital';
}

// ---------------------------------------------------------------------------
// External interrupts
// ---------------------------------------------------------------------------

/**
 * Interrupt pin mapping for ATmega328P.
 * D2 = INT0, D3 = INT1
 */
const INTERRUPT_MAP: Record<number, { interrupt: string; handler: string; vector: string }> = {
  2: { interrupt: 'INT0', handler: '_int0_handler', vector: 'INT0_vect' },
  3: { interrupt: 'INT1', handler: '_int1_handler', vector: 'INT1_vect' },
};

/**
 * Get interrupt info for a pin.
 * Returns null if the pin doesn't support external interrupts.
 */
export function getInterruptInfo(pin: number): { interrupt: string; handler: string; vector: string } | null {
  return INTERRUPT_MAP[pin] ?? null;
}

/**
 * Check if a pin supports external interrupts.
 */
export function isInterruptPin(pin: number): boolean {
  return pin in INTERRUPT_MAP;
}