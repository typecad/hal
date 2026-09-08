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

- HAL ops (`gpio.write`, `i2c.reg_read`, etc.) lower to native Zephyr driver
  calls (`gpio_pin_set_dt`, `i2c_reg_read_byte`, etc.) — no Arduino API.
- The generated `src/main.cpp` defines `int main(void)` — the standard Zephyr
  C entry point. Top-level statements lower straight into `main()` (no
  `setup()`/`loop()` pair); event-driven programs get their scheduler loop
  appended inside `main()` by the driver machinery.
- The framework emits a complete Zephyr application: root `CMakeLists.txt`
  (`find_package(Zephyr)` + `file(GLOB src/*.cpp)`) and `prj.conf` (the Kconfig
  symbols for the lowered peripherals). Both are regenerated idempotently —
  only rewritten when their content changes, so Ninja's incremental build is
  preserved.
- Board targets are not curated: **every board variant in the generated board
  catalog** resolves the same way (`resolveChipFromBoard` over the catalog's
  board data — there is no hardcoded chip registry or target list). The
  catalog is machine-local, generated from your Zephyr tree by
  `typecad-hal board sync` (and refreshed automatically by builds).

## Installation

```sh
	ypecad-hal create   # pick a board from the catalog; the Zephyr framework is the default
```

Or in `typecad-hal.config.ts`:

```ts
export default {
  entry: './src/main.ts',
  board: 'xiao_ble/nrf52840',
  framework: '@typecad/framework-zephyr',
};
```

## HAL coverage

The manifest (`src/framework.manifest.ts`) is the honest, complete record of
what lowers. Fully lowered: **gpio, pwm, adc, dac** (pin-fact-gated),
**i2c, spi, uart, interrupts, timing, wdt, counter, thread, shift, board
constants**, **random** (xorshift32 PRNG seeded from the Zephyr entropy tap),
**preferences (Store)**, **fs (File)**, **sensor**, **ble**, **snprintf**, and
**wifi/http/mqtt** (ESP32-class radio targets only — nRF52840 has no WiFi).
**Display** lowers via the generic `<zephyr/drivers/display.h>` GFX runtime.
Declared unsupported on this target: **i2s, twai/CAN, ethernet, espnow,
hardware crypto, pcnt, mcpwm**. USB CDC is board-gated: it lowers only on
boards whose DTS enables the USB device controller.

Run `npm test` (the manifest validator) to confirm the declared coverage matches
the actual lowering behavior.

## Notes / limitations

- **Minimal C++ libc.** Zephyr's default C++ support (`lib/cpp/minimal`) has no
  `<vector>`, `<string>`, `<iostream>`, `<functional>`, exceptions, or RTTI.
  `prj.conf` enables `CONFIG_NEWLIB_LIBC` for `std::string`/`std::vector`; array
  literals still promote to the StaticArray wrapper, not `std::vector`.
- **Debug mode.** `typecad-hal build --debug` routes through `printk` (always
  available, no `CONFIG_CONSOLE` dependency) rather than `std::cout`, since the
  minimal libc has no iostream. Breakpoints halt on console input (`ENTER`
  continues, `s` skips).
- **AUTOSAR compliance.** All emitted C++ uses `static_cast`/`reinterpret_cast`
  (no C-style casts) so the shim bytes pass `--autosar=strict`.
