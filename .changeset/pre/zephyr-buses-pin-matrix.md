---
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
'@typecad/hal': patch
---

`zephyr.buses` — config-specified bus pin assignments for the ESP32 pin
matrix (answers "esp32's have all common peripherals; they are defined by
specifying which pin does what"):

```ts
zephyr: {
  buses: {
    i2c0: { sda: 8, scl: 9 },
    spi0: { sck: 12, mosi: 11, miso: 13 },   // SPI0 = the SoC's GPSPI2
    uart1: { tx: 17, rx: 18 },
  },
}
```

- **Config surface**: `zephyr.buses` in typecad-hal.config.ts — keys are HAL
  bus selectors, values name the pads. Validated by the Zod schema
  (record of records of numbers) and parsed by
  `framework-zephyr/src/boardgen/bus-pins.ts` (unit-tested): I2C needs both
  sda+scl, SPI at least sck+mosi, UART both tx+rx; unknown keys and
  non-ESP32 SoCs warn and skip (fixed-pin silicon: pins come from the board
  devicetree — the honest limitation).
- **One source of truth**: each spec becomes a bus controller in the
  generated board module — the singleton export (`I2C0`), the
  `peripherals.i2c.count` capacity constant (the peripheral validator
  accepts the bus), and the `zephyr.i2c.controllers.N.pinctrl.*` constants
  the chip reconstruction reads. The C++ shims and the overlay both flow
  from those constants, so there is no second path to drift. A pin edit
  joins the board module's regeneration fingerprint.
- **Overlay synthesis**: the controller enable block emits a `&pinctrl`
  remux group using the SoC pinctrl headers' named macros
  (`I2C0_SDA_GPIO8`, `SPIM2_SCLK_GPIO12`), with the include chain the
  reference board dtsis use (`esp-pinctrl-common.h` + `<soc>-pinctrl.h` +
  `<soc>-gpio-sigmap.h` — without the sigmap header the macros expand to a
  bare identifier the DT grammar rejects). The group label is
  `<nodeLabel>_tc_remux` — the board's own `<label>_default` group may
  already exist, and redefining it is a DT error.
- **DT cell fix (found by the chain)**: synthesized `pinmux` values now emit
  as separate bracketed cells (`<A>, <B>` — the reference dtsis' form); a
  comma inside one bracket is a DT grammar parse error. Overlay include
  values may be comma-joined chains (one `#include` per header).
- **The esp32s3 rig gains the I2C suite**: the devkitC config remuxes i2c0
  onto GPIO8/9 (free pads), the `i2cBus` role returns to its test-pins, and
  `09-i2c` — previously skipping by capacity — transpiles AND west-compiles
  for the board (verified: the merged devicetree enables `i2c0` with
  `pinctrl-0 = <&i2c0_tc_remux>`, and the C++ shims address
  `DEVICE_DT_GET(DT_NODELABEL(i2c0))`). The verify script forwards the
  board config's `zephyr` section into its derived per-test config, and
  `tests/README.md` documents the section.
