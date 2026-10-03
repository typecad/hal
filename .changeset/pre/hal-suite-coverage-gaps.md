---
'@typecad/cuttlefish': patch
'@typecad/hal': patch
---

HAL hardware-suite coverage expansion — closes the gaps found by auditing
all 82 HAL exports against the 31 suite files (round 3 follow-up):

- **New suites**: `common/23-thread` (start → shared-flag sequencing with a
  bounded poll, `join()` visibility, default-options construction),
  `common/24-trace` (Trace.mark/event callables — first suite coverage of
  the trace surface), `common/25-usb` (USB0 CDC console: write/writeLine,
  numeric write, read −1 / available 0 on the unopened port; excluded on
  esp32s3 where the CDC port IS the runner's protocol channel).
- **Extended suites**: `11-adc` gains `readMillivolts()` (vref-range bounds
  plus stability across an interleaved raw read — every prior test used
  `.read()` only); `14-preferences` gains getString/setString roundtrip,
  `remove()` true/false, and `clear()` in a fresh namespace (persistence
  across re-flashing can no longer leak state between groups).
- **New wired tier**: `02-uart-loopback` (TX→RX jumper; arms the receive
  ring, writes a unique marker, scans for it — byte-exact echo is
  impossible where the port is console-shared) and `03-interrupt-fire`
  (the edge path board/01-gpio only registers: a generated falling edge
  fires the handler; `offInterrupt()` stops further edges). Both follow
  the demo-style module-scope wiring the engine is known to lower.
- **Role plumbing**: `uartLoop` (wired UART) and `onewire` role consts
  added to the canonical PIN_ROLES map — the preprocessor now substitutes
  them when a board defines the role. blackpill defines `uartLoop`;
  esp32s3 documents each deliberate skip in its config header (led: no
  led0 node; usb/i2c: the protocol channel / no enabled i2c controller in
  the default devicetree — the peripheral validator rejects I2C0/I2C1 at
  capacity 0).
- **Suitable-for-purpose verification tooling**:
  `scripts/verify-hw-test.mjs` replicates the runner's exact pipeline
  (preprocess → test-pin substitution → derived config → transpile) so
  suite files can be gated in CI without a board attached; all new and
  existing common/board files pass it on both board configs, and
  23-thread west-compiles to an ELF for blackpill.
- **`tests/README.md`** now documents the suite layout and every
  deliberately-untested surface (Power: destructive; await-async: the DSL
  preprocessor cannot express it; DAC: no route facts on the rig boards;
  Scan/WiFiAP: no AP fixture; I2CResponder: needs a second controller;
  1-Wire Sensor: role absent until wired AND the Pin-form Sensor
  constructor does not lower — HAL_SENSOR_CTOR accepts only I2C devices,
  a newly surfaced engine gap).
