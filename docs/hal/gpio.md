# GPIO

Digital pins are the thinnest class in the HAL: construction configures, and each method lowers to exactly one Zephyr call. The flags are Zephyr's own `GPIO_*` tokens verbatim — no mode strings, no Wiring renumbering.

```typescript
import { GPIO } from '@typecad/hal';
import { LED, BUTTON } from '@typecad/board';

const led = new GPIO(LED, GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

led.set(true);        // gpio_pin_set_dt / gpio_pin_set_raw
led.toggle();         // gpio_pin_toggle_dt (atomic)
if (button.get()) {   // gpio_pin_get_dt / gpio_pin_get_raw
  led.set(false);
}
```

## Construction carries the configuration

The flags you construct with are the flags `gpio_pin_configure_dt` receives — combined with `|`:

| Token | Zephyr equivalent | Meaning |
| :--- | :--- | :--- |
| `GPIO.INPUT` / `GPIO.OUTPUT` | `GPIO_INPUT` / `GPIO_OUTPUT` | Direction. |
| `GPIO.OUTPUT_INIT_LOW` / `GPIO.OUTPUT_INIT_HIGH` | `GPIO_OUTPUT_INIT_LOW/HIGH` | Set the output buffer's initial level **atomically** — no configure-then-write glitch window. |
| `GPIO.PULL_UP` / `GPIO.PULL_DOWN` | `GPIO_PULL_UP` / `GPIO_PULL_DOWN` | Internal bias. |
| `GPIO.OPEN_DRAIN` / `GPIO.OPEN_SOURCE` | `GPIO_OPEN_DRAIN` / `GPIO_OPEN_SOURCE` | Output buffer topology (bus pins like I2C SDA). |
| `GPIO.DISCONNECTED` | `GPIO_DISCONNECTED` | Both buffers off. |

There is no `pinMode()` — the configure applies once, ahead of the pin's first use, wherever that use appears.

The pin argument takes a board package pin export (`LED`, `BUTTON`, `PB5`), a raw number, or a `Pin` instance. Pins with a board devicetree binding (`LED`, `BUTTON`) get the DT treatment: the logical level honors the node's `GPIO_ACTIVE_LOW`, so `set(true)` means "LED on" without polarity arithmetic.

## Reading in expression positions

`get()` in a pure expression (`if (button.get())`) still configures the pin: the guarded configure is **fused into the read's lowering** as one statement-expression, so the pin is never read floating — even where a leading side-effect statement would be dropped.

## Interrupts

`onInterrupt(GPIO.INT_EDGE_FALLING, handler)` / `offInterrupt()` — the edge/level tokens are Zephyr's `GPIO_INT_*` names, and the ISR-safety analysis constrains what handlers may call. See [Events](./events.md).

---

## API Reference

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new GPIO(pin, flags)` | `GPIO` | `pin`: board pin export, number, or `Pin`. `flags`: `GPIO.*` tokens combined with `\|`. |
| `set(value)` | `void` | Drive logically (`true` = active on DT-bound pins). |
| `get()` | `boolean` | Read logically; configure fused into the read. |
| `toggle()` | `void` | Atomic toggle. |
| `onInterrupt(intFlags, fn)` | `void` | Attach an interrupt (`GPIO.INT_*` token). |
| `offInterrupt()` | `void` | Detach. |
