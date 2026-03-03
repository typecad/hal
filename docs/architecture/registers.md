# CPU Register Definitions

This document describes the register definition patterns used in architecture packages.

## ATmega328P Registers

### Port Registers (GPIO)

| Register | Address | Description |
|----------|---------|-------------|
| `PORTB` | `0x25` | Port B Data Register |
| `DDRB` | `0x24` | Port B Data Direction Register |
| `PINB` | `0x23` | Port B Input Pins |
| `PORTC` | `0x28` | Port C Data Register |
| `DDRC` | `0x27` | Port C Data Direction Register |
| `PINC` | `0x26` | Port C Input Pins |
| `PORTD` | `0x2B` | Port D Data Register |
| `DDRD` | `0x2A` | Port D Data Direction Register |
| `PIND` | `0x29` | Port D Input Pins |

### ADC Registers

| Register | Address | Description |
|----------|---------|-------------|
| `ADMUX` | `0x7C` | ADC Multiplexer Selection |
| `ADCSRA` | `0x7A` | ADC Control and Status Register A |
| `ADCSRB` | `0x7B` | ADC Control and Status Register B |
| `ADCH` | `0x79` | ADC Data Register High |
| `ADCL` | `0x78` | ADC Data Register Low |

### UART Registers

| Register | Address | Description |
|----------|---------|-------------|
| `UDR0` | `0xC6` | UART Data Register |
| `UCSR0A` | `0xC0` | UART Control and Status Register A |
| `UCSR0B` | `0xC1` | UART Control and Status Register B |
| `UCSR0C` | `0xC2` | UART Control and Status Register C |
| `UBRR0H` | `0xC5` | UART Baud Rate Register High |
| `UBRR0L` | `0xC4` | UART Baud Rate Register Low |

### Timer Registers

| Register | Address | Description |
|----------|---------|-------------|
| `TCCR0A` | `0x44` | Timer/Counter Control Register A (Timer 0) |
| `TCCR0B` | `0x45` | Timer/Counter Control Register B (Timer 0) |
| `TCNT0` | `0x46` | Timer/Counter Register (Timer 0) |
| `OCR0A` | `0x47` | Output Compare Register A (Timer 0) |
| `OCR0B` | `0x48` | Output Compare Register B (Timer 0) |

### I2C (TWI) Registers

| Register | Address | Description |
|----------|---------|-------------|
| `TWBR` | `0xB8` | TWI Bit Rate Register |
| `TWSR` | `0xB9` | TWI Status Register |
| `TWAR` | `0xBA` | TWI Address Register |
| `TWDR` | `0xBB` | TWI Data Register |
| `TWCR` | `0xBC` | TWI Control Register |

## Pin Mapping

### Arduino Uno Pin → AVR Register

| Arduino Pin | Port | Bit | Register Mapping |
|-------------|------|-----|------------------|
| D0 | PORTD | 0 | `PORTD`, `DDRD`, `PIND` bit 0 |
| D1 | PORTD | 1 | `PORTD`, `DDRD`, `PIND` bit 1 |
| D2 | PORTD | 2 | `PORTD`, `DDRD`, `PIND` bit 2 |
| D3 | PORTD | 3 | `PORTD`, `DDRD`, `PIND` bit 3 (PWM: Timer2B) |
| D4 | PORTD | 4 | `PORTD`, `DDRD`, `PIND` bit 4 |
| D5 | PORTD | 5 | `PORTD`, `DDRD`, `PIND` bit 5 (PWM: Timer0B) |
| D6 | PORTD | 6 | `PORTD`, `DDRD`, `PIND` bit 6 (PWM: Timer0A) |
| D7 | PORTD | 7 | `PORTD`, `DDRD`, `PIND` bit 7 |
| D8 | PORTB | 0 | `PORTB`, `DDRB`, `PINB` bit 0 |
| D9 | PORTB | 1 | `PORTB`, `DDRB`, `PINB` bit 1 (PWM: Timer1A) |
| D10 | PORTB | 2 | `PORTB`, `DDRB`, `PINB` bit 2 (PWM: Timer1B) |
| D11 | PORTB | 3 | `PORTB`, `DDRB`, `PINB` bit 3 (PWM: Timer2A) |
| D12 | PORTB | 4 | `PORTB`, `DDRB`, `PINB` bit 4 |
| D13 | PORTB | 5 | `PORTB`, `DDRB`, `PINB` bit 5 (LED) |
| A0 | PORTC | 0 | `PORTC`, `DDRC`, `PINC` bit 0 (ADC0) |
| A1 | PORTC | 1 | `PORTC`, `DDRC`, `PINC` bit 1 (ADC1) |
| A2 | PORTC | 2 | `PORTC`, `DDRC`, `PINC` bit 2 (ADC2) |
| A3 | PORTC | 3 | `PORTC`, `DDRC`, `PINC` bit 3 (ADC3) |
| A4 | PORTC | 4 | `PORTC`, `DDRC`, `PINC` bit 4 (ADC4, SDA) |
| A5 | PORTC | 5 | `PORTC`, `DDRC`, `PINC` bit 5 (ADC5, SCL) |

## Bit Positions

```typescript
// Common bit positions in registers
export const BIT0 = 0;
export const BIT1 = 1;
export const BIT2 = 2;
export const BIT3 = 3;
export const BIT4 = 4;
export const BIT5 = 5;
export const BIT6 = 6;
export const BIT7 = 7;

// UCSR0A bits
export const RXC0  = 7;  // UART Receive Complete
export const TXC0  = 6;  // UART Transmit Complete
export const UDRE0 = 5;  // UART Data Register Empty
export const FE0   = 4;  // Frame Error
export const DOR0  = 3;  // Data OverRun
export const UPE0  = 2;  // UART Parity Error
export const U2X0  = 1;  // Double Transmission Speed
export const MPCM0 = 0;  // Multi-processor Communication Mode

// ADCSRA bits
export const ADEN  = 7;  // ADC Enable
export const ADSC  = 6;  // ADC Start Conversion
export const ADATE = 5;  // ADC Auto Trigger Enable
export const ADIF  = 4;  // ADC Interrupt Flag
export const ADIE  = 3;  // ADC Interrupt Enable
export const ADPS2 = 2;  // ADC Prescaler Select bit 2
export const ADPS1 = 1;  // ADC Prescaler Select bit 1
export const ADPS0 = 0;  // ADC Prescaler Select bit 0
```

## Implementation Example

```typescript
// registers.ts
export const PORTB = 0x25;
export const DDRB  = 0x24;
export const PINB  = 0x23;

// Bit manipulation helpers
export function setBit(port: number, bit: number): string {
  return `PORT${port} |= (1 << ${bit})`;
}

export function clearBit(port: number, bit: number): string {
  return `PORT${port} &= ~(1 << ${bit})`;
}

export function readBit(port: number, bit: number): string {
  return `(PIN${port} >> ${bit}) & 1`;
}