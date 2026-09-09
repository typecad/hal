# @typecad/zephyr-esp32s3-rgb

The onboard WS2812 ("NeoPixel") RGB LED of the ESP32-S3 DevKitC, as a
typecad-hal library package for the **Zephyr RTOS** framework.

```sh
npm install @typecad/zephyr-esp32s3-rgb
```

```ts
import { rgbLed } from '@typecad/zephyr-esp32s3-rgb';

rgbLed.color(0, 255, 0).show();       // green
rgbLed.color('#ff0000').show();       // red, CSS-style hex
rgbLed.brightness(64).color('#ffffff').show();  // dim white
rgbLed.off();                          // black + show
```

`rgbLed` is a preconstructed singleton — import it and chain calls. Colors
buffer locally; nothing reaches the LED until `show()` (or `off()`).

## What the library carries (so you don't have to)

The native Zephyr path for this LED touches devicetree bindings, pinctrl,
DMA, and Kconfig before the first blink. This package moves that complexity
into itself, as three declarative artifacts (see `typecad-hal.library.json`):

| Artifact | File | What it does |
|---|---|---|
| C++ shim | `shims/__tc_rgbled.{h,cpp}` | `class RgbLed` over Zephyr's `led_strip_update_rgb()`; the import resolves to this header |
| Devicetree overlay | `shims/tc-rgb.overlay` | WS2812 node on GPIO48 through the I2S0 peripheral (`worldsemi,ws2812-i2s`, GRB color-mapping, DMA channel 3) |
| Kconfig | manifest `kconfig` | `CONFIG_LED_STRIP=y`, `CONFIG_I2S=y`, `CONFIG_DMA=y` |

When your program imports the package, the typecad-hal transpiler:

1. registers the import as a library (the package root carries a
   `typecad-hal.library.json`) and skips transpiling its TypeScript — the
   package's own types are the compile-time contract;
2. emits `#include "__tc_rgbled.h"` into your `main.cpp` and writes the shim
   files into the generated `src/` (CMake picks the `.cpp` up automatically);
3. appends the overlay fragment to the generated `boards/<board>.overlay`;
4. appends the Kconfig lines to the generated `prj.conf`.

The I2S backend is upstream Zephyr's own configuration for this board
(`samples/drivers/led/led_strip`), adapted verbatim — it borrows the I2S0
peripheral and DMA channel 3, which nothing else in a typecad-hal Zephyr
project uses. The alternative SPI backend would collide with `spi.*` HAL
usage; the ESP32-S3's dedicated RMT peripheral has no upstream Zephyr driver.

## Requirements

- **Framework:** `@typecad/framework-zephyr` (importing under another
  framework fails the transpile with a clear error).
- **Board target:** `esp32s3_devkitc`.
- **Hardware revision:** DevKitC **v1.0**, whose RGB LED is on **GPIO48**.
  v1.1 moved it to GPIO38 — on that revision change one line in
  `shims/tc-rgb.overlay` (`I2S0_O_SD_GPIO48` → `I2S0_O_SD_GPIO38`).
- **Validated on hardware:** 2026-08-21, ESP32-S3 DevKitC (GPIO48 revision),
  via demo-shadcn — boot color + tap-counter color cycling through the full
  chain (transpile → shim → overlay → Kconfig → west build → flash).

## Writing a sibling library

This package is the template: an npm package with a `typecad-hal.library.json`
manifest (`module`, `framework`, `targets`, `include`, `gateToken`, `shims`,
`kconfig`, `overlay`), a types-only TypeScript API, and the native artifacts.
The mechanism is per-library: another target or peripheral ships its own
manifest with the framework id and artifacts it needs.

## Shim compliance

The shim sources are AUTOSAR C++14 by construction (fixed-width integers,
`static_cast` only, no heap, `final` class) and keep passing
`--autosar=strict`.
