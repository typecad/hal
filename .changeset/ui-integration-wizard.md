---
"@typecad/ui": minor
---

## Display integration wizard (`npx @typecad/ui --config`)

Installing `@typecad/ui` used to leave a gap: integrating a display requires
choosing hardware (panel, bus, pins, speed, touch) and writing the
`display` section of `cuttlefish.config.ts` by hand. The package now ships a
`typecad-ui` bin, so the flow after `npm install @typecad/ui` is:

```bash
npx @typecad/ui --config
```

### What it does

- **Display selection** with hardware-aware defaults: the built-in profiles
  (`ili9341-spi`, `st7796-spi`, `ssd1309-i2c`), the desktop SDL simulator, or a
  fully custom driver (name, bus, resolution, color format).
- **Bus wiring questions** — SPI (CS/DC/RST/backlight, frequency in MHz,
  optional SCK/MOSI/MISO override) or I2C (address, optional reset pin),
  prefilled from any existing `display` section on re-runs.
- **Orientation + rendering** — rotation, antialiasing, and an advanced color
  branch (color order / inversion). ST7796S keeps the demos' proven `bgr` +
  non-inverted defaults.
- **Touch** — none, resistive (XPT2046 / STMPE610 / 4-wire analog), capacitive
  (FT6336U / GT911 / CST816S), or a custom adapter file, each with its pins,
  I2C address/speed, IRQ/reset, and calibration (raw-ADC defaults for
  resistive, native-panel pixel space for capacitive — matching the demos).
- **Theme hooks** — optional `themeCss` / `themeClass`.

### How it writes the config

The `display` section is spliced into `cuttlefish.config.ts` through the
TypeScript AST: only that section changes, every other section and its
comments survive byte-for-byte, unmanaged display keys (`scroll`,
`scanlineSync`, …) are carried over, and the edited file is syntax-checked
before anything is written. GPIO collisions between display and touch wiring
warn before the write. If the config's `entry` points at a missing `.ui`
file, the wizard offers a documented-syntax starter screen, then prints the
exact `arduino-cli lib install` (with the real Library Manager names —
`RAK14014-FT6336U` for FT6336U, the ST7735/ST7789 fork note for ST7796S),
preview, compile, and flash commands.

No config yet → the wizard points at `npx @typecad/cuttlefish init` first.
Non-interactive stdin → a clear error instead of a hang. `--help` / `--version`
included; unknown flags exit 2.

### Internals

New `src/wizard/` module (prompts, display/touch catalog, AST config writer,
starter template) exported as `@typecad/ui/wizard` for reuse and tests;
runtime deps added: `chalk` and `typescript` (both already present via the
cuttlefish peer). `tests/packages/ui/integration-wizard.test.ts` covers the
catalog, rendering, splice cases (insert / replace / CRLF / comma-and-comment
handling), pin-conflict detection, the starter template, and a round-trip
through cuttlefish's real `parseConfigFile` proving wizard output loads the
same way the build loads it.
