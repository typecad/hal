# zephyr-bench-console

A UART command shell over an ADC sampler and a breathing PWM LED, built with
`@typecad/hal` on Zephyr. Written to stress the transpiler's lowering of
idiomatic TypeScript: a class hierarchy dispatched through a base-typed
array, `Map<string, number>`, an enum, static class methods, bit twiddling,
string methods (`padStart`/`padEnd`/`charAt`/`charCodeAt`/`substring`/
`trim`/`startsWith`/`replace`/`toUpperCase`/`toLowerCase`/`repeat`),
number formatting (`toFixed`, `toString(16)`), module-level arrays, and
cooperative async tasks — with the module-level state declared *after* the
classes that use it (legal TS that pins declare-after-use lowering).

Builds clean under `--compile` and `--autosar=strict`.

## Commands

| command | effect |
| --- | --- |
| `help` | list commands |
| `stats` | ADC sample window statistics + level bar |
| `hex <n or 0x..>` | decimal/hex/binary cross-print |
| `echo <text>` | upper/lower/reverse/underscored transforms |
| `seq <n>` | squares 1..n with running sum/mean |
| `led <0..100, off, breath>` | onboard blue LED control |
| `hist` | command usage counters, most-used first |

## Build

```sh
npm run compile        # transpile + west build (ESP32 DevKitC)
npm run upload         # + flash + monitor
```

Console runs at the board's uart0 default (115200 8N1). GPIO2 is the
onboard LED; GPIO4 is the sampled analog input (adc1 ch0) — leave floating
for noise or tie to 3V3/ground for a stable reading.

## Transpiler notes (deliberate target-honest shapes)

Zephyr's runtime model is fixed-size: strings are bounded buffers, arrays
are fixed-capacity, and `String.fromCharCode` and the array
`filter/map/reduce/sort/join/split` family have no lowering. The demo uses
the documented replacements: a printable-ASCII lookup table for byte→char,
an explicit-space tokenizer loop, selection sort instead of
`sort(comparator)`, and element-wise console output instead of `join`.
Array parameters don't cross the lowering on fixed-array targets, so parsed
tokens flow through module-level arrays (`gTokens`/`gArgs`) — the natural
embedded shape.
