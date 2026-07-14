// ---------------------------------------------------------------------------
// ATmega2560 chip descriptor (Arduino Mega 2560)
//
// Pure data — the proof-of-portability for the chip-descriptor layer. This
// file was authored without touching strategy.ts or registers.ts; if either
// had needed a chip-specific branch, the abstraction would be wrong.
//
// Pin mapping (ATmega2560, Arduino Mega 2560 numbering) per the official
// Arduino pin map (https://www.arduino.cc/en/Hacking/PinMapping2560):
//
//   D0-D1    Port E  (PE0, PE1 — UART0)
//   D2-D3    Port E  (PE4, PE5 — also INT4/INT5)
//   D4       Port G  (PG5 — OC0B PWM)
//   D5       Port E  (PE3 — OC3A PWM)
//   D6-D9    Port H  (PH3-PH6 — OC4A/B/C, OC2B PWM)
//   D10      Port B  (PB4 — OC2A PWM)
//   D11-D13  Port B  (PB5-PB7 — OC1A/B, OC0A PWM)
//   D14-D15  Port J  (PJ0-PJ1 — UART3)
//   D16-D17  Port H  (PH0-PH1 — UART2)
//   D18-D21  Port D  (PD3-PD0 — UART1; D20/D21 also INT1/INT0, D18/D19 INT3/INT2)
//   D22-D29  Port A  (PA0-PA7)
//   D30-D37  Port C  (PC7-PC0)
//   D38      Port D  (PD7)
//   D39      Port G  (PG2)
//   D40-D41  Port G  (PG0-PG1)
//   D42-D49  Port L  (PL7-PL0; D44-D46 are OC5C/B/A PWM)
//   D50-D53  Port B  (PB3-PB0 — SPI)
//   A0-A7    Port F  (PF0-PF7 — ADC0-7)
//   A8-A15   Port K  (PK0-PK7 — ADC8-15)
// ---------------------------------------------------------------------------

import type { AVRChipDescriptor } from './types.js';

export const ATMEGA2560: AVRChipDescriptor = {
  id: 'atmega2560',
  fcpu: 16_000_000,
  uart: {
    instance: 'USART0',
    defaultBaud: 9600,
  },
  adc: {
    // AVcc reference (REFS0 set, REFS1 clear) — same as 328P.
    referenceBits: '(1 << REFS0)',
    // ADC prescaler 128 (ADC clock = 125 kHz on a 16 MHz part).
    prescalerBits: '(1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0)',
    // Arduino A0-A15 map to ADC channels 0-15 (Port F = ADC0-7, Port K = ADC8-15).
    // Framework pin numbers: A0-A7 are D54-D61, A8-A15 are D62-D69.
    channelsByPin: {
      54: 0, 55: 1, 56: 2, 57: 3, 58: 4, 59: 5, 60: 6, 61: 7,
      62: 8, 63: 9, 64: 10, 65: 11, 66: 12, 67: 13, 68: 14, 69: 15,
    },
  },
  pins: {
    // Port E — D0, D1, D2, D3, D5 (PE0, PE1, PE4, PE5, PE3 — non-contiguous bits)
    0:  { port: 'PORTE', ddr: 'DDRE', pinReg: 'PINE', bit: 0 },
    1:  { port: 'PORTE', ddr: 'DDRE', pinReg: 'PINE', bit: 1 },
    2:  { port: 'PORTE', ddr: 'DDRE', pinReg: 'PINE', bit: 4 },
    3:  { port: 'PORTE', ddr: 'DDRE', pinReg: 'PINE', bit: 5 },
    5:  { port: 'PORTE', ddr: 'DDRE', pinReg: 'PINE', bit: 3 },
    // Port G — D4 (PG5)
    4:  { port: 'PORTG', ddr: 'DDRG', pinReg: 'PING', bit: 5 },
    // Port H — D6, D7, D8, D9 (PH3-PH6)
    6:  { port: 'PORTH', ddr: 'DDRH', pinReg: 'PINH', bit: 3 },
    7:  { port: 'PORTH', ddr: 'DDRH', pinReg: 'PINH', bit: 4 },
    8:  { port: 'PORTH', ddr: 'DDRH', pinReg: 'PINH', bit: 5 },
    9:  { port: 'PORTH', ddr: 'DDRH', pinReg: 'PINH', bit: 6 },
    // Port B — D10, D11, D12, D13 (PB4-PB7)
    10: { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: 4 },
    11: { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: 5 },
    12: { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: 6 },
    13: { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: 7 },
    // Port J — D14, D15 (PJ0, PJ1)
    14: { port: 'PORTJ', ddr: 'DDRJ', pinReg: 'PINJ', bit: 1 },
    15: { port: 'PORTJ', ddr: 'DDRJ', pinReg: 'PINJ', bit: 0 },
    // Port H — D16, D17 (PH1, PH0)
    16: { port: 'PORTH', ddr: 'DDRH', pinReg: 'PINH', bit: 1 },
    17: { port: 'PORTH', ddr: 'DDRH', pinReg: 'PINH', bit: 0 },
    // Port D — D18, D19, D20, D21 (PD3, PD2, PD1, PD0)
    18: { port: 'PORTD', ddr: 'DDRD', pinReg: 'PIND', bit: 3 },
    19: { port: 'PORTD', ddr: 'DDRD', pinReg: 'PIND', bit: 2 },
    20: { port: 'PORTD', ddr: 'DDRD', pinReg: 'PIND', bit: 1 },
    21: { port: 'PORTD', ddr: 'DDRD', pinReg: 'PIND', bit: 0 },
    // Port A — D22-D29 (PA0-PA7)
    22: { port: 'PORTA', ddr: 'DDRA', pinReg: 'PINA', bit: 0 },
    23: { port: 'PORTA', ddr: 'DDRA', pinReg: 'PINA', bit: 1 },
    24: { port: 'PORTA', ddr: 'DDRA', pinReg: 'PINA', bit: 2 },
    25: { port: 'PORTA', ddr: 'DDRA', pinReg: 'PINA', bit: 3 },
    26: { port: 'PORTA', ddr: 'DDRA', pinReg: 'PINA', bit: 4 },
    27: { port: 'PORTA', ddr: 'DDRA', pinReg: 'PINA', bit: 5 },
    28: { port: 'PORTA', ddr: 'DDRA', pinReg: 'PINA', bit: 6 },
    29: { port: 'PORTA', ddr: 'DDRA', pinReg: 'PINA', bit: 7 },
    // Port C — D30-D37 (PC7-PC0, reverse bit order)
    30: { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: 7 },
    31: { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: 6 },
    32: { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: 5 },
    33: { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: 4 },
    34: { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: 3 },
    35: { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: 2 },
    36: { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: 1 },
    37: { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: 0 },
    // D38 — Port D PD7
    38: { port: 'PORTD', ddr: 'DDRD', pinReg: 'PIND', bit: 7 },
    // D39 — Port G PG2
    39: { port: 'PORTG', ddr: 'DDRG', pinReg: 'PING', bit: 2 },
    // Port G — D40, D41 (PG0, PG1)
    40: { port: 'PORTG', ddr: 'DDRG', pinReg: 'PING', bit: 0 },
    41: { port: 'PORTG', ddr: 'DDRG', pinReg: 'PING', bit: 1 },
    // Port L — D42-D49 (PL7-PL0, reverse bit order)
    42: { port: 'PORTL', ddr: 'DDRL', pinReg: 'PINL', bit: 7 },
    43: { port: 'PORTL', ddr: 'DDRL', pinReg: 'PINL', bit: 6 },
    44: { port: 'PORTL', ddr: 'DDRL', pinReg: 'PINL', bit: 5 },
    45: { port: 'PORTL', ddr: 'DDRL', pinReg: 'PINL', bit: 4 },
    46: { port: 'PORTL', ddr: 'DDRL', pinReg: 'PINL', bit: 3 },
    47: { port: 'PORTL', ddr: 'DDRL', pinReg: 'PINL', bit: 2 },
    48: { port: 'PORTL', ddr: 'DDRL', pinReg: 'PINL', bit: 1 },
    49: { port: 'PORTL', ddr: 'DDRL', pinReg: 'PINL', bit: 0 },
    // Port B — D50-D53 (PB3-PB0, SPI, reverse bit order)
    50: { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: 3 },
    51: { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: 2 },
    52: { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: 1 },
    53: { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: 0 },
    // Port F — A0-A7 = D54-D61 (PF0-PF7)
    54: { port: 'PORTF', ddr: 'DDRF', pinReg: 'PINF', bit: 0 },
    55: { port: 'PORTF', ddr: 'DDRF', pinReg: 'PINF', bit: 1 },
    56: { port: 'PORTF', ddr: 'DDRF', pinReg: 'PINF', bit: 2 },
    57: { port: 'PORTF', ddr: 'DDRF', pinReg: 'PINF', bit: 3 },
    58: { port: 'PORTF', ddr: 'DDRF', pinReg: 'PINF', bit: 4 },
    59: { port: 'PORTF', ddr: 'DDRF', pinReg: 'PINF', bit: 5 },
    60: { port: 'PORTF', ddr: 'DDRF', pinReg: 'PINF', bit: 6 },
    61: { port: 'PORTF', ddr: 'DDRF', pinReg: 'PINF', bit: 7 },
    // Port K — A8-A15 = D62-D69 (PK0-PK7)
    62: { port: 'PORTK', ddr: 'DDRK', pinReg: 'PINK', bit: 0 },
    63: { port: 'PORTK', ddr: 'DDRK', pinReg: 'PINK', bit: 1 },
    64: { port: 'PORTK', ddr: 'DDRK', pinReg: 'PINK', bit: 2 },
    65: { port: 'PORTK', ddr: 'DDRK', pinReg: 'PINK', bit: 3 },
    66: { port: 'PORTK', ddr: 'DDRK', pinReg: 'PINK', bit: 4 },
    67: { port: 'PORTK', ddr: 'DDRK', pinReg: 'PINK', bit: 5 },
    68: { port: 'PORTK', ddr: 'DDRK', pinReg: 'PINK', bit: 6 },
    69: { port: 'PORTK', ddr: 'DDRK', pinReg: 'PINK', bit: 7 },
  },
  timers: {
    timer0: {
      id: 'timer0',
      // 8-bit fast PWM, prescaler 64.
      initCode: 'TCCR0A |= (1 << WGM00); TCCR0B |= (1 << CS01) | (1 << CS00);',
    },
    timer1: {
      id: 'timer1',
      // 8-bit fast PWM via WGM10, prescaler 8.
      initCode: 'TCCR1A |= (1 << WGM10); TCCR1B |= (1 << CS11);',
    },
    timer2: {
      id: 'timer2',
      // Phase-correct PWM, prescaler 256.
      initCode: 'TCCR2A |= (1 << WGM20); TCCR2B |= (1 << CS22);',
    },
    timer3: {
      id: 'timer3',
      // 16-bit timer, 8-bit fast PWM via WGM10, prescaler 8.
      initCode: 'TCCR3A |= (1 << WGM30); TCCR3B |= (1 << CS31);',
    },
    timer4: {
      id: 'timer4',
      // 16-bit timer, 8-bit fast PWM via WGM40, prescaler 8.
      initCode: 'TCCR4A |= (1 << WGM40); TCCR4B |= (1 << CS41);',
    },
    timer5: {
      id: 'timer5',
      // 16-bit timer, 8-bit fast PWM via WGM50, prescaler 8.
      initCode: 'TCCR5A |= (1 << WGM50); TCCR5B |= (1 << CS51);',
    },
  },
  // 15 PWM-capable pins across timers 0-5.
  pwmByPin: {
    4:  { timerId: 'timer0', ocr: 'OCR0B', tccr: 'TCCR0A', comBit: 'COM0B1' },
    13: { timerId: 'timer0', ocr: 'OCR0A', tccr: 'TCCR0A', comBit: 'COM0A1' },
    11: { timerId: 'timer1', ocr: 'OCR1A', tccr: 'TCCR1A', comBit: 'COM1A1' },
    12: { timerId: 'timer1', ocr: 'OCR1B', tccr: 'TCCR1A', comBit: 'COM1B1' },
    10: { timerId: 'timer2', ocr: 'OCR2A', tccr: 'TCCR2A', comBit: 'COM2A1' },
    9:  { timerId: 'timer2', ocr: 'OCR2B', tccr: 'TCCR2A', comBit: 'COM2B1' },
    5:  { timerId: 'timer3', ocr: 'OCR3A', tccr: 'TCCR3A', comBit: 'COM3A1' },
    2:  { timerId: 'timer3', ocr: 'OCR3B', tccr: 'TCCR3A', comBit: 'COM3B1' },
    3:  { timerId: 'timer3', ocr: 'OCR3C', tccr: 'TCCR3A', comBit: 'COM3C1' },
    6:  { timerId: 'timer4', ocr: 'OCR4A', tccr: 'TCCR4A', comBit: 'COM4A1' },
    7:  { timerId: 'timer4', ocr: 'OCR4B', tccr: 'TCCR4A', comBit: 'COM4B1' },
    8:  { timerId: 'timer4', ocr: 'OCR4C', tccr: 'TCCR4A', comBit: 'COM4C1' },
    46: { timerId: 'timer5', ocr: 'OCR5A', tccr: 'TCCR5A', comBit: 'COM5A1' },
    45: { timerId: 'timer5', ocr: 'OCR5B', tccr: 'TCCR5A', comBit: 'COM5B1' },
    44: { timerId: 'timer5', ocr: 'OCR5C', tccr: 'TCCR5A', comBit: 'COM5C1' },
  },
  // External interrupts: ATmega2560 has INT0-INT7 (8 interrupts vs the 328P's 2).
  // PD0=INT0 (D21), PD1=INT1 (D20), PD2=INT2 (D19), PD3=INT3 (D18),
  // PE4=INT4 (D2), PE5=INT5 (D3), PE6=INT6 (not broken out), PE7=INT7 (not broken out).
  interruptsByPin: {
    21: { interrupt: 'INT0', handler: '_int0_handler', vector: 'INT0_vect' },
    20: { interrupt: 'INT1', handler: '_int1_handler', vector: 'INT1_vect' },
    19: { interrupt: 'INT2', handler: '_int2_handler', vector: 'INT2_vect' },
    18: { interrupt: 'INT3', handler: '_int3_handler', vector: 'INT3_vect' },
    2:  { interrupt: 'INT4', handler: '_int4_handler', vector: 'INT4_vect' },
    3:  { interrupt: 'INT5', handler: '_int5_handler', vector: 'INT5_vect' },
  },
};
