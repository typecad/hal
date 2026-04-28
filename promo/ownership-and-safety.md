# Rust-Inspired Safety Model

[← Home](index.md)

TypeHAL brings Rust's ownership and safety ideas to embedded firmware — without requiring you to write Rust. Bus ownership, ISR-safety analysis, and peripheral conflict detection are enforced at transpile time. Mistakes that used to cause mysterious hangs or data corruption become compile-time errors.

---

## Bus ownership

### The problem

In bare-metal C++ there's nothing stopping you from accessing a shared I2C bus from multiple code paths without coordination. On single-threaded Arduino that causes bus corruption. On multi-threaded ESP32 it causes race conditions and undefined behavior.

### The TypeHAL solution

```typescript
import { I2C0, delay } from '@typehal';

// Claim exclusive access
const bus = I2C0.take();

if (bus) {
  // The bus is typed as IOwnedI2CBus — I/O is only available through this handle
  bus.device(0x76).writeByte(0xFA, 0x55);

  // Return to shared pool when done
  bus.release();
}
```

Ownership rules the transpiler enforces:

| Mistake | Diagnostic |
|---|---|
| Double-take without release | ❌ Error: I2C0 already owned |
| I/O through unowned bus | ⚠️ Warning: I2C0 used without ownership |
| Release without prior take | ⚠️ Warning: I2C0 released but not owned |

---

## Zero-cost on single-threaded targets

On Arduino Uno (single-threaded AVR), `take()` and `release()` emit as comments:

```cpp
// I2C0.take()
Wire.beginTransmission(0x76);
Wire.write(0xFA);
Wire.write(0x55);
Wire.endTransmission();
// I2C0.release()
```

No runtime overhead. The validation is pure compile-time.

On ESP32 (FreeRTOS), `take()` and `release()` emit as mutex acquisition and release — real thread safety with the same TypeScript source.

---

## Peripheral conflict detection

When you mix peripheral setup with GPIO usage on the same physical pin, the transpiler catches it:

```typescript
import { SPI0, D11, D12, D13 } from '@typehal';

SPI0.begin();

D11.output(HIGH);  // ⚠️ Warning: D11 is MOSI — claimed by SPI0
D12.output(HIGH);  // ⚠️ Warning: D12 is MISO — claimed by SPI0
D13.output(HIGH);  // ⚠️ Warning: D13 is SCK  — claimed by SPI0
```

This works for I2C, SPI, UART, and any peripheral registered in the board definition.

---

## ISR safety analysis

Certain operations are unsafe inside an interrupt service routine. TypeHAL analyzes your interrupt handlers and warns when you use them:

```typescript
import { D2, UART0 } from '@typehal';

const serial = UART0.begin(9600);

D2.onChange(() => {
  serial.println("triggered"); // ⚠️ Warning: UART I/O is ISR-unsafe
  delay(10);                   // ⚠️ Warning: delay() is ISR-unsafe
});
```

The set of unsafe operations is parameterized per platform — AVR, ESP32, and others each define their own list via `PlatformStrategy.isrUnsafeOperations()`.

Safe patterns inside ISRs:

```typescript
import { D2, LED } from '@typehal';

let triggered = false;

// Simple flag — safe in ISR
D2.onChange(() => {
  triggered = true;  // ✅ volatile-flagging pattern
});

// Handle in main loop
while (true) {
  if (triggered) {
    triggered = false;
    LED.toggle();
  }
  delay(10);
}
```

---

## Ownership with SPI

```typescript
import { SPI0 } from '@typehal';

const spi = SPI0.take();
if (spi) {
  spi.beginTransaction({ frequency: 4000000, mode: 0, bitOrder: 'msb' });
  spi.transfer(0xAB);
  spi.endTransaction();
  spi.release();
}
```

---

## Ownership with UART

```typescript
import { UART0 } from '@typehal';

const uart = UART0.take();
if (uart) {
  uart.println("exclusive access");
  uart.flush();
  uart.release();
}
```

---

## Ownership is opt-in

If you never call `take()`, no ownership diagnostics are generated. You can adopt the pattern incrementally — start with direct access and add ownership when you need safety guarantees.

---

## Summary

| Safety feature | Where it matters | Cost |
|---|---|---|
| Bus ownership | Shared buses on multi-threaded targets | Zero on AVR |
| Peripheral-pin conflicts | GPIO + peripheral on same pin | Zero |
| ISR-unsafe ops | Interrupt handlers | Zero |
| Uninitialized bus | Forgot `.begin()` | Zero |
| Double-take / use-without-own | Concurrent peripheral access | Zero on AVR |

All safety checks run at transpile time. None of them add code to your sketch.

---

[← Hardware Safety](hardware-safety.md) &nbsp;|&nbsp; [Test & Simulate →](test-and-simulate.md)
