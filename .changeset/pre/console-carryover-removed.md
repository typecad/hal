---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
'@typecad/expect': patch
'@typecad/hal': patch
---

## The console.* carry-over is gone

`console.log` no longer lowers to a platform print, and the `console` section
of cuttlefish.config.ts (`baudRate`, `port`, `output`) is removed — including
the never-published `console.output: 'usb'` CDC routing (overlay composition,
kconfig USB forcing, and the SYS_INIT boot-with-DTR-wait). Programs write to
a serial console explicitly: `USB0.writeLine(...)` (USB CDC) or
`UART0.writeLine(...)` from the board module.

Configs that still carry a `console` section warn and drop it, so existing
projects keep building while told to delete the key. `console.*` calls in
program source — statement and value position — fail compilation with a
diagnostic that names the replacement instead of lowering to nothing.

Ships with a dead-API sweep across cuttlefish, framework-zephyr, and expect
(stale platform-strategy/toolchain-types surface, native and generic strategy
slimming, unused type-inference paths, the expect config's console
extraction).
