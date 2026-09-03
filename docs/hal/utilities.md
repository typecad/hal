# Utilities (Shift, Random)

Small stateless surfaces that don't own a peripheral session: the bit-bang shift functions and the PRNG. Each lowers directly onto the platform's native calls — `gpio` toggling for shifts, the RNG seed for random.

---

## Shift Registers (Bit-Banging)

Module-level functions, not classes — a shift is a bounded sequence of pin toggles, not a peripheral to own:

```typescript
import { shiftOut, shiftIn } from '@typecad/hal';

// MSB-first by default; pass false for LSB-first.
shiftOut(4, 5, 0b10110001);
const b = shiftIn(4, 5);                  // reads 8 bits
```

The data and clock pins are plain numbers — board package pin exports work directly. For real SPI, use `SPITarget`.

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

## API Reference

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
