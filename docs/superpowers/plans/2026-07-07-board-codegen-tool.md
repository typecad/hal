# `cuttlefish board add` — Board-Package Scaffolding Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CLI subcommand (`cuttlefish board add <spec.jsonc>`) that generates a complete board + MCU package pair from a human-authored `.jsonc` spec — automating the ~80% of per-board work that is pure template-filling.

**Architecture:** A new `board-codegen` module in `packages/cuttlefish/src/create/` with pure string-returning generator functions (mirroring the existing `init-templates.ts` pattern) + an orchestrator that writes files, edits the registry/tests/README, and prints a framework-anticipation checklist. The input is a heavily-commented `.jsonc` template that ships in-repo as the documentation. The tool validates with zod, refuses to overwrite, and stops short of the per-chip framework edits (those need human judgement).

**Tech Stack:** TypeScript, zod (already a dependency), the existing `parseCommandLine` CLI dispatcher, the existing `init-templates.ts` pure-generator pattern.

**Spec:** `docs/superpowers/specs/2026-07-07-board-codegen-tool-design.md`

**Golden reference:** The hand-written `packages/mcu-esp32c6/` and `packages/board-esp32c6/` packages are the golden output. The generators must reproduce them from a C6 spec. Read those files alongside this plan.

---

## File Structure

### New files (the tool itself)

| File | Responsibility |
|---|---|
| `packages/cuttlefish/src/create/board-spec.ts` | Zod schema for the `.jsonc` spec + `BoardSpec` TS type + comment-stripping util |
| `packages/cuttlefish/src/create/board-template.jsonc` | The heavily-commented fill-in-the-blanks input template (the docs) |
| `packages/cuttlefish/src/create/board-generators.ts` | Pure string-returning generators (one per output file) |
| `packages/cuttlefish/src/create/board-codegen.ts` | The orchestrator: validate spec → call generators → write files → edit registry/tests/README → print checklist |
| `packages/cuttlefish/src/create/board-checklist.ts` | The framework-anticipation checklist text generator |
| `tests/packages/cuttlefish/board-codegen.test.ts` | Snapshot + validation + idempotency tests |
| `tests/fixtures/esp32c6-spec.jsonc` | The C6 spec fixture (golden input for snapshot tests) |

### Modified files

| File | Change |
|---|---|
| `packages/cuttlefish/src/utils/cli.ts` | Add `board` token to `parseCommandLine` (dispatch on `argv[2] === 'board'`, check `argv[3] === 'add'`) |
| `packages/cuttlefish/src/cli.ts` | Add `handleBoardAdd` handler + dispatch branch |
| `packages/cuttlefish/src/testing.ts` | Export the new generators for test consumption |
| `packages/cuttlefish/src/create/index.ts` | Re-export from `board-codegen.ts` |

---

## Task 1: The spec schema + comment stripper

**Files:**
- Create: `packages/cuttlefish/src/create/board-spec.ts`

This is the foundation — everything depends on it. It defines the zod schema for the `.jsonc` spec and the comment-stripping utility.

- [ ] **Step 1: Write `packages/cuttlefish/src/create/board-spec.ts`**

The schema mirrors `MCUDefinition` + `BoardDefinition` but flattened for human authoring. Use the `safeValidateConfig` pattern from `config-schema.ts` for error surfacing.

```ts
// ---------------------------------------------------------------------------
// board-spec.ts — Zod schema + types for the .jsonc chip spec consumed by
// `cuttlefish board add`. The spec is a human-authored description of the
// silicon + board; the codegen transforms it into package source files.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Comment stripper — .jsonc → JSON. Strips // line comments and /* */ blocks
// while respecting string literals (a // inside a string is not a comment).
// ---------------------------------------------------------------------------

export function stripJsonc(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    // String literal — copy verbatim until closing quote
    if (ch === '"') {
      result += ch;
      i++;
      while (i < text.length) {
        result += text[i];
        if (text[i] === '\\' && i + 1 < text.length) {
          result += text[i + 1];
          i += 2;
          continue;
        }
        if (text[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    // Line comment // ... \n
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    // Block comment /* ... */
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const PinFunctionSchema = z.object({
  type: z.enum(['i2c', 'spi', 'uart', 'adc', 'dac', 'pwm', 'touch', 'usb']),
  instance: z.number().int(),
  role: z.string(),
}).strict();

const PinSpecSchema = z.object({
  gpio: z.number().int(),
  capabilities: z.enum([
    'FULL_GPIO', 'FULL_GPIO_ANALOG', 'FULL_GPIO_TOUCH',
    'FULL_GPIO_ANALOG_TOUCH', 'FULL_GPIO_DAC', 'INPUT_ONLY',
  ]),
  functions: z.array(PinFunctionSchema).optional(),
  alt: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  unsafe: z.boolean().optional(),
  notes: z.string().optional(),
  onboardLed: z.boolean().optional(),
}).strict();

const PeripheralInstanceSchema = z.object({
  instance: z.number().int(),
  defaultPins: z.record(z.string(), z.string()),
  alternatePins: z.record(z.string(), z.array(z.string())).optional(),
}).strict();

const AdcSchema = z.object({
  instance: z.number().int(),
  channels: z.number().int(),
  resolution: z.number().int(),
  referenceVoltage: z.number(),
  maxValue: z.number().int(),
  referenceVoltages: z.record(z.string(), z.number()).optional(),
}).strict();

const BusPinMapSchema = z.record(z.string(), z.object({
  sda: z.string().optional(),
  scl: z.string().optional(),
  mosi: z.string().optional(),
  miso: z.string().optional(),
  sck: z.string().optional(),
  cs: z.string().optional(),
  tx: z.string().optional(),
  rx: z.string().optional(),
}).strict());

// ---------------------------------------------------------------------------
// Top-level spec schema
// ---------------------------------------------------------------------------

export const BoardSpecSchema = z.object({
  // Identity
  architecture: z.string().min(1),
  mcuId: z.string().min(1),
  mcuName: z.string().min(1),
  boardId: z.string().min(1),
  boardName: z.string().min(1),
  vendor: z.string().min(1),
  description: z.string().optional(),

  // Build
  clockSpeed: z.number().int(),
  fqbn: z.string().min(1),
  platformioTarget: z.string().min(1),
  arduinoDefine: z.string().min(1),

  // Memory (module-level; silicon memory is derived)
  moduleFlash: z.number().int().nullable(),
  externalRam: z.number().int().nullable(),

  // GPIO range
  gpioRange: z.tuple([z.number().int(), z.number().int()]),
  excludedGpio: z.array(z.number().int()),

  // Pin data
  pins: z.array(PinSpecSchema),
  unsafe: z.array(z.string()),
  analog: z.array(z.string()),

  // Bus maps
  i2c: BusPinMapSchema,
  spi: BusPinMapSchema,
  uart: BusPinMapSchema,

  // Peripherals
  peripheralInstances: z.object({
    i2c: z.array(PeripheralInstanceSchema),
    spi: z.array(PeripheralInstanceSchema),
    uart: z.array(PeripheralInstanceSchema),
  }).strict(),
  adc: z.array(AdcSchema),
  pwm: z.object({
    channels: z.number().int(),
    resolution: z.number().int(),
    maxFrequency: z.number().int(),
  }).strict(),
  touch: z.object({
    channels: z.number().int(),
    pins: z.array(z.string()),
  }).nullable().optional(),
  timers: z.array(z.object({
    instance: z.number().int(),
    type: z.enum(['general', 'high_speed', 'rtc', 'sys']),
    bits: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
    features: z.array(z.enum(['pwm', 'capture', 'compare', 'interrupt', 'dma'])).optional(),
  }).strict()),

  // Connectivity
  wifi: z.object({
    type: z.enum(['wifi', 'wifi6']),
    supportsStation: z.boolean(),
    supportsAp: z.boolean(),
  }).strict(),
  bluetooth: z.object({
    type: z.enum(['classic', 'ble', 'dual']),
    version: z.string(),
  }).strict(),
  usb: z.object({
    type: z.enum(['device', 'host', 'otg']),
    vid: z.string(),
    pid: z.string(),
  }).strict(),

  // Features
  features: z.object({
    multicore: z.boolean(),
    coreCount: z.number().int(),
    deepSleep: z.boolean(),
    watchdog: z.boolean(),
    externalInterrupts: z.boolean(),
    hardwareRng: z.boolean(),
    fpu: z.boolean(),
  }).strict(),

  // Silicon memory
  memory: z.object({
    flash: z.number().int(),
    sram: z.number().int(),
    eeprom: z.number().int(),
    externalRam: z.number().int().optional(),
    rtcMemory: z.number().int().optional(),
  }).strict(),
}).strict();

export type BoardSpec = z.infer<typeof BoardSpecSchema>;

// ---------------------------------------------------------------------------
// Parse + validate a .jsonc string
// ---------------------------------------------------------------------------

export function parseBoardSpec(jsoncText: string): BoardSpec {
  const jsonText = stripJsonc(jsoncText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Invalid JSON in spec file: ${(e as Error).message}`);
  }
  return BoardSpecSchema.parse(parsed);
}

export function safeParseBoardSpec(jsoncText: string):
  | { success: true; spec: BoardSpec }
  | { success: false; errors: string[] } {
  try {
    const spec = parseBoardSpec(jsoncText);
    return { success: true, spec };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const errors = e.issues.map(issue => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      return { success: false, errors };
    }
    return { success: false, errors: [(e as Error).message] };
  }
}
```

- [ ] **Step 2: Build cuttlefish to verify the schema typechecks**

Run: `npm run build --workspace @typecad/cuttlefish`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/create/board-spec.ts
git commit -m "feat(cuttlefish): add BoardSpec zod schema + .jsonc comment stripper"
```

---

## Task 2: The `.jsonc` template

**Files:**
- Create: `packages/cuttlefish/src/create/board-template.jsonc`

This is the documentation + starting point for users. Every field has a `//` comment explaining what it is, where to find the value, and valid values. The template uses the ESP32-C6 as the worked example (so a user can see a fully-filled version).

- [ ] **Step 1: Write `packages/cuttlefish/src/create/board-template.jsonc`**

Write the full template with the C6's values as the worked example, with rich comments on every field. The comments must explain:
- **architecture**: lowercase id (e.g. `esp32c6`); used as the package name suffix and the registry `id`. Match the Arduino core's board-id segment.
- **fqbn**: `vendor:platform:board`. For the ESP32 family this is always `esp32:esp32:<chip>` (the core collapses the family into one platform). Verify via `arduino-cli board listall | grep <chip>`.
- **gpioRange**: `[first, last]` inclusive. Exclude pins consumed by internal flash (check the datasheet — e.g. the C3 omits GPIO 11).
- **pins[].capabilities**: one of `FULL_GPIO`, `FULL_GPIO_ANALOG`, `FULL_GPIO_ANALOG_TOUCH`, etc. See the capability-flag helpers in any existing `mcu-*/src/index.ts`.
- **touch**: `null` if the chip has no usable touch (e.g. ESP32-C6). Otherwise `{ channels, pins }`.
- **unsafe**: strapping pins, USB pins, flash pins. Users of these get a pin-safety warning.
- Where to verify pin data: the Arduino-ESP32 core's `variants/<chip>/pins_arduino.h` carries the bus defaults (SDA/SCL/MOSI/MISO/SCK/SS/TX/RX) and ADC aliases (A0..An). The datasheet carries capabilities/strapping/warnings.

The full template content is the C6 spec values with comments. Use the C6 data from `packages/mcu-esp32c6/src/index.ts` as the values. (The implementer should read that file to get the exact pin array and peripheral values.)

- [ ] **Step 2: Verify the template parses** by running the stripper + schema on it (this doubles as the first integration test — write a quick inline check):

```bash
node -e "
const { stripJsonc } = require('./packages/cuttlefish/dist/create/board-spec.js');
const fs = require('fs');
const text = fs.readFileSync('packages/cuttlefish/src/create/board-template.jsonc', 'utf8');
JSON.parse(stripJsonc(text));  // throws if stripping is broken
console.log('template parses OK');
"
```

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/create/board-template.jsonc
git commit -m "feat(cuttlefish): add commented .jsonc board template (the docs)"
```

---

## Task 3: The C6 spec fixture

**Files:**
- Create: `tests/fixtures/esp32c6-spec.jsonc`

This is the golden input for the snapshot tests. It's the C6's data in the spec format — the same data that's encoded in `packages/mcu-esp32c6/src/index.ts`.

- [ ] **Step 1: Write `tests/fixtures/esp32c6-spec.jsonc`**

Extract the C6's data from the existing `packages/mcu-esp32c6/src/` files into the spec format. This is a mechanical transcription — read the C6's `index.ts` (pin capabilities, ADC, features, memory), `peripherals.ts` (instance arrays, wifi/ble/usb), and `pins.ts` (bus aliases), and write them as the JSON spec. **No comments needed** in the fixture (it's test data, not documentation).

- [ ] **Step 2: Verify it passes the schema**

```bash
node -e "
const { parseBoardSpec } = require('./packages/cuttlefish/dist/create/board-spec.js');
const fs = require('fs');
parseBoardSpec(fs.readFileSync('tests/fixtures/esp32c6-spec.jsonc', 'utf8'));
console.log('fixture validates OK');
"
```

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/esp32c6-spec.jsonc
git commit -m "test: add C6 spec fixture for board-codegen snapshot tests"
```

---

## Task 4: The MCU package generators

**Files:**
- Create: `packages/cuttlefish/src/create/board-generators.ts` (MCU generators only — board generators added in Task 5)

These are pure string-returning functions, mirroring `init-templates.ts`. Each takes the `BoardSpec` and returns the file content as a string.

**Golden reference:** `packages/mcu-esp32c6/src/{index.ts, pins.ts, peripherals.ts}` + `packages/mcu-esp32c6/{package.json, tsconfig.json}`. The generators must reproduce these from the C6 spec fixture. Read those files as the template.

- [ ] **Step 1: Write the MCU generators in `board-generators.ts`**

Implement these functions (all `(spec: BoardSpec) => string`):

1. `genMcuPackageJson(spec)` — name `@typecad/mcu-${spec.architecture}`, deps cuttlefish + hal. Reference: `mcu-esp32c6/package.json`.
2. `genMcuTsconfig(spec)` — static (references hal + cuttlefish). Reference: `mcu-esp32c6/tsconfig.json` — it's identical for every MCU package.
3. `genMcuPins(spec)` — `GPIO${n}` Pin constants for every GPIO in `gpioRange` (minus `excludedGpio`), + bus aliases (SDA/SCL/MOSI/MISO/SCK/SS/TX/RX) derived from `spec.i2c/spi/uart`. Reference: `mcu-esp32c6/src/pins.ts`.
4. `genMcuPeripherals(spec)` — standalone peripheral consts + `MCU_PERIPHERALS` aggregate + HAL instances. Drive from `spec.peripheralInstances`, `spec.adc`, `spec.pwm`, `spec.touch` (conditionally emit `TOUCH_CAPABILITIES` only if `spec.touch` is non-null), `spec.timers`, `spec.wifi`, `spec.bluetooth`, `spec.usb`. Reference: `mcu-esp32c6/src/peripherals.ts`.
5. `genMcuIndex(spec)` — the `MCUDefinition` const + manifest + re-exports. Drive the `pins.all[]` array from `spec.pins`, the capability flags from `spec.pins[].capabilities`, the functions from `spec.pins[].functions`, etc. The capability-flag helpers (`FULL_GPIO`, etc.) should be emitted at the top of the file (copy the pattern from `mcu-esp32c6/src/index.ts`). The `TypeCADManifest.pinNames` is derived from the GPIO range; `peripheralNames` from the HAL instance destructuring. Reference: `mcu-esp32c6/src/index.ts`.

**Substitution map** (the string replacements that turn the C6 reference into a generic generator):
- `esp32c6` / `esp32-c6` / `ESP32C6` / `ESP32-C6` → `spec.architecture` / `spec.mcuId` / uppercase variants
- The pin array → `spec.pins.map(...)` 
- The peripheral arrays → `spec.peripheralInstances.*`, `spec.adc`, etc.
- The memory block → `spec.memory`
- The features block → `spec.features`

Use template literals with `${}` interpolation, exactly like `init-templates.ts` does.

- [ ] **Step 2: Build cuttlefish**

Run: `npm run build --workspace @typecad/cuttlefish`
Expected: clean build (the generators are pure functions returning strings; they should typecheck against `BoardSpec`).

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/create/board-generators.ts
git commit -m "feat(cuttlefish): add MCU package generators (board-codegen)"
```

---

## Task 5: The board package generators + config-file generators

**Files:**
- Modify: `packages/cuttlefish/src/create/board-generators.ts` (add board generators)

- [ ] **Step 1: Add the board generators to `board-generators.ts`**

Implement these functions (all `(spec: BoardSpec) => string`):

1. `genBoardPackageJson(spec)` — name `@typecad/board-${spec.architecture}`, deps cuttlefish + hal + `@typecad/mcu-${spec.architecture}`, + `publishConfig`. Reference: `board-esp32c6/package.json`.
2. `genBoardTsconfig(spec)` — static + references hal/cuttlefish/mcu. Reference: `board-esp32c6/tsconfig.json`.
3. `genBoardAnalog(spec)` — static (`DEFAULT = 0`, `INTERNAL = 3`). Identical for every board.
4. `genBoardPins(spec)` — `D${n}` aliases for GPIO in range (excluding unsafe flash pins if desired — match the C6's convention of omitting GPIO28-30 from Dx), `A${n}` aliases from `spec.analog` (ADC1 pins only), bus re-exports from MCU. Reference: `board-esp32c6/src/pins.ts`.
5. `genBoardIndex(spec)` — the `BoardDefinition` const + HAL re-exports + `pins` discovery arrays + `PeripheralPins` map + barrel re-exports. Drive FQBN from `spec.fqbn`, defines from `spec.arduinoDefine`/`spec.clockSpeed`, memory from `spec.moduleFlash`/`spec.externalRam`. Reference: `board-esp32c6/src/index.ts`.
6. `genBoardNamespace(spec)` — the `Board` object aggregating Dx/Ax + bus instances. Reference: `board-esp32c6/src/board.ts`.

- [ ] **Step 2: Build cuttlefish**

Run: `npm run build --workspace @typecad/cuttlefish`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/create/board-generators.ts
git commit -m "feat(cuttlefish): add board package generators (board-codegen)"
```

---

## Task 6: The framework-anticipation checklist generator

**Files:**
- Create: `packages/cuttlefish/src/create/board-checklist.ts`

This generates the "manual steps remaining" text the tool prints after generating files. It's unconditional — always lists all 5 framework spots with "check whether `<arch>` is already present; if not, add it."

- [ ] **Step 1: Write `packages/cuttlefish/src/create/board-checklist.ts`**

```ts
// ---------------------------------------------------------------------------
// board-checklist.ts — Generates the "manual framework steps remaining"
// checklist printed after `cuttlefish board add`. The tool does not apply
// these edits (they require per-chip judgement), but it tells the user exactly
// what to do.
// ---------------------------------------------------------------------------

import type { BoardSpec } from './board-spec.js';

export function generateFrameworkChecklist(spec: BoardSpec): string {
  const arch = spec.architecture;
  const lines: string[] = [
    '',
    '━━━ Manual framework steps remaining ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    'The tool cannot safely apply these (they vary per chip). Check whether',
    `'${arch}' is already present in each file; if not, add it:`,
    '',
    `1. packages/cuttlefish/src/api/board-types.ts`,
    `   Add \`| '${arch}'\` to the ArchitectureIdentifier union.`,
    '',
    `2. packages/hal/src/core/board-types.ts`,
    `   Same addition (the union is duplicated in both packages).`,
    '',
    `3. packages/framework-arduino/src/strategy.ts — freeHeap() (~line 234)`,
    `   Add \`|| arch === '${arch}'\` to the ESP32-family check.`,
    '',
    `4. packages/framework-arduino/src/strategy.ts — isrFunctionAttribute() (~line 1004)`,
    `   Add \`|| arch === '${arch}'\` to the same check.`,
    '',
    `5. packages/cuttlefish/src/ir/heap-analysis.ts (~line 74)`,
    `   Add \`|| arch === '${arch}'\` to the architecture gate.`,
    '',
    `6. packages/framework-arduino/src/profile.ts — PROFILE_VARIANTS`,
    `   Add \`{ architecture: "${arch}", forcedIncludes: ["<Arduino.h>"] }\`.`,
    `   Also add a CAPABILITY_TABLE row (mirror esp32; fallbackPins.A0 = ${getA0Fallback(spec)}).`,
    `   Also add an FQBN_PIN_OVERRIDES entry: \`{ fqbnIncludes: "${spec.fqbn.split(':').slice(0, 2).join(':')}:", pins: { A0: ${getA0Fallback(spec)} } }\`.`,
    '',
    'Then rebuild and test:',
    '  npm run build --workspaces',
    '  npx vitest run tests/packages/transpiler/init-scaffold.test.ts',
    '  npx vitest run tests/packages/framework-arduino/',
    '',
  ];
  return lines.join('\n');
}

function getA0Fallback(spec: BoardSpec): number {
  // A0 maps to the first ADC1 pin. The analog array lists ADC1 pins in order;
  // A0 = the GPIO number of the first entry. Parse "GPIOn" → n.
  const firstAnalog = spec.analog[0];
  const match = firstAnalog.match(/GPIO(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build --workspace @typecad/cuttlefish
git add packages/cuttlefish/src/create/board-checklist.ts
git commit -m "feat(cuttlefish): add framework-anticipation checklist generator"
```

---

## Task 7: The orchestrator

**Files:**
- Create: `packages/cuttlefish/src/create/board-codegen.ts`

This is the `scaffoldBoardPackages(spec, opts)` function — the main entry point. It validates the spec, calls all generators, writes the files, edits the registry/tests/README (idempotently), and returns the list of created files. It does NOT apply the framework edits (those are printed as a checklist).

**Pattern reference:** `init-scaffold.ts`'s `scaffoldProject` — uses a local `writeFile` closure + `fs.writeFileSync` + tracks `createdFiles`.

- [ ] **Step 1: Write `packages/cuttlefish/src/create/board-codegen.ts`**

Implement `scaffoldBoardPackages(spec: BoardSpec, opts: { force?: boolean; rootDir?: string }): { createdFiles: string[]; checklist: string }`.

The function:
1. Derives paths: `rootDir` defaults to the monorepo root (walk up from CWD to find `package.json` with `"workspaces"`). MCU dir = `${rootDir}/packages/mcu-${spec.architecture}`, board dir = `${rootDir}/packages/board-${spec.architecture}`.
2. Checks for existing packages — if they exist and `!opts.force`, throw a clear error.
3. If `opts.force`, `fs.rmSync` the existing dirs first.
4. Creates the dirs (`fs.mkdirSync(..., { recursive: true })`).
5. Calls all generators (Tasks 4–5) and writes their output via `fs.writeFileSync`.
6. Edits `rootDir/package.json` workspaces — append the two package paths if not already present (read, check, insert after the last `packages/board-*` or `packages/mcu-*` line, write).
7. Edits `packages/cuttlefish/src/create/init-scaffold.ts` — append the registry entry (matching the shape from the C6/C3 entries) if `spec.boardId` not already in `_knownTargets`.
8. Edits `tests/packages/transpiler/init-scaffold.test.ts` — append a KNOWN_BOARDS `it()` block if not already present.
9. Creates `tests/packages/framework-arduino/${spec.architecture}-profile.test.ts` (the profile test, generated from the spec's FQBN).
10. Edits `README.md` — append the board table row and the available-boards list entry.
11. Generates the checklist (Task 6) and returns `{ createdFiles, checklist }`.

**Idempotency:** steps 6–10 must detect existing content and skip (or error with a clear message). Read the file, check for the architecture id, only write if absent.

- [ ] **Step 2: Build cuttlefish**

Run: `npm run build --workspace @typecad/cuttlefish`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/cuttlefish/src/create/board-codegen.ts
git commit -m "feat(cuttlefish): add scaffoldBoardPackages orchestrator (board-codegen)"
```

---

## Task 8: Re-exports + CLI wiring

**Files:**
- Modify: `packages/cuttlefish/src/create/index.ts`
- Modify: `packages/cuttlefish/src/testing.ts`
- Modify: `packages/cuttlefish/src/utils/cli.ts`
- Modify: `packages/cuttlefish/src/cli.ts`

- [ ] **Step 1: Re-export from `create/index.ts`**

Add to `packages/cuttlefish/src/create/index.ts`:

```ts
export { scaffoldBoardPackages } from './board-codegen.js';
export { generateFrameworkChecklist } from './board-checklist.js';
export { parseBoardSpec, safeParseBoardSpec, stripJsonc } from './board-spec.js';
export type { BoardSpec } from './board-spec.js';
export * as BoardGenerators from './board-generators.js';
```

- [ ] **Step 2: Re-export from `testing.ts`**

Add to `packages/cuttlefish/src/testing.ts` (after the existing create re-exports):

```ts
export {
  scaffoldBoardPackages,
  parseBoardSpec,
  safeParseBoardSpec,
  stripJsonc,
} from "./create/index.js";
export type { BoardSpec } from "./create/index.js";
export { BoardGenerators } from "./create/index.js";
```

- [ ] **Step 3: Add `board` to `parseCommandLine`**

In `packages/cuttlefish/src/utils/cli.ts`, add a branch in `parseCommandLine` (after the `create` branch ~line 316) that handles `firstArg === "board"`:

```ts
if (firstArg === "board") {
  const subCommand = argv[3];
  if (subCommand === "add") {
    const specPath = argv[4];
    if (!specPath) {
      throw new Error("Usage: cuttlefish board add <spec.jsonc>");
    }
    const force = readBooleanFlag(argv, ["--force", "-f"]);
    return { command: "board-add", specPath, force } as any;
  }
  throw new Error(`Unknown 'board' subcommand: ${subCommand ?? "(none)"}. Use: cuttlefish board add <spec.jsonc>`);
}
```

(Add a `BoardAddCommandOptions` type to `packages/cuttlefish/src/types.ts` if the codebase requires typed command options — check how `CreateCommandOptions` is defined there and mirror it.)

- [ ] **Step 4: Add `handleBoardAdd` to `cli.ts`**

In `packages/cuttlefish/src/cli.ts`, add the handler (near `handleCreate` ~line 37) and the dispatch branch (in `main()` ~line 118):

Handler:
```ts
async function handleBoardAdd(options: { specPath: string; force?: boolean }): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { scaffoldBoardPackages, parseBoardSpec, generateFrameworkChecklist } = await import('./create/index.js');

  const specPath = path.resolve(options.specPath);
  if (!fs.existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath}`);
  }

  console.log(`Reading spec: ${specPath}`);
  const specText = fs.readFileSync(specPath, 'utf8');
  const spec = parseBoardSpec(specText);  // throws on invalid

  console.log(`Generating board packages for ${spec.architecture}...`);
  const result = scaffoldBoardPackages(spec, { force: options.force });

  console.log(`\nCreated ${result.createdFiles.length} files:`);
  for (const f of result.createdFiles) {
    console.log(`  ${f}`);
  }

  console.log(generateFrameworkChecklist(spec));
}
```

Dispatch (in `main()`, after the `create` branch):
```ts
if (options.command === "board-add") { await handleBoardAdd(options); return; }
```

- [ ] **Step 5: Add `board add` to the help text**

In `packages/cuttlefish/src/utils/cli.ts`, `printHelp()` (~line 9), add a line for the new subcommand:

```
  cuttlefish board add <spec.jsonc>   Generate board + MCU packages from a chip spec
```

- [ ] **Step 6: Build + commit**

```bash
npm run build --workspace @typecad/cuttlefish
git add packages/cuttlefish/src/create/index.ts packages/cuttlefish/src/testing.ts packages/cuttlefish/src/utils/cli.ts packages/cuttlefish/src/cli.ts packages/cuttlefish/src/types.ts
git commit -m "feat(cuttlefish): wire \`cuttlefish board add\` CLI subcommand"
```

---

## Task 9: Tests — validation, snapshot, idempotency, overwrite-protection

**Files:**
- Create: `tests/packages/cuttlefish/board-codegen.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseBoardSpec,
  safeParseBoardSpec,
  stripJsonc,
  scaffoldBoardPackages,
  BoardGenerators,
} from "@typecad/cuttlefish/testing";

const C6_FIXTURE = path.resolve(__dirname, '../../fixtures/esp32c6-spec.jsonc');

describe("board-codegen", () => {
  describe("stripJsonc", () => {
    it("strips line comments", () => {
      expect(JSON.parse(stripJsonc('{"a": 1 // comment\n}'))).toEqual({ a: 1 });
    });
    it("strips block comments", () => {
      expect(JSON.parse(stripJsonc('{"a": /* x */ 1}'))).toEqual({ a: 1 });
    });
    it("preserves // inside strings", () => {
      expect(JSON.parse(stripJsonc('{"url": "http://x.com"}'))).toEqual({ url: "http://x.com" });
    });
  });

  describe("parseBoardSpec", () => {
    it("parses the C6 fixture", () => {
      const text = fs.readFileSync(C6_FIXTURE, 'utf8');
      const spec = parseBoardSpec(text);
      expect(spec.architecture).toBe('esp32c6');
      expect(spec.fqbn).toBe('esp32:esp32:esp32c6');
    });

    it("rejects a missing required field", () => {
      const result = safeParseBoardSpec('{"architecture": "test"}');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("generators", () => {
    it("generateMcuPackageJson produces valid JSON", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      const content = BoardGenerators.genMcuPackageJson(spec);
      const parsed = JSON.parse(content);
      expect(parsed.name).toBe('@typecad/mcu-esp32c6');
      expect(parsed.dependencies['@typecad/cuttlefish']).toBe('*');
    });

    it("genMcuPins includes the GPIO range", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      const content = BoardGenerators.genMcuPins(spec);
      expect(content).toContain('export const GPIO0');
      expect(content).toContain('export const GPIO30');
    });

    it("genBoardIndex contains the FQBN", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      const content = BoardGenerators.genBoardIndex(spec);
      expect(content).toContain("arduino: 'esp32:esp32:esp32c6'");
    });
  });

  describe("scaffoldBoardPackages", () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'board-codegen-test-'));
    });
    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("creates all expected files", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      const result = scaffoldBoardPackages(spec, { rootDir: tmpRoot });

      const fileNames = result.createdFiles.map(f => path.relative(tmpRoot, f));
      expect(fileNames).toContain(path.join('packages/mcu-esp32c6/package.json'));
      expect(fileNames).toContain(path.join('packages/mcu-esp32c6/src/index.ts'));
      expect(fileNames).toContain(path.join('packages/mcu-esp32c6/src/pins.ts'));
      expect(fileNames).toContain(path.join('packages/mcu-esp32c6/src/peripherals.ts'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/package.json'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/src/index.ts'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/src/pins.ts'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/src/analog.ts'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/src/board.ts'));
    });

    it("refuses to overwrite without --force", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      scaffoldBoardPackages(spec, { rootDir: tmpRoot });
      expect(() => scaffoldBoardPackages(spec, { rootDir: tmpRoot })).toThrow(/already exists/);
    });

    it("overwrites with --force", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      scaffoldBoardPackages(spec, { rootDir: tmpRoot });
      expect(() => scaffoldBoardPackages(spec, { rootDir: tmpRoot, force: true })).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/packages/cuttlefish/board-codegen.test.ts`
Expected: PASS. If snapshot/generator tests fail, the generator output doesn't match expectations — fix the generator (not the test) until it produces the right structure.

- [ ] **Step 3: Commit**

```bash
git add tests/packages/cuttlefish/board-codegen.test.ts
git commit -m "test(cuttlefish): board-codegen validation, snapshot, idempotency, overwrite tests"
```

---

## Task 10: Full verification — end-to-end smoke test

This task verifies the tool works end-to-end by generating a *throwaway* board (not one of the real packages) from a minimal spec and confirming the output is structurally valid.

- [ ] **Step 1: Create a throwaway spec** (e.g. a fake "esp32h2" or reuse the C6 fixture) and run the tool:

```bash
# Build first
npm run build --workspace @typecad/cuttlefish

# Run the tool on the C6 fixture into a temp dir (to avoid clobbering the real C6 packages)
# Use the --rootDir flag if the orchestrator supports it, or run from a temp monorepo copy.
# If the tool only targets the real monorepo root, skip this step and rely on the unit tests.
```

- [ ] **Step 2: Verify the generated packages typecheck**

If a temp-dir generation was possible:
```bash
cd <tmpDir> && npx tsc --noEmit -p packages/mcu-esp32c6/tsconfig.json
```
Expected: no errors.

- [ ] **Step 3: Run the full affected test suite**

```bash
npx vitest run tests/packages/cuttlefish/board-codegen.test.ts tests/packages/transpiler/init-scaffold.test.ts tests/packages/framework-arduino/
```
Expected: all pass.

- [ ] **Step 4: Commit any fixes surfaced by verification**

If the end-to-end test surfaced generator bugs, fix them and commit. Otherwise no commit needed.

---

## Self-Review Notes (for the implementer, not a task)

- **Spec coverage:** Every spec section maps to a task — schema+stripper (Task 1), template (Task 2), fixture (Task 3), MCU generators (Task 4), board generators (Task 5), checklist (Task 6), orchestrator (Task 7), CLI wiring (Task 8), tests (Task 9), e2e (Task 10).
- **The generators are the bulk of the work but are deterministic transforms.** Their reference is the hand-written C6 packages. The substitution map (Task 4) is the key: turn the C6's literal values into `${spec.*}` interpolations.
- **The orchestrator's idempotency is critical.** Re-running `board add` on the same spec must not duplicate registry entries, workspace lines, or test blocks. Each append must read-check-write.
- **The `create-board` command was previously removed** (cli.ts:340). This is a re-introduction under the `board add` name. Don't touch the old `create-board` rejection — it stays as a redirect for old users.
- **The `BoardAddCommandOptions` type** may need adding to `types.ts` — check how `CreateCommandOptions` is defined and mirror it. The `as any` cast in the parseCommandLine branch is a stopgap; the proper type is better.
- **The template (Task 2) is long** (~100 lines with comments) but it's documentation, not logic. Take the C6 spec values and annotate every field.
