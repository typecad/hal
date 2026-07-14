// ---------------------------------------------------------------------------
// ATmega328P chip descriptor (Arduino Uno / Nano)
//
// Pure data — literal extraction of the constants that were previously
// hardwired into registers.ts (PWM_MAP, INTERRUPT_MAP, pin ranges) and
// strategy.ts (F_CPU, UART baud, ADC reference). No behavior lives here.
//
// Pin mapping (ATmega328P, Arduino numbering):
//   Port D (PD0-PD7)  = Arduino D0-D7
//   Port B (PB0-PB5)  = Arduino D8-D13
//   Port C (PC0-PC5)  = Arduino A0-A5 (D14-D19)
// ---------------------------------------------------------------------------

import type { AVRChipDescriptor } from './types.js';

/**
 * Build a contiguous Arduino-pin-range block mapping to one AVR port.
 * Pins [start, start+count) map to bits 0..count-1 of the given registers.
 */
function portBlock(
  start: number,
  count: number,
  port: string,
  ddr: string,
  pinReg: string,
): Record<number, AVRChipDescriptor['pins'][number]> {
  const out: Record<number, AVRChipDescriptor['pins'][number]> = {};
  for (let i = 0; i < count; i++) {
    out[start + i] = { port, ddr, pinReg, bit: i };
  }
  return out;
}

export const ATMEGA328P: AVRChipDescriptor = {
  id: 'atmega328p',
  fcpu: 16_000_000,
  uart: {
    instance: 'USART0',
    defaultBaud: 9600,
  },
  adc: {
    // AVcc reference (REFS0 set, REFS1 clear).
    referenceBits: '(1 << REFS0)',
    // ADC prescaler 128 (ADC clock = F_CPU/128 = 125 kHz on a 16 MHz part).
    prescalerBits: '(1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0)',
    channelsByPin: { 14: 0, 15: 1, 16: 2, 17: 3, 18: 4, 19: 5 },
  },
  pins: {
    ...portBlock(0, 8, 'PORTD', 'DDRD', 'PIND'),   // D0-D7  -> Port D
    ...portBlock(8, 6, 'PORTB', 'DDRB', 'PINB'),    // D8-D13 -> Port B
    ...portBlock(14, 6, 'PORTC', 'DDRC', 'PINC'),   // D14-D19 (A0-A5) -> Port C
  },
  timers: {
    timer0: {
      id: 'timer0',
      // Phase-correct PWM, prescaler 64. Matches the previous hardcoded shim.
      initCode: 'TCCR0A |= (1 << WGM00); TCCR0B |= (1 << CS01) | (1 << CS00);',
    },
    timer1: {
      id: 'timer1',
      // 8-bit fast PWM via TIMER1A buffer, prescaler 8.
      initCode: 'TCCR1A |= (1 << WGM10); TCCR1B |= (1 << CS11);',
    },
    timer2: {
      id: 'timer2',
      // Phase-correct PWM, prescaler 256.
      initCode: 'TCCR2A |= (1 << WGM20); TCCR2B |= (1 << CS22);',
    },
  },
  pwmByPin: {
    5:  { timerId: 'timer0', ocr: 'OCR0B', tccr: 'TCCR0A', comBit: 'COM0B1' },
    6:  { timerId: 'timer0', ocr: 'OCR0A', tccr: 'TCCR0A', comBit: 'COM0A1' },
    9:  { timerId: 'timer1', ocr: 'OCR1A', tccr: 'TCCR1A', comBit: 'COM1A1' },
    10: { timerId: 'timer1', ocr: 'OCR1B', tccr: 'TCCR1A', comBit: 'COM1B1' },
    3:  { timerId: 'timer2', ocr: 'OCR2B', tccr: 'TCCR2A', comBit: 'COM2B1' },
    11: { timerId: 'timer2', ocr: 'OCR2A', tccr: 'TCCR2A', comBit: 'COM2A1' },
  },
  interruptsByPin: {
    2: { interrupt: 'INT0', handler: '_int0_handler', vector: 'INT0_vect' },
    3: { interrupt: 'INT1', handler: '_int1_handler', vector: 'INT1_vect' },
  },
};
