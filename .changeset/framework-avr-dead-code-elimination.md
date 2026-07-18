---
"@typecad/framework-avr": minor
"@typecad/cuttlefish": minor
"@typecad/framework-arduino": patch
---

## framework-avr: gate native driver shims on actual peripheral usage

framework-avr previously emitted ~400 lines of uncalled native driver code
(UART, SPI, TWI/I2C, EEPROM, tone, millis Timer0 ISR, delay/map/constrain
helpers, and two unreferenced headers) for every AVR program — even a trivial
`led.toggle()`. For the demo this was 417 lines / 800 B flash; it is now
28 lines / 140 B flash and contains only what the program uses.

### Usage-gated shim emission

Mirrors framework-arduino's post-hoc filtering model: each native shim block
carries stable `CUTTLEFISH_*_BEGIN/END` markers, and the shared setup emitter
strips unused blocks based on `programAnalysis` flags. The AVR strategy also
self-gates on the same flags (defensive default: emit when no analysis is
available, preserving direct-strategy unit-test behavior).

New analysis flags in `program-analysis.ts` (`usesUart`, `usesSPI`, `usesI2C`,
`usesEEPROM`, `usesTone`, `usesMap`, `usesConstrain`, `usesNativeTiming`) detect
usage through structured HAL-op names, lowered callees, and raw-code references
— covering the HAL resolver's lowering paths that the pre-existing regex scans
missed. `usesNativeTiming` derives the comprehensive gate for the millis ISR
(direct calls + setInterval/setTimeout + async + UI tick).

### framework-arduino: on-demand `<avr/wdt.h>`

Also fixes a related leak in framework-arduino: `<avr/wdt.h>` was a forced
include for every AVR program. It is now added on demand by the setup emitter
when the program actually references `wdt_*` symbols (detected via `wdt.`
hal-ops), using the same post-hoc filter pattern.
