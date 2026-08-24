---
'@typecad/board-esp32c3': minor
'@typecad/board-esp32c6': minor
'@typecad/cuttlefish': minor
---

## Zephyr support for the ESP32-C3 and ESP32-C6

Both board packages now ship `zephyr` chip data and build targets — the
first RISC-V Zephyr targets:

- `esp32c3_devkitm/esp32c3` — single GPIO controller, `sw0` BOOT button on
  GPIO9, i2c0/spi2/usart1, WiFi.
- `esp32c6_devkitc/esp32c6/hpcore` — the qualified form is required (the
  board also ships an lpcore variant and Zephyr 4.3+ rejects the bare id),
  same controller shape, WiFi + 802.15.4.

The catalog offers `zephyr` for both architectures and the scaffold writes
the qualified board ids. Verified against Zephyr 4.3 board devicetrees.
