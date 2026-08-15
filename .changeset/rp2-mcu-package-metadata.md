---
"@typecad/mcu-rp2040": patch
"@typecad/mcu-rp2350": patch
---

## Ship source and full package metadata

`@typecad/mcu-rp2040` and `@typecad/mcu-rp2350` now include `src/` in the
published files (matching all sibling MCU and board packages, so consumers can
introspect silicon definitions the way the transpiler does) and carry the full
npm metadata the siblings have: `repository`, `homepage`, `bugs`, `keywords`,
and `engines`.
