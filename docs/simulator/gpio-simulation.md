# GPIO Simulation

The simulator provides four GPIO pin types that implement the same HAL interfaces as real hardware pins. Tests inject values and inspect state through simulation-specific helper methods.

## SimDigitalPin

Implements `IDigitalPin` (both `IDigitalInput` and `IDigitalOutput`).

### Production API (same as hardware)

| Method | Description |
|--------|-------------|
| `output()` | Set pin mode to OUTPUT |
| `output(value)` | Set OUTPUT with initial value |
| `input()` | Set pin mode to INPUT (floating) |
| `inputPullUp()` | Set INPUT_PULLUP (value goes HIGH) |
| `inputPullDown()` | Set INPUT_PULLDOWN or the closest supported mode |
| `read()` | Returns `DigitalValue` (HIGH/LOW) |
| `write(value)` | Write `DigitalValue` |
| `high()` | Set HIGH |
| `low()` | Set LOW |
| `toggle()` | Flip state |
| `pulse(duration)` | Toggle twice (no real timing) |
| `tone(freq)` | Returns `IToneAttachment` (no-op in sim) |
| `noTone()` | No-op in simulation |
| `getMode()` | Returns current `PinMode` |
| `setMode(mode)` | Set `PinMode` directly |

### Simulation Helpers

| Method | Description |
|--------|-------------|
| `injectValue(value)` | Simulate an external signal (0 or 1) |
| `getBitValue()` | Get current value as plain number (0 or 1) |
| `getHistory()` | Get all state transitions as `PinStateChange[]` |
| `clearHistory()` | Clear the state transition log |
| `reset()` | Reset to initial state (LOW, OUTPUT) |

### PinStateChange

```typescript
interface PinStateChange {
  timestamp: number;  // ms since simulation start
  from: number;       // previous value (0 or 1)
  to: number;         // new value (0 or 1)
}
```

### Example: Button Press

```typescript
import { createSimBoard } from '@typehal/simulator';

const board = createSimBoard({ boardType: 'arduino-uno' });
const button = board.digital(2);

// Configure as input with pullup
button.inputPullUp();
expect(button.getBitValue()).toBe(1);  // pullup = HIGH

// Simulate button press (active low)
button.injectValue(0);
expect(button.read()).toBe(0 as any);  // LOW

// Simulate button release
button.injectValue(1);
expect(button.read()).toBe(1 as any);  // HIGH

// Check transition history
const history = button.getHistory();
expect(history).toHaveLength(2);
expect(history[0]).toEqual({ timestamp: expect.any(Number), from: 1, to: 0 });
expect(history[1]).toEqual({ timestamp: expect.any(Number), from: 0, to: 1 });
```

### Example: LED Control

```typescript
const led = board.digital(13);

led.asOutput();
led.high();
expect(led.getBitValue()).toBe(1);

led.toggle();
expect(led.getBitValue()).toBe(0);

led.toggle();
expect(led.getBitValue()).toBe(1);
```

---

## SimAnalogPin

Implements `IAnalogInput`.

### Production API

| Method | Description |
|--------|-------------|
| `readAnalog()` | Returns `AnalogValue` (raw ADC value) |
| `readVoltage()` | Returns `AnyVoltage` |
| `setAnalogReference(voltage)` | Set ADC reference voltage |
| `getAnalogResolution()` | Get ADC resolution in bits |

### Simulation Helpers

| Method | Description |
|--------|-------------|
| `injectValue(value)` | Set raw ADC value (0–1023 for 10-bit) |
| `injectVoltage(voltage)` | Set voltage; auto-converts to ADC value |
| `setResolution(bits)` | Set ADC resolution (default: 10) |
| `reset()` | Reset to initial state (0V, 10-bit) |

### Example: Temperature Sensor

```typescript
const sensor = board.analog(0);  // A0

// Simulate 2.5V on a 10-bit ADC with 5V reference
// Expected ADC value: (2.5 / 5.0) * 1023 ≈ 512
sensor.injectVoltage(2.5);
expect(sensor.readAnalog()).toBe(512);

// Or inject a raw ADC value directly
sensor.injectValue(750);
expect(sensor.readAnalog()).toBe(750);

// Read as voltage
const voltage = sensor.readVoltage() as number;
expect(voltage).toBeCloseTo(3.66, 1);  // 750/1023 * 5.0 ≈ 3.66V
```

---

## SimPWMPin

Extends `SimDigitalPin` and implements `IPWMPin`. Only available on PWM-capable pins (3, 5, 6, 9, 10, 11 on Uno/Nano).

### Production API

| Method | Description |
|--------|-------------|
| `pwm()` | Attach PWM on this pin |
| `pwm(percent)` | Set duty cycle 0–100% |
| `write(value)` | Digital write on real hardware, simulator may also accept analog-like values |
| `getPwmFrequency()` | Get current PWM frequency |
| `getPwmResolution()` | Get PWM resolution in bits |

### Simulation Helpers

| Method | Description |
|--------|-------------|
| `getPwmPercent()` | Current duty cycle as percentage (0–100) |
| `getPwmValue()` | Current duty cycle as raw value (0–255 for 8-bit) |
| `isPwmActive()` | Whether PWM is currently attached |
| `setResolution(bits)` | Set PWM resolution (default: 8) |
| `reset()` | Reset to initial state |

### Example: LED Fade

```typescript
const led = board.pwm(9);  // Pin 9 supports PWM on Uno

led.pwm();
led.pwm(50);  // 50% duty cycle
expect(led.getPwmPercent()).toBe(50);
expect(led.getPwmValue()).toBe(128);  // 50% of 255 ≈ 128

led.pwm(100);  // Full brightness
expect(led.getPwmValue()).toBe(255);

led.stop();
expect(led.isPwmActive()).toBe(false);
```

---

## SimInterruptPin

Implements `IInterruptPin`. Only available on interrupt-capable pins (2, 3 on Uno/Nano).

### Production API

| Method | Description |
|--------|-------------|
| `onRising(handler)` | Attach rising-edge interrupt |
| `onFalling(handler)` | Attach falling-edge interrupt |
| `onChange(handler)` | Attach any-change interrupt |
| `offAll()` | Remove all handlers |

### Simulation Helpers

| Method | Description |
|--------|-------------|
| `fireInterrupt(mode, pinValue?)` | Manually fire an interrupt of the given mode |
| `simulateTransition(from, to)` | Fire interrupts matching a state transition |
| `getEvents()` | Get all interrupt events as `InterruptEvent[]` |
| `hasHandler(mode)` | Check if a handler is registered for a mode |
| `reset()` | Remove all handlers and clear events |

### InterruptEvent

```typescript
interface InterruptEvent {
  mode: 'rising' | 'falling' | 'change';
  pinValue: number;
  timestamp: number;
}
```

### Example: Button Interrupt

```typescript
const btn = board.interrupt(2);  // Pin 2 supports interrupts on Uno

let pressCount = 0;
btn.onFalling(() => {
  pressCount++;
});

// Simulate button press (falling edge)
btn.fireInterrupt('falling', 0);
expect(pressCount).toBe(1);

// Simulate state transition (HIGH → LOW triggers falling)
btn.simulateTransition(1, 0);
expect(pressCount).toBe(2);

// Check event log
const events = btn.getEvents();
expect(events).toHaveLength(2);
expect(events[0].mode).toBe('falling');

// Remove handlers
btn.offAll();
btn.fireInterrupt('falling', 0);
expect(pressCount).toBe(2);  // No change — handler removed
```
