# AUTOSAR C++14 Compliance

Cuttlefish can emit C++ that satisfies a curated subset of the AUTOSAR C++14
coding-standard rule set, with auto-generated deviations for unavoidable
library/HAL violations. This document describes how to enable it, what it
covers, and how to read its output.

> **Design reference:** `docs/superpowers/specs/2026-07-26-autosar-compliance-design.md`
> covers the architecture, decision history, and the full Track 1/2/3
> classification of every rule.

## Enabling compliance

Compliance is **opt-in** and off by default — emitted code is byte-identical
to pre-feature output until you pass the flag.

```sh
cuttlefish build --autosar=strict     # abort emit on unrecorded required violations
cuttlefish build --autosar=warn       # emit diagnostics + sidecar, build still succeeds
cuttlefish build --autosar=off        # no enforcement (default)
cuttlefish build --autosar            # bare flag == strict
```

Add `--autosar-arxml` to also write the AUTOSAR-standard ARXML sidecar
(consumed by Artop, DaVinci, and similar tooling):

```sh
cuttlefish build --autosar=warn --autosar-arxml
```

## What the modes do

| Mode | Self-check findings | Sidecar written | Build result |
|---|---|---|---|
| `off` (default) | none | no | unchanged |
| `warn` | logged as warnings | yes (`.json`; `.arxml` if `--autosar-arxml`) | succeeds |
| `strict` | **required-severity findings become errors** | yes | aborts emit on any required unrecorded violation |

## The rule subset

The rule table lives in [`src/emit/compliance/rules.ts`](./src/emit/compliance/rules.ts)
as the source of truth — 50 rules, tagged **[C]** (enforce-by-construction)
or **[D]** (deviation-required). The spec's "Curated rule subset" section
has the full table with what each rule bans.

### Implementation status

A codebase-wide investigation during Phase 2 revealed the 39 [C] rules sort
into three implementation tracks (see the spec addendum "Implementation
scope revision"):

- **Track 1 — already compliant (14 rules).** The current emitter satisfies
  these; the self-check is a regression net.
- **Track 2 — cheap renderer gates (12 rules).** Single-chokepoint rules
  where the renderer picks a compliant spelling. All wired.
- **Track 3 — shim-scattered (5 rules).** All converted:
  - **M5-0-7 (C-style casts)** — fully converted across all packages
    (cuttlefish, framework-arduino/avr/esp32/native, UI runtime header).
    Zero C-style casts remain in any emitted C++.
  - **A3-9-1 (fixed-width integers)** — `defaultNumericType()` returns
    `int32_t` (or `int64_t` on native) under autosar; legacy `int` preserved
    when off.
  - **M5-3-2, A7-1-6, A15-0-2** — unavoidable violations (display color
    packing shifts, ESP32 callback typedefs, missing noexcept) are
    auto-recorded as deviations via the `knownPatterns` mechanism. The
    self-check records them in the sidecar instead of flagging them as
    unrecorded violations.
  - **A15-0-2 (noexcept)** is downgraded to advisory; real throw-analysis
    is a Phase 5 follow-up.

After Track 3, every emitted line is either compliant or carries a
documented deviation (via `knownPatterns` or inline comments), which is
what AUTOSAR assessors expect.

## Reading the output

### Inline deviation comments

Violation-prone lines gain a single canonical comment recognized by Helix
QAC, Coverity, and Axivion deviation parsers:

```cpp
Adafruit_ST7796S __tc_display(...);  // AUTOSAR Deviation M3-2-1: <justification>
```

Multi-rule deviations stack:

```cpp
foo();  // AUTOSAR Deviation M3-2-1, A18-5-8: Adafruit HAL global instance
```

### Sidecar registry (`<name>.autosar-deviations.json`)

Written next to the emitted artifact (mirrors how `.thcppmap.json` sits
next to the `.cpp`). Schema:

```json
{
  "schemaVersion": "1.0.0",
  "standard": "AUTOSAR C++14",
  "tool": "cuttlefish",
  "toolVersion": "<version>",
  "generatedAt": "<ISO 8601>",
  "emittedArtifact": "main.cpp",
  "ruleSubset": [ { "id": "M5-0-7", "category": "C" }, /* ... */ ],
  "summary": { "totalDeviations": 17, "byRule": { "M3-2-1": 4 } },
  "deviations": [
    {
      "ruleId": "M3-2-1",
      "line": 42,
      "endLine": 42,
      "snippet": "Adafruit_ST7796S __tc_display(...);",
      "justification": "Adafruit HAL requires a static-storage global instance.",
      "reviewStatus": "auto-generated",
      "source": {
        "tsFile": "src/hardware/display.ts",
        "tsLine": 12,
        "kind": "hal-instance"
      },
      "cpp": {
        "file": "main.cpp",
        "line": 42
      }
    }
  ]
}
```

The `source` field links each deviation back to the originating TypeScript
via cuttlefish's existing source-map data, making the registry actionable.
`reviewStatus` starts at `"auto-generated"`; a safety workflow promotes it
to `"accepted"` after human review (cuttlefish's scope ends at emitting
the artifact — the review workflow is the project's process).

### ARXML view (`<name>.autosar-deviations.arxml`)

Optional (gated behind `--autosar-arxml`). A projection of the same ledger
into AUTOSAR-standard XML — single source of truth, two renderings.

## Limitations (out of scope)

- **Whole-program rules** requiring cross-translation-unit analysis
  (M3-2-2 dependency-ordered static init, M0-1-1 value-tracking dead-code).
- **Runtime rules** whose semantics can't be evaluated from emitted text
  beyond M5-2-9.
- **External toolchain integration** beyond emitting the deviation
  artifacts. Cuttlefish emits; it does not certify.
- **Human review workflow** that promotes `reviewStatus` from
  `"auto-generated"` to `"accepted"` — that's the project's process.

## Verifying compliance changes

For any change to the compliance module, renderers, or display shims, run
the AGENTS.md-mandated verification set:

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/compliance
npx vitest run tests/packages/cuttlefish/runtime-header.test.ts
npm run compile --workspace demo-ui    # if display shims changed
```

The compliance suite is its own vitest subdirectory
(`tests/packages/cuttlefish/compliance/`) so it can be run in isolation
during development; it's part of the default `npm test`.
