---
'@typecad/framework-zephyr': patch
---

## Qualify all board targets on Zephyr ≥4.3

Audited every board package's Zephyr target against the v4.4.2 workspace
(all verified with `west build --cmake-only`): the multi-core ESP32s were
already qualified at build time by `resolveBoardTarget`, and every
board-package target configures cleanly. `xiao_ble` and `rpi_pico` still
relied on Zephyr's bare-name normalization (which works on 4.4 but is
slated for removal), so they now map to their qualified forms
(`xiao_ble/nrf52840`, `rpi_pico/rp2040`) in
`QUALIFIED_TARGETS_GE_4_3` alongside the ESP32s — the framework now
emits fully-qualified `-b` targets for every supported board on
Zephyr ≥4.3, while older Zephyr and unknown boards pass through
unchanged. The manifest's informational targets list is now fully
qualified as well.
