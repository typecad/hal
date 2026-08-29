# zephyr-blink

Blinks the onboard user LED on a **Seeed Studio XIAO nRF52840** using
`@typecad/framework-zephyr`, with the thin HAL classes — `GPIO` with Zephyr
flag tokens and `Time` — devicetree-driven, polarity-correct (the active-low
LED honors its `GPIO_ACTIVE_LOW` flag via `gpio_pin_set_dt`).

## What it does

```ts
import { LED } from '@typecad/board';
import { GPIO, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  led.set(true);   Time.sleep(500);  // → gpio_pin_set_dt(&__tc_dt_led0, 1)  LED ON
  led.set(false);  Time.sleep(500);  // → gpio_pin_set_dt(&__tc_dt_led0, 0)  LED OFF
}
```

## Pipeline

```
TypeScript  →  cuttlefish build  →  out/src/main.cpp  →  west build  →  west flash
```

Transpile only (no Zephyr SDK needed):

```sh
npm run build      # → out/src/main.cpp + main.h
```

Compile + flash (requires the prerequisites below):

```sh
npm run compile    # → west build -b xiao_ble
npm run flash      # → west flash
```

## Prerequisites

The transpile step runs anywhere. Compile/flash require a Zephyr toolchain,
but **you do not need to activate the Python venv manually** — the framework
discovers `west` automatically. It tries, in order:

1. `west` already on PATH (env already activated / global install).
2. `$ZEPHYR_BASE/../.venv` — the canonical Zephyr workspace layout.
3. Well-known workspace dirs (`~/zephyrproject/.venv`, `~/zephyr`, `/opt/zephyrproject`, etc.).
4. System Python (`python`/`python3`/`py`) via `python -m west`.

So a standard `west zephyr-export` + `python -m venv` install (the layout the
[Zephyr getting-started guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html)
produces) works with **zero extra configuration** — the framework finds the
venv's Python and runs `python -m west`, which is more robust than relying on
the `west` shebang launcher.

You will need:

1. A **Zephyr SDK** + toolchain (e.g. `~/zephyr-sdk-0.17.4`).
2. A **Zephyr workspace** with `west` installed in its `.venv`
   (e.g. `~/zephyrproject/{.venv, zephyr}`).
3. Optionally set **`ZEPHYR_BASE`** — if unset, the framework infers it from
   the workspace layout.
4. An **XIAO nRF52840** connected via USB for `west flash` (J-Link / nrfjprog runner).

The toolchain scaffolds `CMakeLists.txt` and `prj.conf` automatically at
compile time (idempotent), then invokes `west build -b xiao_ble` and
`west flash`.

## How the GPIO bridge works

The framework lowers HAL `gpio.*` ops through Zephyr **devicetree specs**:

- The active chip descriptor (`xiao-ble.ts`) maps the onboard LED's GPIO
  number to its DT alias (`led0`).
- `shimLines` emits `static const struct gpio_dt_spec __tc_dt_led0 =
  GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);`.
- `gpio.set_mode` → `gpio_pin_configure_dt`, `gpio.write` →
  `gpio_pin_set_dt`, etc.

Because `gpio_pin_set_dt` honors the node's polarity flags, logical `1`
(= "on") turns the LED on **despite the active-low wiring** — no polarity
inversion in the generated code. Zephyr's devicetree (`xiao_ble.dts`)
carries the `GPIO_ACTIVE_LOW` flag, so the actual hardware pin number is
resolved by the DT, not hardcoded in `main.cpp`.

Pins without a DT spec (or the manifest validator's probe) fall back to the
raw controller path: `gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), pin, ...)`.
