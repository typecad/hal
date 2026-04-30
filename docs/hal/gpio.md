# GPIO & Digital I/O

TypeHAL provides a unified, type-safe interface for interacting with the physical pins of your microcontroller. Unlike traditional embedded APIs where you pass integer pin numbers to functions, TypeHAL treats pins as **objects** with specific, compile-time verified capabilities.

---

## Basic Usage

To use a pin, you typically start by defining its mode. TypeHAL uses **fluent mode conversion** to provide type safety: once you call `.asOutput()`, your editor will only suggest output-related methods.

```typescript
import { D13, D2, HIGH } from '@typehal';

// Configure pin 13 as an output, initially HIGH (on)
const led = D13.asOutput(HIGH);

// Configure pin 2 as an input with internal pull-up resistor
const button = D2.asInputPullUp();
```

---

## Output Operations

Output operations are available on any pin narrowed via `.asOutput()`.

### `high()` and `low()`
The most common way to control a digital state.

```typescript
led.high(); // Set to logic HIGH (e.g. 5V or 3.3V)
led.low();  // Set to logic LOW (GND)
```

### `write(value: DigitalValue)`
Use this when the value is determined by a variable or logic expression. `DigitalValue` is a type alias for `boolean`.

```typescript
import { HIGH, LOW } from '@typehal';

let state = HIGH;
led.write(state);
led.write(!state); // Set to LOW
```

### `toggle()`
Inverts the current state of the pin. This is more efficient than reading the state and writing the inverse manually.

```typescript
// Create a simple blinker
setInterval(() => {
  led.toggle();
}, 500);
```

### `pulse(duration: number)`
Sets the pin `HIGH` for a specific number of milliseconds, then returns it to `LOW`. 

```typescript
// Briefly flash an indicator
led.pulse(50);
```

---

## Input Operations

Input operations are available on any pin narrowed via `.asInput()` or `.asInputPullUp()`.

### `read()`
Returns the current state as a `boolean` (`true` for HIGH, `false` for LOW).

```typescript
const isPressed = button.read();
```

### `isHigh()` and `isLow()`
Semantic helpers for cleaner conditional logic.

```typescript
if (button.isLow()) {
  // Logic for a pressed button (assuming Pull-Up)
}
```

---

## API Reference

### Configuration Methods
| Method | Returns | Description |
| :--- | :--- | :--- |
| `.asOutput(initial?)` | `IOutputModePin` | Sets mode to OUTPUT. Optional `initial` value sets state immediately. |
| `.asInput()` | `IInputModePin` | Sets mode to INPUT (high impedance). |
| `.asInputPullUp()` | `IInputModePin` | Sets mode to INPUT with the internal pull-up resistor enabled. |
| `.asInputPullDown()` | `IInputModePin` | Sets mode to INPUT with internal pull-down (if supported by hardware). |

### Output Handle (`IOutputModePin`)
| Method | Parameters | Description |
| :--- | :--- | :--- |
| `high()` | — | Sets the pin state to `HIGH`. |
| `low()` | — | Sets the pin state to `LOW`. |
| `write(val)` | `val: boolean` | Sets the pin to the provided state. |
| `toggle()` | — | Flips the pin state. |
| `pulse(ms)` | `ms: number` | Pulses the pin `HIGH` for the specified milliseconds. |

### Input Handle (`IInputModePin`)
| Method | Returns | Description |
| :--- | :--- | :--- |
| `read()` | `boolean` | Returns the current digital state. |
| `isHigh()` | `boolean` | Returns `true` if the pin is currently HIGH. |
| `isLow()` | `boolean` | Returns `true` if the pin is currently LOW. |

---

## Advanced Examples

### 1. Simple Debounced Toggle
This example toggles an LED whenever a button is pressed, with a simple delay for debouncing.

```typescript
import { D2, D13, delay } from '@typehal';

const button = D2.asInputPullUp();
const led = D13.asOutput();

while (true) {
  if (button.isLow()) {
    led.toggle();
    delay(200); // Debounce delay
  }
}
```

### 2. Controlling Pin Groups
For operations on multiple pins (like an 8-bit LED bar or a parallel bus), use `createPinGroup`.

```typescript
import { D2, D3, D4, D5, delay } from '@typehal';
import { createPinGroup } from '@typehal/core';

// Define a group for 4 LEDs
const leds = createPinGroup('StatusDisplay', [D2, D3, D4, D5]);

// Write a binary pattern (1010)
leds.writePattern(0b1010);

delay(1000);

// Clear all LEDs in the group
leds.fill(false);
```

### 3. Asynchronous Edge Waiting
Instead of polling in a loop, you can wait for a pin to change state.

```typescript
import { D2 } from '@typehal';

const sensor = D2.asInput();

async function monitor() {
  console.log("Waiting for trigger...");
  await sensor.waitForRising();
  console.log("Trigger detected!");
}

monitor();
```
