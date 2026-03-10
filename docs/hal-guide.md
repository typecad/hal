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
LED.config.output.initial(HIGH);

while (true) {
  LED.toggle();  // Switch between HIGH and LOW
  // Or use: LED.high(), LED.low()
}
```

### Input with Pull-up

```typescript
import { D2, LED } from '@typecode';

// Configure button pin with internal pull-up resistor
D2.config.input.pullup();

LED.config.output();

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

UART0.config.baudRate(9600).begin();

while (true) {
  const value = A0.read();  // 0-1023
  UART0.write.line(value.toString());
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
D9.config.output.initial(LOW);

let brightness = 0;
let step = 5;

while (true) {
  D9.write(brightness);  // 0-255
  brightness += step;
  
  if (brightness <= 0 || brightness >= 255) {
    step = -step;  // Reverse direction
  }
  delay(30);
}
```

---

## UART/Serial

UART provides serial communication for debugging and data transfer.

### Basic Serial Output

```typescript
import { UART0, delay } from '@typecode';

// Configure and begin serial at 9600 baud
UART0.config.baudRate(9600).begin();

let counter = 0;

while (true) {
  UART0.print("Count: ");
  UART0.println(counter.toString());
  counter++;
  delay(1000);
}
```

### Full Configuration Options

```typescript
import { UART0 } from '@typecode';
import { UARTStopBits, UARTFlowControl, UARTParity } from '@typecode/core';

UART0.config
  .baudRate(115200)
  .dataBits(8)
  .parity(UARTParity.NONE)
  .stopBits(UARTStopBits.ONE)
  .flowControl(UARTFlowControl.NONE)
  .begin();
```

### Reading Serial Data

```typescript
import { UART0 } from '@typecode';

UART0.config.baudRate(9600).begin();

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
I2C0.config.begin();
```

### Reading from a Sensor

```typescript
import { I2C0, UART0, delay } from '@typecode';

UART0.config.baudRate(9600).begin();
I2C0.config.begin();

const SENSOR_ADDR = 0x76;

while (true) {
  // Read 2 bytes from register 0xFA
  const data = I2C0.device(SENSOR_ADDR).readBytes(0xFA, 2);
  
  const msb = data[0];
  const lsb = data[1];
  const value = (msb << 8) | lsb;
  
  UART0.write.line(value.toString());
  delay(1000);
}
```

### Writing to a Device

```typescript
import { I2C0 } from '@typecode';

I2C0.config.begin();

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

// Configure SPI: 1MHz, Mode 0, MSB first
SPI0.config
  .frequency(1_000_000)
  .mode(0)
  .bitOrder('msb')
  .begin();

// Chip select pin (active LOW)
const CS = D10;
CS.config.output.initial(true);  // Start HIGH (deselected)
```

### Single Byte Transfer

```typescript
import { SPI0, D10, UART0, delay } from '@typecode';

UART0.config.baudRate(9600).begin();
SPI0.config.frequency(1_000_000).mode(0).begin();

const CS = D10;
CS.config.output.initial(true);

while (true) {
  // Transfer automatically handles chip select
  const response = SPI0.device(CS).transfer(0xAA);
  UART0.write.line(`Received: 0x${response.toString(16)}`);
  delay(1000);
}
```

### Multi-Byte Transfer

```typescript
import { SPI0, D10 } from '@typecode';

SPI0.config.frequency(1_000_000).mode(0).begin();

const CS = D10;
CS.config.output.initial(true);

// Transfer multiple bytes at once
const txData = new Uint8Array([0x80, 0x00, 0xFF]);
const rxData = SPI0.device(CS).transfer(txData);
```

---

## Interrupts

Interrupts allow immediate response to external events without polling.

### Button Interrupt

```typescript
import { D2, LED, LOW } from '@typecode';

LED.config.output.initial(LOW);

// Configure button with pull-up
D2.config.input.pullup();

// Toggle LED on falling edge (button press)
D2.on.falling(() => {
  LED.toggle();
});
```

### Interrupt Trigger Options

```typescript
import { D2 } from '@typecode';

D2.config.input.pullup();

// Available triggers:
D2.on.rising(() => { /* called on LOW to HIGH */ });
D2.on.falling(() => { /* called on HIGH to LOW */ });
D2.on.change(() => { /* called on any change */ });
```

---

## Timing

TypeCode provides timing functions for delays and measuring elapsed time.

### Delay

```typescript
import { LED, delay } from '@typecode';

LED.config.output();

while (true) {
  LED.toggle();
  delay(1000);  // Wait 1000ms (1 second)
}
```

### Millis (Elapsed Time)

```typescript
import { UART0, millis, delay } from '@typecode';

UART0.config.baudRate(9600).begin();

const startTime = millis();

while (true) {
  const elapsed = millis() - startTime;
  UART0.write.line(`Elapsed: ${elapsed}ms`);
  delay(1000);
}
```

---

## Quick Reference

| System | Import | Key Methods |
|--------|--------|-------------|
| Digital I/O | `D2, LED, HIGH, LOW` | `.config.output()`, `.config.input()`, `.read()`, `.write()`, `.high()`, `.low()`, `.toggle()` |
| Analog | `A0` | `.read()` |
| PWM | `D9` (PWM pin) | `.write(value)` |
| UART | `UART0` | `.config.baudRate().begin()`, `.print()`, `.println()`, `.read()`, `.available()` |
| I2C | `I2C0` | `.config.begin()`, `.device(addr).readBytes()`, `.device(addr).writeBytes()` |
| SPI | `SPI0, D10` | `.config.frequency().mode().begin()`, `.device(cs).transfer()` |
| Interrupts | `D2` (interrupt pin) | `.on.rising()`, `.on.falling()`, `.on.change()` |
| Timing | `delay, millis` | `delay(ms)`, `millis()` |