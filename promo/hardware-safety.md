# Hardware Bugs in Your Editor

[← Home](index.md)

The classic embedded development loop: write code, compile, flash, wait 30 seconds, discover the wrong pin, repeat. TypeHAL breaks that loop. If something is wrong with your hardware usage, you see a red squiggle in your editor — before you ever hit upload.

---

## How it works

TypeHAL knows your board. When you install a board package like `@typehal/board-arduino-uno`, you get a complete machine-readable map of every pin's capabilities: which pins support PWM, which are analog-only, which are claimed by I2C or SPI, which can trigger interrupts.

The TypeScript type system uses this data to narrow every pin to exactly what it can do. A function that takes a `PWMPin` won't accept `D4` on an Arduino Uno — because `D4` isn't a PWM pin on that board.

---

## Pin capability checks

```typescript
import { D4, D9, A0, A1 } from '@typehal';

// PWM
D4.pwm(50);       // ❌ Error: D4 does not support PWM on Arduino Uno
D9.pwm(50);       // ✅ OK — D9 is Timer1 OC1B

// Analog
A0.high();        // ❌ Error: A0 is analog-only
A0.readAnalog();  // ✅ OK — returns 0–1023

// Digital output on analog pin
A1.asOutput();    // ✅ OK — A1 can operate as digital GPIO
```

These are not runtime checks. The type narrowing happens at the TypeScript level, so VS Code underlines the mistake as you type it.

---

## Uninitialized peripheral detection

```typescript
import { I2C0 } from '@typehal';

// Without begin():
I2C0.device(0x76).readByte(0xFA);
// ❌ Transpiler diagnostic: I2C0 has not been initialized
//    Call I2C0.begin() before accessing devices.

// With begin():
I2C0.begin();
const who = I2C0.device(0x76).readByte(0xFA); // ✅ OK
```

The same pattern applies to SPI and UART — the type system tracks initialization state so the "forgot `.begin()`" mistake becomes impossible.

---

## Peripheral-pin conflict detection

When you initialize I2C on an Arduino Uno, pins A4 (SDA) and A5 (SCL) are claimed. If your code tries to use them as GPIO after that, the transpiler warns you:

```typescript
import { I2C0, A4, A5 } from '@typehal';

I2C0.begin();

A4.output(HIGH);  // ⚠️ Warning: A4 is claimed by I2C0 (SDA)
A5.output(HIGH);  // ⚠️ Warning: A5 is claimed by I2C0 (SCL)
```

Similarly for SPI (D10/D11/D12/D13) and other peripherals.

---

## ADC range validation

ADC validation is board-data-driven. The transpiler reads the board's actual reference voltage and resolution and validates your analog comparisons:

```typescript
const raw = A0.readAnalog();  // 10-bit ADC on Uno: 0–1023

if (raw > 2000) {  // ⚠️ Warning: comparison always false (max is 1023)
  // unreachable
}
```

---

## Type guards and assertions at runtime

For cases where pin capability isn't known until runtime, TypeHAL provides runtime type guards that narrow the type and produce compile-safe code:

```typescript
import { isPWMPin, isAnalogPin, assertPWM } from '@typehal/core';
import type { PWMPin } from '@typehal/core';

function safeWrite(pin: unknown, value: number) {
  if (isPWMPin(pin)) {
    pin.pwm(value);  // ✅ type is narrowed to PWMPin here
  }
}

// Or assert and get a hard error if the pin doesn't qualify:
assertPWM(D3, 'D3 must support PWM');
```

---

## Functions typed to pin capability

You can write functions that only accept the right kind of pin — the compiler enforces it:

```typescript
import type { PWMPin } from '@typehal/core';

function fadeLED(pin: PWMPin, durationMs: number) {
  for (let i = 0; i <= 100; i++) {
    pin.pwm(i);
    delay(durationMs / 100);
  }
}

fadeLED(D9, 500);   // ✅ D9 is PWMPin
fadeLED(D4, 500);   // ❌ Argument of type 'D4Pin' is not assignable to 'PWMPin'
```

---

## Interrupt pin safety

```typescript
import { D2, D3, D4 } from '@typehal';

D2.onChange(() => { /* handler */ });  // ✅ D2 is an interrupt pin on Uno
D3.onFalling(() => { /* handler */ }); // ✅ D3 is an interrupt pin on Uno
D4.onChange(() => { /* handler */ });  // ❌ Error: D4 does not support interrupts
```

---

## How diagnostics surface

Diagnostics appear in three places simultaneously:

1. **VS Code squiggles** — red/yellow underlines as you type, via the `typehal-env.d.ts` type definitions the transpiler auto-generates
2. **Transpiler output** — `npx typehal build` prints every diagnostic with code, message, and source location
3. **CI** — diagnostics with severity `error` exit non-zero, blocking your build pipeline

---

[← TypeScript to C++](typescript-to-cpp.md) &nbsp;|&nbsp; [Ownership & Safety →](ownership-and-safety.md)
