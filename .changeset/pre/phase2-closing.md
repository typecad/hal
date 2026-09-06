---
'@typecad/hal': major
'@typecad/cuttlefish': major
'@typecad/framework-zephyr': minor
---

Phase 2 closing: legacy op surface and ADC/DAC singletons removed. The HAL's user-facing vocabulary is now thin-only.

- **ADC/DAC singleton classes deleted** (`hal/adc.ts` `ADCClass`/`ADC`, `hal/dac.ts` `DACClass`/`DAC`) — audited: no consumers outside the index barrel (the simulator binds its own analog-pin classes). Their legacy ops pruned end-to-end: `adc.read/read_voltage/get_resolution/set_reference/get_reference/dac.write` gone from KINDS, interfaces, resolver, usage analysis, Zephyr lowerings, and the framework-zephyr manifest. The thin surface (`ADCChannel` construction-gain ops, `DACChannel.write_value`) is the only ADC/DAC path.
- **Resulting legacy-op surface**: 43 (wire-dance/manual-CS/uart-print family) + 13 (timing/WDT/HardwareTimer + gpio.set_mode/interrupt.attach) + 6 (adc/dac) = **62 op kinds removed this phase**, on top of Family 1's class deletions. KINDS list, manifest matrices, usage analysis, and both frameworks' lowerings all pruned to match; validator fixtures updated.
- **Suites rewritten to surviving surface**: adc/dac hal-resolution tests now cover only thin verbs (read_mv descriptor-defaults regression kept; write_value lazy-setup per pin). Two empty legacy describes dropped.
- Full battery: 314 files / 3189+ tests green (isolated rerun for the two known worker-race files — see below).

**Deferred with reasons**: pin-state-tracking deletion — audit showed its folding triggers are NOT fully dead: thin `GPIO.set()` still fires notePinWrite, so removal requires rewiring route-hal-op's shadow-var read path AND control-flow snapshot logic in one careful pass (~1 day), not a mechanical cut. Recorded as the first Phase-2b item.

Known infra issue (pre-existing, now documented twice): full parallel vitest runs intermittently produce an empty transpile output file for 1–2 e2e files (cold `.build/tests` write race); every affected file passes standalone and on warm runs. Fix is per-file build dirs or sequential e2e config.
