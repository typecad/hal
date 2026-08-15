---
"@typecad/arduino-cli": patch
---

## Larger arduino-cli probe budgets on loaded machines

The environment probe spawns the real Go binary twice (`arduino-cli version`,
`arduino-cli core list`). Cold runs take ~4–5s, and on a saturated machine —
parallel builds, CI runners, antivirus scans — the previous 15s/30s budgets
could be exceeded, producing spurious "arduino-cli not installed" /
"core not installed" results. Budgets are now 30s for the version probe and
90s for `core list` (both once-per-process cached, so the generous budget
costs nothing in normal use).
