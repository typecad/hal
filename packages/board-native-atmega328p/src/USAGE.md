# @typecode/board-native-atmega328p

Native AVR register access for the ATmega328P microcontroller. This package provides Arduino-equivalent functions using **direct register manipulation** instead of the Arduino framework.

## Features

- **Smaller binary size** - No Arduino core library overhead
- **Faster execution** - Direct register access without function call overhead
- **Predictable timing** - No hidden abstractions or runtime checks
- **Type-safe API** - Same pin interface as other TypeCode board packages

## Installation

```bash
npm install @typecode/board-native-atmega328p
```

## Quick Start

```typescript
import { D13, A0, D9 } from '@typecode/board-native-atmega328p';
import { delay } from '@typecode/board-native-atmega328p';

// Setup - configure pins
D13.asOutput();   // LED pin as output
A0.asInput();     // Analog pin as input

// Digital I/O
D13.high();       // Turn LED on (generates: PORTB |= (1 << 5))
D13.low();        // Turn LED off (generates: PORTB &= ~(1 << 5))

// Read digital state
const state = D13.read();  // Read pin state (generates: ((PINB >> 5) & 1))

// Analog I/O
const value = A0.read();   // Read ADC (generates native ADC register code)
D9.write(128);             // 50% PWM duty cycle (generates native timer code)

// Timing
delay(1000);               // Wait 1 second
```

## API Reference

### Digital Pin Methods

All digital pins (`D0`-`D13`) support these methods:

```typescript
import { D2, D13 } from '@typecode/board-native-atmega328p';

// Configuration
D13.asOutput();        // Set as output
D2.asInput();          // Set as input (floating)
D2.asInputPullUp();    // Set as input with internal pull-up

// Output
D13.high();            // Set HIGH
D13.low();             // Set LOW
D13.toggle();          // Toggle state

// Input
const state = D2.read();    // Read state (0 or 1)
const isOn = D2.isHigh();   // Check if HIGH
const isOff = D2.isLow();   // Check if LOW
```

**Generated C++ Examples:**

| TypeScript | Generated C++ |
|------------|---------------|
| `D13.high()` | `PORTB \|= (1 << 5)` |
| `D13.low()` | `PORTB &= ~(1 << 5)` |
| `D13.toggle()` | `PORTB ^= (1 << 5)` |
| `D13.read()` | `((PINB >> 5) & 1)` |
| `D13.asOutput()` | `DDRB \|= (1 << 5)` |
| `D2.asInputPullUp()` | `DDRD &= ~(1 << 2), PORTD \|= (1 << 2)` |

### PWM Pin Methods

PWM-capable pins (`D3`, `D5`, `D6`, `D9`, `D10`, `D11`) support all digital methods plus:

```typescript
import { D9 } from '@typecode/board-native-atmega328p';

D9.asOutput();
D9.write(128);         // 50% duty cycle (0-255)
D9.write(255);         // 100% duty cycle (always HIGH)
D9.write(0);           // 0% duty cycle (always LOW)
D9.setDutyCycle(128);  // Same as write()
```

**Generated C++ for `D9.write(128)`:**
```cpp
TCCR1A |= (1 << COM1A1) | (1 << WGM10), TCCR1B |= (1 << CS11), OCR1A = 128
```

### Analog Input Methods

Analog pins (`A0`-`A5`) support:

```typescript
import { A0, A1 } from '@typecode/board-native-atmega328p';

A0.asInput();          // Configure as input
const value = A0.read();    // Read 10-bit ADC (0-1023)
const volts = A0.readVoltage();  // Read as voltage (0-5V)
const bits = A0.getResolution(); // Returns 10
```

**Generated C++ for `A0.read()`:**
```cpp
({
  if (!(ADCSRA & (1 << ADEN))) ADCSRA = (1 << ADEN) | (1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0);
  ADMUX = (1 << REFS0) | 0;    // AVcc reference, channel 0
  ADCSRA |= (1 << ADSC);       // Start conversion
  while (ADCSRA & (1 << ADSC); // Wait for completion
  ADC;                          // Return result
})
```

### Timing Functions

```typescript
import { 
  delay, 
  delayMicroseconds, 
  millis, 
  micros,
  map,
  constrain 
} from '@typecode/board-native-atmega328p';

// Blocking delays
delay(1000);              // Wait 1000 milliseconds (1 second)
delayMicroseconds(100);   // Wait 100 microseconds

// Time since boot (requires Timer0 - auto-initialized on first use)
const startTime = millis();
// ... do work ...
const elapsed = millis() - startTime;

// Precise timing
const startUs = micros();
// ... do work ...
const elapsedUs = micros() - startUs;

// Utility functions
const pwmValue = map(sensorValue, 0, 1023, 0, 255);  // Scale ADC to PWM
const limited = constrain(value, 0, 255);            // Clamp to range
```

**Native Implementations:**

| Function | Implementation |
|----------|----------------|
| `delay(ms)` | `_delay_ms(1)` loop using AVR libc |
| `delayMicroseconds(us)` | `_delay_us(1)` loop using AVR libc |
| `millis()` | Timer0 overflow counter (4ms resolution) |
| `micros()` | Timer0 counter + overflow (4μs resolution) |
| `map(x, a, b, c, d)` | Inline arithmetic |
| `constrain(x, a, b)` | Ternary clamp |

### Interrupt Functions

```typescript
import { 
  noInterrupts, 
  interrupts, 
  attachInterrupt, 
  detachInterrupt 
} from '@typecode/board-native-atmega328p';

// Critical section (disable interrupts)
noInterrupts();
// ... atomic operation ...
interrupts();

// External interrupts (only D2=INT0 and D3=INT1)
attachInterrupt(2, () => {
  // Handle button press on D2
}, InterruptMode.FALLING);

// Remove interrupt handler
detachInterrupt(2);
```

**Interrupt Modes:**
- `InterruptMode.LOW` - Trigger when pin is LOW
- `InterruptMode.CHANGE` - Trigger on any edge
- `InterruptMode.RISING` - Trigger on rising edge
- `InterruptMode.FALLING` - Trigger on falling edge

**Native Implementation:**
- Uses `EICRA` register for edge selection
- Uses `EIMSK` register to enable INT0/INT1
- Generates `ISR(INT0_vect)` and `ISR(INT1_vect)` handlers

### Pin Constants

```typescript
// Digital pins
D0, D1, D2, D3, D4, D5, D6, D7,
D8, D9, D10, D11, D12, D13,

// Analog pins
A0, A1, A2, A3, A4, A5,

// Aliases
LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX
```

## Pin Mapping Reference

| Arduino Pin | AVR Port | Bit | PWM | ADC | Interrupt |
|-------------|----------|-----|-----|-----|-----------|
| D0          | PORTD    | 0   | -   | -   | -         |
| D1          | PORTD    | 1   | -   | -   | -         |
| D2          | PORTD    | 2   | -   | -   | INT0      |
| D3          | PORTD    | 3   | OC2B| -   | INT1      |
| D4          | PORTD    | 4   | -   | -   | -         |
| D5          | PORTD    | 5   | OC0B| -   | -         |
| D6          | PORTD    | 6   | OC0A| -   | -         |
| D7          | PORTD    | 7   | -   | -   | -         |
| D8          | PORTB    | 0   | -   | -   | -         |
| D9          | PORTB    | 1   | OC1A| -   | -         |
| D10         | PORTB    | 2   | OC1B| -   | -         |
| D11         | PORTB    | 3   | OC2A| -   | -         |
| D12         | PORTB    | 4   | -   | -   | -         |
| D13         | PORTB    | 5   | -   | -   | -         |
| A0 (D14)    | PORTC    | 0   | -   | ADC0| -         |
| A1 (D15)    | PORTC    | 1   | -   | ADC1| -         |
| A2 (D16)    | PORTC    | 2   | -   | ADC2| -         |
| A3 (D17)    | PORTC    | 3   | -   | ADC3| -         |
| A4 (D18)    | PORTC    | 4   | -   | ADC4| -         |
| A5 (D19)    | PORTC    | 5   | -   | ADC5| -         |

## Example: Blink LED with millis()

```typescript
import { LED } from '@typecode/board-native-atmega328p';
import { millis } from '@typecode/board-native-atmega328p';

LED.asOutput();

let lastToggle = 0;
let ledState = false;

while (true) {
  const now = millis();
  if (now - lastToggle >= 500) {
    lastToggle = now;
    ledState = !ledState;
    if (ledState) LED.high();
    else LED.low();
  }
}
```

**Generated C++:**
```cpp
#include <avr/io.h>
#ifndef F_CPU
#define F_CPU 16000000UL
#endif
#include <util/delay.h>
#include <avr/interrupt.h>

static volatile unsigned long _timer0_overflow_count = 0;
static volatile unsigned long _timer0_millis = 0;

ISR(TIMER0_OVF_vect) {
  _timer0_overflow_count++;
  _timer0_millis += 4;
}

// ... millis() implementation ...

void setup() {
  DDRB |= (1 << 5);  // LED.asOutput()
  _init_timer0();    // Initialize Timer0 for millis()
  
  unsigned long lastToggle = 0;
  bool ledState = false;
  
  while (true) {
    unsigned long now = _native_millis();
    if (now - lastToggle >= 500) {
      lastToggle = now;
      ledState = !ledState;
      if (ledState) PORTB |= (1 << 5);
      else PORTB &= ~(1 << 5);
    }
  }
}

void loop() {}
```

## Example: Read Potentiometer, Control LED Brightness

```typescript
import { A0, D9 } from '@typecode/board-native-atmega328p';
import { map } from '@typecode/board-native-atmega328p';

D9.asOutput();

while (true) {
  const potValue = A0.read();           // 0-1023
  const pwmValue = map(potValue, 0, 1023, 0, 255);  // Scale to 0-255
  D9.write(pwmValue);
}
```

## Example: Button with Interrupt

```typescript
import { D2, LED } from '@typecode/board-native-atmega328p';
import { attachInterrupt, InterruptMode } from '@typecode/board-native-atmega328p';

LED.asOutput();
D2.asInput();

let buttonPressed = false;

// Note: Interrupt handlers must be global functions
attachInterrupt(2, () => {
  buttonPressed = true;
}, InterruptMode.FALLING);

while (true) {
  if (buttonPressed) {
    buttonPressed = false;
    LED.toggle();
  }
}
```

## Comparison with Arduino Framework

| Aspect | Arduino Framework | Native (this package) |
|--------|-------------------|----------------------|
| `D13.high()` | `digitalWrite(13, HIGH)` | `PORTB \|= (1 << 5)` |
| `D2.read()` | `digitalRead(2)` | `((PIND >> 2) & 1)` |
| `A0.read()` | `analogRead(A0)` | Inline ADC registers |
| `delay(1000)` | Arduino `delay()` | `_delay_ms(1)` loop |
| `millis()` | Arduino `millis()` | Timer0 overflow counter |
| Binary overhead | ~1-2KB | ~100 bytes |
| Execution cycles | 50-100 | 1-2 |

## Generated Shim Code

When using this package, the following code is automatically included:

```cpp
#include <avr/io.h>
#ifndef F_CPU
#define F_CPU 16000000UL  // 16 MHz clock frequency
#endif
#include <util/delay.h>
#include <avr/interrupt.h>

// Timer0 for millis()/micros()
static volatile unsigned long _timer0_overflow_count = 0;
static volatile unsigned long _timer0_millis = 0;

ISR(TIMER0_OVF_vect) {
  _timer0_overflow_count++;
  _timer0_millis += 4;  // Each overflow = 4ms at 16MHz with prescaler 64
}

static inline void _init_timer0() {
  if (!(TCCR0B & (1 << CS01))) {
    TCCR0A = 0;  // Normal mode
    TCCR0B = (1 << CS01) | (1 << CS00);  // Prescaler 64
    TIMSK0 = (1 << TOIE0);  // Enable overflow interrupt
    sei();  // Enable global interrupts
  }
}

// Delay functions
static inline void _native_delay_ms(unsigned long ms) { while (ms--) _delay_ms(1); }
static inline void _native_delay_us(unsigned int us) { while (us--) _delay_us(1); }

// Timing functions
static inline unsigned long _native_millis() { /* ... */ }
static inline unsigned long _native_micros() { /* ... */ }

// Utility functions
static inline long _native_map(long x, long in_min, long in_max, long out_min, long out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}
static inline long _native_constrain(long x, long a, long b) {
  return (x < a) ? a : ((x > b) ? b : x);
}

// Interrupt handlers
static volatile void (*_int0_handler)(void) = 0;
static volatile void (*_int1_handler)(void) = 0;
ISR(INT0_vect) { if (_int0_handler) _int0_handler(); }
ISR(INT1_vect) { if (_int1_handler) _int1_handler(); }
```

## License

MIT
