---
'@typecad/board-esp32-devkit': patch
'@typecad/board-esp32s3': patch
'@typecad/board-xiao-nrf52840': patch
'@typecad/board-rp2040': patch
---

## Fully-qualified Zephyr board targets

The four board packages that still declared bare Zephyr ids now declare
the fully-qualified HWMv2 targets: `esp32_devkitc/esp32/procpu`,
`esp32s3_devkitc/esp32s3/procpu`, `xiao_ble/nrf52840`, and
`rpi_pico/rp2040` (the multi-core ESP32 bare ids are rejected outright
on Zephyr >=4.3; the others relied on bare-name normalization that
Zephyr has signaled is going away). This matches the five board packages
that were already qualified (esp32c3/c6, rp2350, blackpill,
nano_33_iot) — resolved chip ids now carry qualifiers uniformly, which
is the established convention (`esp32c3_devkitm/esp32c3` etc.) with no
`.id` equality consumers. Demos with explicit bare buildTargets
(`demos/demo`, `ble-demo`, `zephyr-blink`) updated to the qualified
form; framework-zephyr's `resolveBoardTarget` map stays as the compat
shim for older configs that still pass bare ids.
