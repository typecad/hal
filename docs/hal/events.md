# Hardware Events

TypeCAD provides two powerful ways to handle hardware events like pin state changes: **External Interrupts** for immediate, low-latency response, and **Asynchronous Edge Detection** for readable, sequential logic.

---

## External Interrupts

Interrupts allow the microcontroller to respond to a physical event (like a button press or sensor trigger) immediately, pausing the main loop to execute a handler function.

### Basic Interrupts
Use `.onRising()`, `.onFalling()`, or `.onChange()` to attach an interrupt handler.

```typescript
import { D2, D13 } from '@typecad/board';

const led = D13.asOutput();

// Toggle LED whenever D2 goes from LOW to HIGH
D2.onRising(() => {
  led.toggle();
});
```

### Detaching Handlers
You can remove all interrupts from a pin using `.offInterrupts()`.

```typescript
D2.offInterrupts();
```

### Important Constraints (ISR Safety)
Interrupt handlers (ISRs) run in a special hardware context. To ensure system stability:
1. **Keep it short**: Execute the minimum amount of logic necessary.
2. **Avoid blocking**: Never use `delay()` or long-running loops inside an interrupt.
3. **No Serial/I2C**: Avoid complex communication inside an ISR as they often rely on interrupts themselves.

---

## Asynchronous Edge Detection

For many applications, interrupts are unnecessary and can make code logic difficult to follow. TypeCAD provides `async` methods that allow you to "wait" for a hardware event in a clean, sequential style.

### Waiting for an Edge
The `waitForRising` and `waitForFalling` methods return a `Promise` that resolves when the event occurs. The transpiler automatically generates the necessary state machines to handle this without blocking other tasks.

```typescript
import { D2, delay } from '@typecad/board';

const sensor = D2.asInput();

async function main() {
  while (true) {
    console.log("Waiting for trigger...");
    
    // Execution pauses here (non-blocking) until D2 goes HIGH
    await sensor.waitForRising();
    
    console.log("Event detected!");
    
    // Resolution: handle the event
    delay(2000); 
  }
}

main();
```

### Timeouts
You can provide an optional timeout (in milliseconds). If the event doesn't occur within the timeout, the promise resolves.

```typescript
// Wait up to 5 seconds for a response
await sensor.waitForRising(5000);
```

---

## Comparison: Interrupts vs. Async

| Feature | Interrupts (`onRising`) | Async (`waitForRising`) |
| :--- | :--- | :--- |
| **Latency** | Extremely low (nanoseconds) | Moderate (microsecond polling) |
| **Code Style**| Event-driven (Callbacks) | Sequential (`async`/`await`) |
| **Complexity**| High (requires ISR-safe logic)| Low (standard TypeScript style) |
| **Best For** | High-speed encoders, safety stops | Buttons, slow sensor pulses, UI |

---

## API Reference

### Interrupt Methods
Available on pins with hardware interrupt capabilities (narrowed via `.asInput()`).

| Method | Parameters | Description |
| :--- | :--- | :--- |
| `onRising(fn)` | `fn: () => void` | Execute `fn` when pin goes from LOW to HIGH. |
| `onFalling(fn)` | `fn: () => void` | Execute `fn` when pin goes from HIGH to LOW. |
| `onChange(fn)` | `fn: () => void` | Execute `fn` on any state change. |
| `offInterrupts()` | — | Remove all interrupt handlers from the pin. |

### Async Methods
Available on all digital input pins.

| Method | Parameters | Description |
| :--- | :--- | :--- |
| `waitForRising(to?)`| `to: number` (opt) | Pauses execution until a rising edge (or timeout). |
| `waitForFalling(to?)`| `to: number` (opt) | Pauses execution until a falling edge (or timeout). |

---

## Advanced Example: Manual Pulse Measurement
While the `Pulse` utility is optimized for high speed, you can use async methods for long-duration pulses.

```typescript
import { D2, millis } from '@typecad/board';

const pin = D2.asInput();

async function measureLongPulse() {
  console.log("Waiting for start of pulse...");
  await pin.waitForRising();
  const start = millis();
  
  await pin.waitForFalling();
  const end = millis();
  
  console.log(`Pulse lasted ${end - start} ms`);
}
```
