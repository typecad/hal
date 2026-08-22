# @typecad/framework-zephyr

TypeCAD framework package that lowers HAL operation IR to **native Zephyr RTOS
driver API calls**. Generates a real Zephyr application (`main` + `src/main.cpp`
+ `CMakeLists.txt` + `prj.conf`), compiled through Zephyr's `west` / CMake /
Ninja build system.

GPIO is lowered through devicetree specs (`gpio_pin_*_dt`) so an active-low
LED's polarity is honored by the DT flags, not by the generated code.

## Requirements

- Zephyr RTOS ≥ 3.x installed (the SDK + a west-enabled Python environment).
- The framework auto-discovers `west` without requiring you to activate the
  venv first. Discovery cascade (first usable wins):
  1. `west` already on `PATH` (env already activated / global install).
  2. `$ZEPHYR_BASE` sibling venv: `${ZEPHYR_BASE}/../.venv/<python> -m west`.
  3. Well-known workspace layouts (`~/zephyrproject/.venv`,
     `/opt/zephyrproject/.venv`, etc.).
  4. System pythons (`python`, `python3`, `py`) via `-m west`.

If none is found, the build errors with an actionable message pointing at the
fix (`pip install west`, set `ZEPHYR_BASE`, or activate the venv).

## How it works

- HAL ops (`gpio.write`, `i2c.begin`, etc.) lower to native Zephyr driver calls
  (`gpio_pin_set_dt`, `i2c_write`, etc.) — no Arduino API.
- The generated `src/main.cpp` defines `int main(void)` — the standard Zephyr
  C entry point. `main` runs the synthesizer-emitted `setup()` once, then loops
  `loop()` forever, yielding to the scheduler with `k_msleep(1)` each iteration
  (cheap cooperative yield — matches the `app_main` pattern in framework-esp32).
- The framework emits a complete Zephyr application: root `CMakeLists.txt`
  (`find_package(Zephyr)` + `file(GLOB src/*.cpp)`) and `prj.conf` (the Kconfig
  symbols for the lowered peripherals). Both are regenerated idempotently —
  only rewritten when their content changes, so Ninja's incremental build is
  preserved.
- Supported board targets: **Seeed Studio XIAO nRF52840** (`xiao_ble`),
  **ESP32 DevKit** (`esp32_devkitc`), **ESP32-S3 DevKit** (`esp32s3_devkitc`),
  **ESP32-C3 DevKitM** (`esp32c3_devkitm/esp32c3`), **ESP32-C6 DevKitC**
  (`esp32c6_devkitc/esp32c6/hpcore` — the qualified form is required, the
  board also ships an lpcore variant), **Raspberry Pi Pico** (`rpi_pico`),
  **Pico 2** (`rpi_pico2/rp2350a/m33`), and **WeAct Black Pill V2.0**
  (`blackpill_f411ce/stm32f411xe` — the first STM32 target; flashed over USB
  via the ROM DFU bootloader). The rpi_pico, esp32c3, esp32c6, and blackpill
  boards resolve their chip data from the board packages' `zephyr` field (see
  `resolveChipFromBoard`) rather than the hardcoded chip registry; the
  qualified Pico 2 target selects the Cortex-M33 cpucluster (Zephyr 4.3+
  rejects the bare `rpi_pico2` because the board also ships a Hazard3 variant
  with no default).

## Installation

```sh
cuttlefish init   # select "Zephyr RTOS" for an nRF52840-family target
```

Or in `cuttlefish.config.ts`:

```ts
export default {
  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'xiao_ble',
  },
  toolchain: { type: 'west' },
};
```

## HAL coverage

The manifest (`src/framework.manifest.ts`) is the honest, complete record of
what lowers. Fully supported: **gpio, pwm, adc, i2c, spi, uart, wdt, ble,
shift, board constants** (Board.definition.* / Pins.definition.* folding),
**random** (xorshift32 PRNG seeded from the Zephyr entropy tap).
Partial (some ops lower, some are deferred stubs): **timing, power,
interrupts, tone, pulse**. Unsupported for this target: **wifi** (nRF52840 has
no WiFi), **http** (no networking stack lowered), **display** (deferred),
**dac** (no DAC on nRF52840).

Run `npm test` (the manifest validator) to confirm the declared coverage matches
the actual lowering behavior.

## Hardware tests

On-device tests live in `tests/`. Run them against real hardware:

```sh
npm run test:hw          # all groups
npm run test:hw:gpio     # just GPIO
npm run test:hw:timers   # just timing
```

Update `test.port` in `cuttlefish.config.ts` to your XIAO's serial device
before running. The tests transpile → `west build` → flash → read results over
the console.

## Notes / limitations

- **Minimal C++ libc.** Zephyr's default C++ support (`lib/cpp/minimal`) has no
  `<vector>`, `<string>`, `<iostream>`, `<functional>`, exceptions, or RTTI.
  `prj.conf` enables `CONFIG_NEWLIB_LIBC` for `std::string`/`std::vector`; array
  literals still promote to the StaticArray wrapper, not `std::vector`.
- **Timer ops unsupported.** `timing.set_interval`/`set_timeout`/`clear_*` need
  a polyfill-backed async runtime this framework does not emit yet. A Zephyr
  workqueue / `k_thread` backing is a follow-on.
- **Debug mode.** `cuttlefish build --debug` routes through `printk` (always
  available, no `CONFIG_CONSOLE` dependency) rather than `std::cout`, since the
  minimal libc has no iostream. Breakpoints halt on console input (`ENTER`
  continues, `s` skips).
- **AUTOSAR compliance.** All emitted C++ uses `static_cast`/`reinterpret_cast`
  (no C-style casts) so the shim bytes pass `--autosar=strict`.
