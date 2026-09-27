# zephyr-scope

An ASCII oscilloscope built with `@typecad/hal` on Zephyr: a waveform
synthesizer drives the onboard LED over PWM (GPIO2), the ADC (GPIO4) captures
the (attenuated) input, and a UART console renders the capture as shaded
trace lines with rolling statistics. Written to stress transpiler surface the
earlier demos don't touch.

Builds clean under `--compile` and `--autosar=strict` (the remaining
`-Wformat-truncation` advisories are the bounded-string model truncating
safely — every accumulation buffer is capped by construction).

## Commands

| command | effect |
| --- | --- |
| `help` | list commands |
| `wave <sine\|square\|triangle\|noise>` | pick the synthesized waveform |
| `freq <hz>` | retune the waveform (≥ 0.5 Hz) |
| `amp <0..100>` | output amplitude |
| `stats` | window statistics + estimated input frequency |
| `trace` | render the captured window once |
| `sum <n> [n...]` | parse/reduce/print over the arguments |
| `hist` | command usage counters (Map for-of + `entry[1]`) |
| `hold` / `run` | pause / resume scope printing |

## Language surface exercised (the reason this demo exists)

- string compound assignment (`line += ch`, `out += RAMP[level]`) —
  concat-then-rebind over a static snprintf buffer
- `Map` for-of iteration with `entry[1]` element access
- static class state (`Waveform.nextId`) — C++14 out-of-class definition
- array-valued function parameters and returns (`argsFrom(start): string[]`)
- vector `.push` / `.includes` on module-level arrays
- switch dispatch on strings and on an enum, getters, `do/while`, `++`/`--`,
  compound assignment (`+= -= *= %=`), string indexing, charCode checksums
- class-method returns and string-array elements in template literals
  (format-specifier classification)

The round of transpiler fixes this demo drove lives in
`tests/packages/cuttlefish/scope-demo-port-gaps.test.ts` (silent
StaticArray capacity truncation, string `+=`, vector receivers on the
StaticArray target, Map-entry pair access, `static inline` under C++14, and
four snprintf classifier gaps).

## Build

```sh
npm run compile        # transpile + west build (ESP32 DevKitC)
```

Wire the LED output (GPIO2) to the ADC input (GPIO4) through a resistor
divider to see the synthesized waveform captured live.
