---
'@typecad/framework-zephyr': patch
---

Display on Zephyr — the M3 spike landed: the UI/display stack compiles and links on framework-zephyr, ending the display demos' Arduino-only status.

- **`demos/zephyr-display` (new)** — the Zephyr port of `demo-display`: the same `.ui` showcase entry (scroll viewports, image assets, theme) and the same hardware (ESP32-S3 + ST7796S + FT6336U), built through the framework-zephyr display path — the `st7796-zephyr` profile over `<zephyr/drivers/display.h>` and the strategy-owned FT6336U touch adapter — instead of the Adafruit ST7796S adapter over the Arduino core. **Transpiles and full west-builds clean** (only benign unused-static warnings from dead UI runtime code paths). This is the first UI-framework demo to compile on Zephyr — the rendering-guardrail canary set can now migrate.
- **`demos/zephyr-debug`** — verified to full west-build with its ST7796S + touch config (the existing minimal display-on-Zephyr demo, previously only transpiled).
- **Touch wiring fixed in both**: the overlay generator's diagnostic ("touch: I2C controller has no sda/scl pins … may never answer") was real — both configs now declare `sda: 8, scl: 9`, the shared demo rig's wiring per demo-st (NOT the esp32s3 board dts's `i2c0_default` of GPIO1/2). The diagnostic no longer fires.

Remaining (mechanical now): porting `demo-ui`, `demo-ui-sd13`, and `demo-shadcn` the same one-config way, and a hardware day to eyeball the showcase on the panel (scrolling guardrails were validated on Arduino SPI TFTs; the Zephyr display runtime needs the same visual pass).
