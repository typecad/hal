# Signal Utilities

TypeHAL provides a set of specialized functions for working with timing-sensitive signals, serializing data, and generating entropy. These utilities bridge the gap between simple GPIO and complex communication buses.

---

## Tone Generation

The Tone API generates a square wave of a specific frequency on any digital pin. It is primarily used for driving buzzers, speakers, or generating audio-based status signals.

### Basic Usage
Start a continuous tone or a timed beep using the fluent `.for()` builder.

```typescript
import { D8 } from '@typehal';

const speaker = D8.asOutput();

// Play 440Hz (A4) indefinitely
speaker.tone(440);

// Stop the tone
speaker.noTone();

// Play a 1000Hz beep for 500ms
speaker.tone(1000).for(500);
```

---

## Pulse Measurement

The `Pulse` utility measures the duration of a signal pulse (HIGH or LOW) in microseconds. This is critical for sensors like ultrasonic rangefinders or reading incoming PWM signals from RC receivers.

### Fluent API
The fluent API provides a readable way to configure timeouts and pulse polarities.

```typescript
import { Pulse, D7 } from '@typehal';

// Measure a HIGH pulse on D7
const duration = Pulse.on(D7).high();

// Measure a LOW pulse with a custom 20ms timeout
const echoTime = Pulse.on(D7).timeout(20000).low();
```

---

## Shift Registers (Bit-Banging)

Shift registers allow you to expand your I/O pins by serializing data over two or three wires. The `Shift` utility provides software-based bit-banging for both input and output expansion.

### Shifting Out (Output Expansion)
Send 8 bits of data to an output shift register like the 74HC595.

```typescript
import { Shift, D2, D3 } from '@typehal';

const dataPin = D2.asOutput();
const clockPin = D3.asOutput();

// Send the value 0b10101010, Most Significant Bit first
Shift.out(dataPin, clockPin, 'msb', 0xAA);

// Fluent style
Shift.write(dataPin, 0xAA).clock(clockPin).msbFirst();
```

### Shifting In (Input Expansion)
Read 8 bits of data from an input shift register like the 74HC165.

```typescript
// Read 8 bits LSB (Least Significant Bit) first
const state = Shift.read(dataPin).clock(clockPin).lsbFirst();
```

---

## Random Numbers

The `Random` utility provides access to the hardware's pseudo-random number generator (PRNG).

### Seeding
For better randomness, it is recommended to seed the generator with noise from an unconnected analog pin.

```typescript
import { Random, A0 } from '@typehal';

Random.seed(A0.readAnalog());
```

### Generating Values
```typescript
// Generate a number from 0 to 99
const val = Random.upTo(100);

// Generate a number between 10 and 20
const range = Random.between(10, 20);

// Generate a full 32-bit random integer
const bigNum = Random.int();
```

---

## API Reference

### Tone Methods (on `BasePin`)
| Method | Parameters | Returns | Description |
| :--- | :--- | :--- | :--- |
| `tone(hz)` | `hz: number` | `IToneAttachment` | Starts a square wave at the given frequency. |
| `noTone()` | — | `void` | Stops any active tone on the pin. |
| `.for(ms)` | `ms: number` | `void` | (ToneAttachment) Stops the tone after `ms` duration. |

### Pulse Utility (`Pulse`)
| Method | Description |
| :--- | :--- |
| `on(pin).high()` | Measures the next HIGH pulse duration in microseconds. |
| `on(pin).low()` | Measures the next LOW pulse duration in microseconds. |
| `on(pin).timeout(us)`| Sets the maximum wait time for a pulse (in microseconds). |
| `long(pin, val)` | Measures longer pulses using high-precision 64-bit timers. |

### Shift Utility (`Shift`)
| Method | Description |
| :--- | :--- |
| `out(d, clk, ord, v)` | Directly shifts a byte out to a pin. |
| `in(d, clk, ord)` | Directly shifts a byte in from a pin. |
| `write(d, v).clock(c)` | Fluent builder for shifting out. |
| `read(d).clock(c)` | Fluent builder for shifting in. |

### Random Utility (`Random`)
| Method | Description |
| :--- | :--- |
| `seed(val)` | Seeds the PRNG with a starting value. |
| `upTo(max)` | Returns a random number in range `[0, max-1]`. |
| `between(min, max)` | Returns a random number in range `[min, max-1]`. |
| `int()` | Returns a random 32-bit integer. |
