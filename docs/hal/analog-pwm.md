# Analog & PWM

TypeHAL provides high-level, hardware-agnostic abstractions for working with varying signals. These are divided into **Analog Input** (reading voltages via ADC) and **Pulse Width Modulation** (approximating analog output).

---

## Analog Input (ADC)

Analog input allows you to read a voltage from a pin and convert it into a digital value. TypeHAL supports both raw ADC readings and direct voltage measurements.

### Basic Reading
To read from an analog pin, ensure it is configured as an input.

```typescript
import { A0, UART0, delay } from '@typehal';

const serial = UART0.begin(9600);
A0.asInput();

while (true) {
  // Read raw value (e.g., 0-1023 on Arduino Uno)
  const raw = A0.readAnalog();
  serial.println(`Raw ADC: ${raw}`);
  delay(100);
}
```

### Voltage Sensing
TypeHAL can automatically convert raw ADC values into volts based on the board's reference voltage and resolution.

```typescript
// Read actual voltage (e.g., 2.5 for a 5V system at half-scale)
const voltage = A0.readVoltage();
serial.println(`Voltage: ${voltage}V`);
```

### Configuration
You can query the hardware resolution or set the reference voltage if the microcontroller supports it.

```typescript
const bits = A0.getAnalogResolution(); // returns e.g., 10
A0.setAnalogReference(3.3);           // Set reference to 3.3V
```

---

## Pulse Width Modulation (PWM)

PWM allows you to simulate an analog output by rapidly toggling a digital pin. It is commonly used for dimming LEDs, controlling motor speed, or driving servos.

### Simple PWM
The `.pwm()` method accepts a **percentage** (0 to 100), making your code independent of the underlying hardware's PWM resolution (whether it's 8-bit, 10-bit, or 16-bit).

```typescript
import { D9 } from '@typehal';

// D9 is a PWM-capable pin on most boards
const led = D9.asOutput();

// Set brightness to 50%
led.pwm(50);
```

### PWM Fade Example
TypeHAL's percentage-based API simplifies fading logic across different hardware.

```typescript
import { D9, delay } from '@typehal';

const led = D9.asOutput();

let percent = 0;
let direction = 1;

while (true) {
  led.pwm(percent);
  
  percent += direction;
  if (percent <= 0 || percent >= 100) {
    direction *= -1;
  }
  delay(20);
}
```

---

## API Reference

### Analog Methods (Input)
Available on pins narrowed via `.asInput()` that have ADC capabilities.

| Method | Returns | Description |
| :--- | :--- | :--- |
| `readAnalog()` | `number` | Returns the raw ADC value (e.g., 0-1023 or 0-4095). |
| `readVoltage()` | `number` | Returns the measured voltage in Volts. |
| `getAnalogResolution()` | `number` | Returns the ADC resolution in bits. |
| `setAnalogReference(v)`| `void` | Sets the ADC reference voltage (e.g., 3.3, 5.0). |

### PWM Methods (Output)
Available on pins narrowed via `.asOutput()` that have PWM hardware.

| Method | Parameters | Description |
| :--- | :--- | :--- |
| `pwm(percent)` | `percent: number` | Sets the PWM duty cycle as a percentage (0.0 to 100.0). |
| `getPwmFrequency()` | — | Returns the current PWM frequency in Hz. |
| `getPwmResolution()` | — | Returns the PWM timer resolution in bits. |

---

## Capability Guarding

One of TypeHAL's core strengths is **static capability validation**. Because pins are typed, the transpiler will catch errors if you try to use PWM or Analog methods on pins that lack the hardware support.

```typescript
import { D4, D9, A0 } from '@typehal';

D4.pwm(50);      // Error: D4 does not support PWM on this board
D9.pwm(50);      // OK: D9 is a PWM pin
A0.readAnalog(); // OK: A0 is an analog pin
D9.readAnalog(); // Error: D9 does not have an ADC
```

---

## Advanced Examples

### 1. Potentiometer-Controlled LED Brightness
Mapping an analog input directly to a PWM output is trivial with the normalized percentage API.

```typescript
import { A0, D9, delay } from '@typehal';

A0.asInput();
const led = D9.asOutput();

while (true) {
  // Read raw value (0-1023 on Uno)
  const val = A0.readAnalog();
  
  // Map raw 10-bit range to 0-100%
  const brightness = (val / 1023) * 100;
  
  led.pwm(brightness);
  delay(10);
}
```

### 2. Battery Voltage Monitor
Using `readVoltage()` simplifies logic by removing the need for manual bit-to-voltage math.

```typescript
import { A1, delay } from '@typehal';

A1.asInput();
const dividerRatio = 2.0; // Assuming a 10k/10k voltage divider

while (true) {
  const vSense = A1.readVoltage();
  const vBat = vSense * dividerRatio;
  
  if (vBat < 3.4) {
    // Logic for low battery
  }
  delay(1000);
}
```
