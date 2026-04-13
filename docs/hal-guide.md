# TypeCode HAL Guide

This guide covers the major Hardware Abstraction Layer (HAL) systems in TypeCode with simple, practical examples.

## Table of Contents

- [Digital Pins](#digital-pins)
- [Analog Pins](#analog-pins)
- [PWM (Pulse-Width Modulation)](#pwm-pulse-width-modulation)
- [UART/Serial](#uartserial)
- [I2C](#i2c)
- [SPI](#spi)
- [Interrupts](#interrupts)
- [Timing](#timing)

---

## Digital Pins

Digital pins can be configured as inputs or outputs and read/write HIGH or LOW values.

### Basic Output

```typescript
import { LED, HIGH, LOW } from '@typecode';

// Configure LED pin as output, starting HIGH
LED.output(HIGH);

while (true) {
  LED.toggle();  // Switch between HIGH and LOW
  // Or use: LED.high(), LED.low()
}
```

### Input with Pull-up

```typescript
import { D2, LED } from '@typecode';

// Configure button pin with internal pull-up resistor
D2.inputPullUp();

LED.output();

while (true) {
  if (D2.read() === LOW) {
    LED.high();  // Button pressed (pulled low)
  } else {
    LED.low();   // Button released
  }
}
```

---

## Analog Pins

Analog pins read continuous voltage values (0-1023 on 10-bit ADC).

### Reading Analog Values

```typescript
import { A0, UART0, delay } from '@typecode';

UART0.begin(9600);

while (true) {
  const value = A0.readAnalog();  // 0-1023 on Uno
  UART0.println(value.toString());
  delay(500);
}
```

---

## PWM (Pulse-Width Modulation)

PWM pins can output analog-like values by varying duty cycle (0-255).

### LED Fading

```typescript
import { D9, delay, LOW } from '@typecode';

// D9 must be a PWM-capable pin
D9.output(LOW);

let brightness = 0;
let step = 5;

while (true) {
  D9.pwm(brightness / 2.55);  // convert 0-255 into 0-100 percent
  brightness += step;
  
  if (brightness <= 0 || brightness >= 255) {
    step = -step;  // Reverse direction
  }
  delay(30);
}
```

### PWM Duty Cycle

```typescript
import { D9 } from '@typecode';

// Set PWM to 50% duty cycle
D9.pwm(50);
```

### Shared PWM Timers

PWM outputs are not always independent. On Uno, these pins share hardware timers:

- `D5` and `D6` share `timer0`
- `D9` and `D10` share `timer1`
- `D3` and `D11` share `timer2`

TypeCode now emits an informational diagnostic when your program uses multiple PWM pins from the same timer group. That is not automatically wrong, but it matters whenever the target framework or board ties PWM configuration to timer-wide state.

---

## UART/Serial

UART provides serial communication for debugging and data transfer.

### Basic Serial Output

```typescript
import { UART0, delay } from '@typecode';

// Begin serial at 9600 baud
UART0.begin(9600);

let counter = 0;

while (true) {
  UART0.print("Count: ");
  UART0.println(counter.toString());
  counter++;
  delay(1000);
}
```

### Reading Serial Data

```typescript
import { UART0 } from '@typecode';

UART0.begin(9600);

while (true) {
  if (UART0.available() > 0) {
    const byte = UART0.read();  // Read single byte
    UART0.write(byte);          // Echo back
  }
}
```

---

## I2C

I2C is a two-wire protocol for communicating with sensors and other devices.

### Basic I2C Setup

```typescript
import { I2C0 } from '@typecode';

// Initialize I2C as master
I2C0.begin();
```

### Reading from a Sensor

```typescript
import { I2C0, UART0, delay } from '@typecode';

UART0.begin(9600);
I2C0.begin();

const SENSOR_ADDR = 0x76;

while (true) {
  // Read 2 bytes from register 0xFA
  const data = I2C0.device(SENSOR_ADDR).readBytes(0xFA, 2);
  
  const msb = data[0];
  const lsb = data[1];
  const value = (msb << 8) | lsb;
  
  UART0.println(value.toString());
  delay(1000);
}
```

### Writing to a Device

```typescript
import { I2C0 } from '@typecode';

I2C0.begin();

const DEVICE_ADDR = 0x40;

// Write single byte to register
I2C0.device(DEVICE_ADDR).writeByte(0x01, 0x00);

// Write multiple bytes
I2C0.device(DEVICE_ADDR).writeBytes(0x02, new Uint8Array([0x10, 0x20, 0x30]));
```

---

## SPI

SPI is a high-speed serial protocol for communicating with devices like sensors, displays, and shift registers.

### Basic SPI Setup

```typescript
import { SPI0, D10 } from '@typecode';

const spi = SPI0.begin();

// Configure SPI: 1MHz, Mode 0, MSB first
spi.setFrequency(1_000_000);
spi.setMode(0);
spi.setBitOrder('msb');

// Chip select pin (active LOW)
const CS = D10;
CS.output(HIGH);  // Start HIGH (deselected)
```

### Single Byte Transfer

```typescript
import { SPI0, D10, UART0, delay } from '@typecode';

UART0.begin(9600);
const spi = SPI0.begin();
spi.setFrequency(1_000_000);
spi.setMode(0);

const CS = D10;
CS.output(HIGH);

while (true) {
  // Transfer automatically handles chip select
  const response = spi.device(CS).transfer(0xAA);
  UART0.println(`Received: 0x${response.toString(16)}`);
  delay(1000);
}
```

### Multi-Byte Transfer

```typescript
import { SPI0, D10 } from '@typecode';

const spi = SPI0.begin();
spi.setFrequency(1_000_000);
spi.setMode(0);

const CS = D10;
CS.output(HIGH);

// Transfer multiple bytes at once
const txData = new Uint8Array([0x80, 0x00, 0xFF]);
const rxData = spi.device(CS).transfer(txData);
```

---

## Interrupts

Interrupts allow immediate response to external events without polling.

### Button Interrupt

```typescript
import { D2, LED, LOW } from '@typecode';

LED.output(LOW);

// Configure button with pull-up
D2.inputPullUp();

// Toggle LED on falling edge (button press)
D2.onFalling(() => {
  LED.toggle();
});
```

### Interrupt Trigger Options

```typescript
import { D2 } from '@typecode';

D2.inputPullUp();

// Available triggers:
D2.onRising(() => { /* called on LOW to HIGH */ });
D2.onFalling(() => { /* called on HIGH to LOW */ });
D2.onChange(() => { /* called on any change */ });
```

---

## Timing

TypeCode provides timing functions for delays and measuring elapsed time.

### Delay

```typescript
import { LED, delay } from '@typecode';

LED.output();

while (true) {
  LED.toggle();
  delay(1000);  // Wait 1000ms (1 second)
}
```

### Millis (Elapsed Time)

```typescript
import { UART0, millis, delay } from '@typecode';

UART0.begin(9600);

const startTime = millis();

while (true) {
  const elapsed = millis() - startTime;
  UART0.println(`Elapsed: ${elapsed}ms`);
  delay(1000);
}
```

---

## Quick Reference

| System | Import | Key Methods |
|--------|--------|-------------|
| Digital I/O | `D2, LED, HIGH, LOW` | `.output()`, `.inputPullUp()`, `.read()`, `.write()`, `.high()`, `.low()`, `.toggle()` |
| Analog | `A0` | `.readAnalog()`, `.readVoltage()` |
| PWM | `D9` (PWM pin) | `.pwm(percent)` |
| UART | `UART0` | `.begin(baud)`, `.end()`, `.print()`, `.println()`, `.read()`, `.available()` |
| I2C | `I2C0` | `.begin()`, `.end()`, `.device(addr).readBytes()`, `.device(addr).writeBytes()` |
| SPI | `SPI0, D10` | `const spi = SPI0.begin()`, `.setFrequency()`, `.setMode()`, `.device(cs).transfer()` |
| Interrupts | `D2` (interrupt pin) | `.onRising()`, `.onFalling()`, `.onChange()` |

## Board-aware constraints

TypeCode's HAL is designed around board knowledge, not generic GPIO optimism. The transpiler can already tell you about conflicts such as:

- using `D0` or `D1` as general GPIO on Uno while serial is active
- using `A4` or `A5` as GPIO while `I2C0` is enabled
- using `D11`, `D12`, or `D13` as general GPIO while `SPI0` is enabled
- mixing `LED` and `D13` or `TX` and `D1` in the same program for the same physical pin
- using multiple PWM pins that share one hardware timer group
- requesting hardware pulldown on boards that only support pull-up

Treat those diagnostics as part of the programming model. The goal is to make the “safe path” the easiest path.
