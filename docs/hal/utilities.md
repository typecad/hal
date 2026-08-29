# Utilities (Tone, Shift, Random, Power)

Small stateless surfaces that don't own a peripheral session: a square-wave sugar on `PWM`, the bit-bang shift functions, the PRNG, and the power-management verbs. Each lowers directly onto the platform's native calls — `pwm_set_dt` for tone, `gpio` toggling for shifts, the hardware RNG seed, and the power-management subsystem for sleep.

---

## Tone Generation

`PWM.tone(hz)` is square-wave sugar: one `pwm_set_dt` at 50% duty with the period derived from the frequency. It rides the same PWM construction facts (period ranges) as duty-cycle control, so the channel keeps working with `setDuty`/`setPulse` afterwards.

```typescript
import { PWM } from '@typecad/hal';

const buzzer = new PWM(6, { periodNs: 1000000 });
buzzer.tone(440);      // A4
// …
buzzer.tone(0);        // stop (a zero period releases the channel)
```

There is no separate `noTone()` — `tone(0)` stops it.

---

## Shift Registers (Bit-Banging)

Module-level functions, not classes — a shift is a bounded sequence of pin toggles, not a peripheral to own:

```typescript
import { shiftOut, shiftIn } from '@typecad/hal';

// MSB-first by default; pass false for LSB-first.
shiftOut(dataPin, clockPin, 0b10110001);
const b = shiftIn(dataPin, clockPin);     // reads 8 bits
```

The data and clock pins are plain numbers — board package pin exports work directly.

---

## Random Numbers

```typescript
import { Random } from '@typecad/hal';

Random.seed(0xC0FFEE);               // optional — reproducible sequences
const die = Random.upTo(6);          // [0, 5]
const pct = Random.between(1, 101);  // [1, 100]
const big = Random.int();            // non-negative 31-bit integer
```

On Zephyr the PRNG is seeded from the hardware entropy source at boot, so `seed()` is only needed when you *want* determinism (tests, simulations).

---

## Power

`Power` is stateless — sleep entry goes through the platform's power-management policy, so there are no construction facts, just verbs. Use the exported `PowerDefault` instance (or construct your own; they are identical).

```typescript
import { PowerDefault } from '@typecad/hal';

PowerDefault.setCpuFrequency(160);        // MHz — relock the CPU clock

// Deep sleep: the chip powers down; WAKEUP RESETS IT — normal boot runs again.
PowerDefault.deepSleep(60_000);           // 60 s, then reboot

// Deep sleep until a pin level: RTC-capable pins only (the framework flags
// non-RTC pins at compile time). Wakeup resets the chip — never returns.
PowerDefault.deepSleepUntil(BUTTON, 0);   // wake when the button pulls low

// Light sleep: RAM retained, execution resumes where it left off.
PowerDefault.lightSleep();                // any configured wake source resumes it
```

The critical distinction:

- **`deepSleep` / `deepSleepUntil` never return.** Wakeup is a chip reset — your program starts from the top. Persist any state you care about (`Store`/`File`) before sleeping.
- **`lightSleep` returns** when a wake source fires (GPIO, timer); execution continues on the next line.

`deepSleepUntil(pin, level)` lowers to the target's ext-wakeup mechanism — ext0 on Xtensa ESP32/S3 (RTC pins only), the GPIO-wakeup variant on RISC-V ESP32-C3/C6. Passing a non-RTC pin is a compile-time error, not a runtime surprise.

> A deep-sleeping board drops its USB console — that's the chip powered down, not a crash. A `console.log` right at boot tells you which wake you're looking at.

---

## API Reference

### Tone (on `PWM`)

| Method | Parameters | Returns | Description |
| :--- | :--- | :--- | :--- |
| `tone(hz)` | `hz: number` | `void` | Square wave at `hz` (50% duty). `tone(0)` stops it. |

### Shift

| Function | Description |
| :--- | :--- |
| `shiftOut(dataPin, clockPin, value, msbFirst?)` | Shift a byte out — a bounded pin-toggle bit-bang. |
| `shiftIn(dataPin, clockPin, msbFirst?)` | Shift a byte in. |

### Random

| Method | Description |
| :--- | :--- |
| `Random.seed(val)` | Reseed the PRNG (for reproducible sequences). |
| `Random.upTo(max)` | Random in `[0, max-1]`. |
| `Random.between(min, max)` | Random in `[min, max-1]`. |
| `Random.int()` | Random non-negative 31-bit integer. |

### Power

| Method | Description |
| :--- | :--- |
| `deepSleep(ms)` | Deep sleep for `ms`; wakeup **resets the chip**. Never returns. |
| `deepSleepUntil(pin, level)` | Deep sleep until the RTC-capable pin reaches `level` (0/1). Wakeup resets the chip. Never returns. |
| `lightSleep()` | Light sleep until any wake source; execution resumes. |
| `setCpuFrequency(mhz)` | Relock the CPU clock. |
