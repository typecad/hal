# Hardware Events (Interrupts)

One mechanism: **GPIO interrupts**. A pin event lowers to `gpio_pin_interrupt_configure_dt` + a callback registered through `gpio_init_callback`/`gpio_add_callback` — Zephyr's interrupt path verbatim, with the edge/level mode expressed as Zephyr's own `GPIO.INT_*` tokens.

For sequential "wait for a signal" logic, interrupts are the wrong tool — poll inside an `async function` with `Time.sleep` (see [Async](./async.md)); the polling task yields between checks and costs nothing when idle.

---

## Attaching an interrupt

```typescript
import { GPIO } from '@typecad/hal';
import { LED, BUTTON } from '@typecad/board';

const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

// Fire on a falling edge (press of a pull-up button).
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  led.toggle();
});
```

The mode is one of the `GPIO.INT_*` tokens — Zephyr's names verbatim, covering edge and level modes:

| Token | Zephyr equivalent | Fires when |
| :--- | :--- | :--- |
| `GPIO.INT_EDGE_RISING` | `GPIO_INT_EDGE_RISING` | the pin goes low → high |
| `GPIO.INT_EDGE_FALLING` | `GPIO_INT_EDGE_FALLING` | the pin goes high → low |
| `GPIO.INT_EDGE_BOTH` | `GPIO_INT_EDGE_BOTH` | either transition |
| `GPIO.INT_LEVEL_LOW` | `GPIO_INT_LEVEL_LOW` | the pin is held low |
| `GPIO.INT_LEVEL_HIGH` | `GPIO_INT_LEVEL_HIGH` | the pin is held high |

Token sets are generated from the Zephyr tree's headers — a misspelled token is an editor-visible member error, and an invalid mode is a build error naming the valid spellings.

## Detaching

```typescript
button.offInterrupt();   // disable + remove the callback
```

## ISR safety constraints

The handler runs in interrupt context. The transpiler's ISR-safety analysis enforces the rules that keep it sound — a handler may set signals and drive pins, but calls that would block or allocate (bus transactions, network, console formatting) are rejected at build time with the offending call named. Keep handlers to flag-setting; do the work in the main flow:

```typescript
import { GPIO, Time } from '@typecad/hal';

let pressed = false;
const button = new GPIO(0, GPIO.INPUT | GPIO.PULL_UP);
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => { pressed = true; });

while (true) {
  if (pressed) {
    pressed = false;
    console.log('pressed');       // safe here — main flow
  }
  Time.sleep(10);
}
```

## Interrupts or polling?

| | Interrupt | Poll in an async task |
| :--- | :--- | :--- |
| Latency | microseconds | poll period (typically ms) |
| Context | ISR constraints apply | none — it's ordinary code |
| Best at | wake/flag/count events that must not be missed | sequential logic, debouncing, "wait for signal then…" |
| Multiple pins | one callback per pin | one task can watch many conditions |

Debouncing is the classic deciding case: an interrupt fires on every bounce, while a polling task naturally reads a settled level — `while (button.get()) { await Time.sleep(20); }` debounces by construction.

---

## API Reference

| Method | Description |
| :--- | :--- |
| `onInterrupt(intFlags, handler)` | Attach an interrupt with a `GPIO.INT_*` edge/level token. |
| `offInterrupt()` | Detach (disable + remove callback). |
