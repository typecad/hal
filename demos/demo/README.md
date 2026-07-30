# `@typecad/framework-zephyr` on ESP32-S3 — blink demo

A minimal sketch (`src/main.ts`) that blinks a GPIO pin every 500 ms on an
**ESP32-S3** (`esp32s3_devkitc`) running the **Zephyr RTOS**. It demonstrates
`@typecad/framework-zephyr` targeting an Espressif SoC: devicetree-driven GPIO
across the ESP32-S3's two GPIO controllers.

- **Target:** ESP32-S3 DevKitC (`esp32s3_devkitc`, Zephyr RTOS)
- **Framework:** `@typecad/framework-zephyr` (west/CMake build,
  devicetree-driven GPIO)
- **Sketch:** blink `D2` (GPIO2) as an output.

## What it demonstrates

- **Same framework, different SoC.** The Zephyr framework that already targets
  the nRF52840 (`xiao_ble`) targets the ESP32-S3 unchanged on the lowering
  side — only a new **chip descriptor** (`esp32s3_devkitc`) was added.
- **Devicetree is the source of truth.** The descriptor carries *only* what a
  compile-time DT macro cannot reach: the ESP32-S3 splits GPIO across two DT
  controllers (`gpio0`: pins 0–31, `gpio1`: pins 32–48), so the descriptor
  lists those ranges. UART/I2C/SPI/`wdt` nodelabels are resolved by Zephyr's
  own devicetree via emitted `DT_NODELABEL(...)` macros — not hand-copied.
- **Framework-agnostic board package.** `@typecad/board-esp32s3` is the same
  package used by the Arduino/IDF demos; only the `framework:` / `toolchain:`
  fields differ. The pin objects (`D2`, etc.) are identical across frameworks.

## Wiring

The `esp32s3_devkitc` onboard RGB LED is a **WS2812** on GPIO38 — not a plain
GPIO LED, so it cannot be driven by a single `gpio_pin_set`. For this blink
demo, connect an external LED + current-limiting resistor (~220Ω) between
**D2 (GPIO2)** and **GND**.

## Pipeline

```
TypeScript  →  cuttlefish build  →  out/src/main.cpp  →  west build  →  west flash
```

Transpile only (no Zephyr SDK needed):

```sh
npm run build      # → out/src/main.cpp + main.h
```

Compile + upload (requires the prerequisites below):

```sh
npm run compile    # → west build -b esp32s3_devkitc/esp32s3/procpu
npm run upload     # → west flash (esptool, over USB to COM5)
```

The `upload` script runs `cuttlefish build --compile --upload --port COM5`,
which chains transpile → `west build` → `west flash`. To target a different
serial port, override it directly:

```sh
npx cuttlefish build --compile --upload --port COM7
```

## Prerequisites

The transpile step runs anywhere. Compile/flash require a Zephyr toolchain,
but **you do not need to activate the Python venv manually** — the framework
discovers `west` automatically (see [`demos/zephyr-blink`](../zephyr-blink)
for the full discovery order).

You will need:

1. A **Zephyr SDK** + toolchain (e.g. `~/zephyr-sdk-0.17.4`) with the
   **XTensa ESP32-S3** toolchain installed
   (`~/zephyr-sdk-0.17.4/xtensa-espressif_esp32s3_*`).
2. A **Zephyr workspace** with `west` installed in its `.venv`
   (e.g. `~/zephyrproject/{.venv, zephyr}`).
3. Optionally set **`ZEPHYR_BASE`** — if unset, the framework infers it from
   the workspace layout.
4. **esptool** available (it ships with the ESP32 toolchain / `pyserial` in the
   Zephyr venv) for `west flash`.
5. An **ESP32-S3 DevKitC** connected via USB (the USB-Serial-JTAG path provides
   both console and flash).

The toolchain scaffolds `CMakeLists.txt` and `prj.conf` automatically at
compile time (idempotent), then invokes
`west build -b esp32s3_devkitc/esp32s3/procpu` and `west flash`.

## How the GPIO bridge works

The framework lowers HAL `gpio.*` ops through Zephyr's GPIO driver. For most
pins it uses the **raw-controller path**:

- `D2` (GPIO2) → `gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 2, ...)`.
- A pin in the 32–48 range (e.g. GPIO38) → `DT_NODELABEL(gpio1)` — resolved by
  the descriptor's `gpioControllers` ranges, not hardcoded.

Pins with a DT alias (the BOOT button, `sw0` → GPIO0) take the
**devicetree-spec path**, which honors the node's polarity flags
(`GPIO_ACTIVE_LOW`) so logical values map correctly without polarity inversion
in the generated code.

## See also

- Chip descriptor: `packages/framework-zephyr/src/chips/esp32s3.ts`.
- The nRF52840 counterpart: [`demos/zephyr-blink`](../zephyr-blink).
- The Arduino/IDF ESP32-S3 demo: [`demos/rmt-demo`](../rmt-demo)
  (same `@typecad/board-esp32s3`, different framework).
