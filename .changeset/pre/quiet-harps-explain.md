---
'@typecad/cuttlefish': patch
---

Generated contract boards (`.typecad-hal/board.ts`) now list the gated HAL
classes the board's facts did NOT support (e.g. `Store`, `ADC`, `DAC`) in a
comment block naming exactly what was withheld and why imports of them
fail at module resolution. Previously the withholding was silent — users
discovered it via import failure and improvised shims without ever learning
a gate existed.
