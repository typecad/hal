# `cuttlefish board add` — Board-Package Scaffolding Tool

**Date:** 2026-07-07
**Status:** Design — pending implementation
**Scope:** A new CLI subcommand that generates a complete board + MCU package pair from a human-authored `.jsonc` spec, eliminating the ~80% of per-board work that is pure template-filling.

## Motivation

Four boards (ESP32-S3, C3, C6, plus the existing Uno/classic ESP32) have now been
added by hand. Across those four, a clear pattern emerged: roughly 80% of the
work is mechanical — identical `package.json`/`tsconfig.json` scaffolding,
deterministic transforms of the pin list into Dx/Ax aliases and discovery
arrays, copy-pasted registry entries and tests. The remaining 20% is either
genuinely hard silicon data (pin capabilities, ADC maps, unsafe flags — the part
that requires datasheet verification) or per-chip framework judgement (which
ESP32-family checks need the new architecture added — the C3 needed almost
nothing, the C6 needed everything).

This tool automates the 80% and leaves the 20% to the human, with clear
guidance on exactly what remains.

## Goals

- Given a valid `.jsonc` chip spec, `cuttlefish board add <spec.jsonc>` produces
  a selectable board target (passes the KNOWN_BOARDS test) with **zero manual
  file editing** for everything except the framework-anticipation edits.
- The human authors only the silicon-data spec — the one input that genuinely
  requires datasheet knowledge. Everything else is generated.
- The spec format is **self-documenting**: a shipped `.jsonc` template carries
  rich `//` comments on every field explaining what it is, where to find the
  value, and what valid values look like. The template is the documentation.
- The tool is **safe**: validates input before writing, refuses to overwrite
  existing packages, type-checks its output, and prints an explicit checklist
  of the manual framework steps that remain.

## Non-Goals

- **No framework-anticipation automation.** The tool does not edit
  `ArchitectureIdentifier`, `freeHeap()`, `isrFunctionAttribute()`,
  `heap-analysis`, or `profile.ts`. These vary unpredictably per chip (the C6
  needed all of them; the C3 needed none) and require human judgement. The tool
  *prints* what needs editing and the exact line to add, but does not apply it.
- **No datasheet scraping.** The tool does not read `pins_arduino.h` or
  `soc_caps.h`. That coupling is fragile (file layout changes across core
  versions) and can't get capabilities/warnings anyway. The silicon data is a
  human-authored input, full stop.
- **No non-Arduino-framework support.** The generated packages target
  `@typecad/framework-arduino`. Bare-metal/native board generation is out of
  scope.
- **No board variants / vendor-specific boards.** Generates the "generic
  devboard" shape (no `led`, no `externalRam` unless specified). Named vendor
  boards (Adafruit Feather, Lolin, etc.) stay hand-authored for now.

## Architecture

### Input: the `.jsonc` chip spec

A single commented JSON file. Its schema mirrors `MCUDefinition` +
`BoardDefinition` but flattened for human authoring. The tool ships a
**template** at `packages/cuttlefish/src/create/board-template.jsonc` — heavily
commented, every field explained inline. The workflow:

```
1. cp packages/cuttlefish/src/create/board-template.jsonc ./esp32c6.jsonc
2. <fill in the blanks — comments guide every field>
3. cuttlefish board add ./esp32c6.jsonc
4. <tool prints "manual framework steps remaining" checklist>
5. <apply those framework edits by hand (~2 minutes)>
6. npm run build --workspaces && npx vitest run ...
```

The template is the canonical "how to add a board" reference — no separate wiki
page needed, because the comments *are* the docs. It versions with the schema:
if a field is added to `MCUDefinition`, the template gets a commented blank for
it in the same PR.

**Why `.jsonc` (not YAML or `.ts`):** JSON-with-comments is the lowest-friction
format that supports rich inline guidance. YAML needs a parser dependency (the
repo is JSON-only today) and has surprising edge cases (the "Norway problem");
`.ts` conflates input data with code. `.jsonc` needs only a 1-line comment-strip
before `JSON.parse`.

### What the tool generates

For `cuttlefish board add ./esp32c6.jsonc` (where the spec's `architecture` is
`esp32c6`):

| Output file | Generated from |
|---|---|
| `packages/mcu-esp32c6/package.json` | Template + arch name |
| `packages/mcu-esp32c6/tsconfig.json` | Static (references hal + cuttlefish) |
| `packages/mcu-esp32c6/src/index.ts` | Spec → `ESP32C6: MCUDefinition` + manifest |
| `packages/mcu-esp32c6/src/pins.ts` | Spec GPIO range → Pin constants + bus aliases |
| `packages/mcu-esp32c6/src/peripherals.ts` | Spec peripheral instances → consts + HAL instances |
| `packages/board-esp32c6/package.json` | Template + arch + MCU dep |
| `packages/board-esp32c6/tsconfig.json` | Static (references hal + cuttlefish + mcu) |
| `packages/board-esp32c6/src/index.ts` | Spec → `BoardDefinition` + discovery arrays |
| `packages/board-esp32c6/src/pins.ts` | Spec GPIO/ADC → Dx/Ax aliases |
| `packages/board-esp32c6/src/analog.ts` | Static (`DEFAULT=0`, `INTERNAL=3`) |
| `packages/board-esp32c6/src/board.ts` | Dx/Ax + bus instances → Board namespace |
| `package.json` (root) | Append 2 workspace entries (idempotent) |
| `packages/cuttlefish/src/create/init-scaffold.ts` | Append registry entry (idempotent) |
| `tests/packages/transpiler/init-scaffold.test.ts` | Append KNOWN_BOARDS test (idempotent) |
| `tests/packages/framework-arduino/esp32c6-profile.test.ts` | New profile test |
| `README.md` | Append board table row + available-boards list entry (idempotent) |

### What the tool does NOT touch (human applies)

- `packages/cuttlefish/src/api/board-types.ts` — `ArchitectureIdentifier` union
- `packages/hal/src/core/board-types.ts` — duplicate union
- `packages/framework-arduino/src/strategy.ts` — `freeHeap()`, `isrFunctionAttribute()`
- `packages/cuttlefish/src/ir/heap-analysis.ts` — heap-size gate
- `packages/framework-arduino/src/profile.ts` — PROFILE_VARIANTS, CAPABILITY_TABLE, FQBN_PIN_OVERRIDES

The command ends by printing a **"manual steps remaining" checklist** listing
each file, the exact line to find, and the exact snippet to add — e.g.:

```
Manual framework steps remaining (the tool cannot apply these safely):

1. packages/cuttlefish/src/api/board-types.ts
   Add `| 'esp32c6'` to the ArchitectureIdentifier union (after 'esp32c3').

2. packages/hal/src/core/board-types.ts
   Same addition (the union is duplicated).

3. packages/framework-arduino/src/strategy.ts:234 (freeHeap)
   Add `|| arch === 'esp32c6'` to the ESP32-family check.

... (one entry per framework file)
```

### Where it lives

New subcommand under `packages/cuttlefish/src/cli.ts` — `cuttlefish board add
<spec>`. The generation logic lives in a new module
`packages/cuttlefish/src/create/board-codegen.ts` (alongside the existing
`init-scaffold.ts` and `init-templates.ts`), reusing their template-helper
patterns where possible.

**Files added/modified by the tool's own implementation:**

| File | Purpose |
|---|---|
| `packages/cuttlefish/src/create/board-codegen.ts` (new) | The generator: read spec → validate → emit files → edit registry/tests/README → print checklist |
| `packages/cuttlefish/src/create/board-spec.ts` (new) | The zod schema for the `.jsonc` spec + the `BoardSpec` TS type |
| `packages/cuttlefish/src/create/board-template.jsonc` (new) | The heavily-commented fill-in-the-blanks template (the documentation) |
| `packages/cuttlefish/src/cli.ts` (modify) | Wire the `board add` subcommand |

### Validation + safety

1. **Strip comments** from the `.jsonc` (a small regex-based stripper, ~5 lines —
   handles `//` line comments and `/* */` blocks, respects strings).
2. **Validate** the parsed JSON against the zod schema in `board-spec.ts`. Fail
   fast with a clear error naming the offending field. No files written on
   validation failure.
3. **Refuse to overwrite** existing packages. If
   `packages/mcu-<arch>/` or `packages/board-<arch>/` already exists, error out
   with a message pointing to `--force` (which deletes + regenerates, for
   iteration during spec development).
4. **Idempotent appends** for the registry/workspace/test/README edits — re-running
   with the same spec is a no-op (detects the architecture id is already
   present and skips).
5. **Type-check output** — after writing, run `tsc --noEmit` on the two new
   packages. If it fails, report the errors and point at the spec fields likely
   responsible (e.g. "invalid capability flag name").

### Testing the tool itself

- **Snapshot/golden tests**: run `board add` on a fixture spec (the C6 spec,
  checked into `tests/fixtures/`) into a **temp directory** and assert the
  generated files match golden expected files (checked into
  `tests/fixtures/expected/esp32c6/`). The golden files are produced by running
  the tool once during initial development and reviewed by hand; subsequent runs
  diff against them. This catches codegen drift without coupling the test to the
  live `packages/` dir (which a human might legitimately edit). The live C6
  packages are *not* the golden output — they're a real package that may
  diverge; the fixture golden files are the controlled comparison.
- **Validation tests**: bad specs (missing required field, invalid capability
  name, bad FQBN format) → clear zod error, zero files written.
- **Idempotency tests**: running `board add` twice on the same spec → second
  run is a no-op, no duplicate registry entries.
- **Overwrite-protection tests**: pre-existing package dir → error unless
  `--force`.

## Risks & Open Points

- **The `.jsonc` spec is verbose** (~80 lines for a full chip). This is honest
  — it's the silicon data, and the only way to shorten it is to guess. The
  commented template mitigates the authoring burden substantially (fill-in-
  blanks vs. from-scratch), and the alternative (scraping) was rejected for
  fragility.
- **The golden-file snapshot tests may be brittle.** If the codegen produces
  formatting differences (trailing whitespace, quote style) vs. the hand-written
  packages, the snapshot will fail without a real regression. Mitigation: make
  the codegen match the hand-written style exactly, or normalize whitespace in
  the comparison.
- **The framework-anticipation checklist is the key UX.** Its correctness
  depends on the tool knowing *which* files need the architecture added. Since
  this varies per chip (C3 needed nothing, C6 needed everything), the checklist
  should be unconditional — always list all 5 framework spots with "check whether
  `<arch>` is already present; if not, add it." The human decides which apply.
- **The `touch` field.** The C6 has no usable touch peripheral; the spec must
  allow `touch: null` to omit `TOUCH_CAPABILITIES` entirely. The schema handles
  this (optional field), but the codegen must conditionally emit the touch
  peripheral block.
- **Scope creep risk.** This tool is deliberately limited to the "generic
  devboard, Arduino framework" shape. Resisting pressure to add vendor-board
  variants, display configs, or non-Arduino frameworks is important — those
  belong in a future, separate tool once the generic case is proven.
