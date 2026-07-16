# arduino-cli + Core Presence Verification

**Date:** 2026-07-16
**Status:** Approved (pending implementation)
**Packages affected:** new `@typecad/arduino-cli`, `@typecad/framework-arduino`, `@typecad/expect`, `@typecad/cuttlefish`

## Problem

Cuttlefish and the `expect` hardware-test runner both spawn `arduino-cli`, but there is **no preflight check** for whether the binary is installed or whether the board's required core is present. When `arduino-cli` is missing, `spawnSync` returns an ENOENT with `status: null` and empty stdout/stderr, so users see an empty or generic failure with no indication that the binary is absent. When the core is missing, the failure is similarly opaque. The fix command (`arduino-cli core install <pack:arch>`) is never surfaced programmatically — it appears only in documentation.

There is currently no binary-availability detection anywhere in the repo. Every `arduino-cli` call is a bare `spawnSync("arduino-cli", [...])`.

## Goal

Confirm that `arduino-cli` is installed and that the core required by the loaded board file's FQBN is installed, and surface a clear, actionable message (with the exact fix command) when either is missing — without ever mutating the user's environment.

## Key findings that shape the design

- **The required core is derivable from the FQBN.** Each board's FQBN (e.g. `arduino:avr:uno`, `esp32:esp32:esp32`) is carried as `buildTarget`. The first two segments (`Pack:Arch`, e.g. `arduino:avr`, `esp32:esp32`) are exactly the `id` used by `arduino-cli core install` and reported by `arduino-cli core list`.
- **`arduino-cli core list --format json` (no `--all`) returns only installed platforms**, in the shape `{ platforms: [{ id: "arduino:avr", ... }] }`. Core presence is therefore a set-membership test: is `Pack:Arch` in the returned `id` set?
- **Two independent callers** spawn `arduino-cli`: the `framework-arduino` toolchain (cuttlefish's build path) and the `expect` host compiler. They have no shared prod dependency today (`framework-arduino` prod-deps `@typecad/hal`; `expect` prod-deps `typescript` + `serialport`, with cuttlefish as devDep only).
- **arduino-cli runs on a plain build too** — the `board details` metadata probe in `framework-arduino/src/cli-metadata.ts` fires at transpile time, before `--compile`. But that probe already degrades gracefully: on failure it emits a warning diagnostic and falls back to static tables, so the build still succeeds without arduino-cli installed.

## Architecture

A new tiny workspace package, **`@typecad/arduino-cli`**, owns detection logic only (no spawning of compile/upload — that stays in its current packages; dedup is explicitly future work). Both consumers add it as a prod dep.

```
@typecad/arduino-cli  (NEW — prod dep of both consumers)
        ▲                          ▲
        │ checkArduinoEnv()        │ checkArduinoEnv()
        │                          │
@typecad/framework-arduino      @typecad/expect
 (compile/upload/monitor)        (hardware test runner)
        ▲
        │ compileSource() delegates here
@typecad/cuttlefish  (also adds `doctor` subcommand using the same module)
```

**Why a new package** (vs. duplicating the helper or putting it in `@typecad/hal`):
- A dedicated package is the correct category — host-side Node tooling, distinct from `hal`'s MCU/runtime abstraction. Polluting `hal` would blur its purpose.
- It gives a single source of truth and a natural future home to consolidate the near-identical compile/upload spawn code currently duplicated between the two consumers (out of scope here).
- Each consumer needs only a single, clean prod-dep addition.

## `@typecad/arduino-cli` API surface

The package exports one primary function plus its result types.

```ts
export interface ArduinoEnvCheck {
  /** arduino-cli binary was found on PATH and responded to `version`. */
  arduinoCliInstalled: boolean;
  /** arduino-cli version string if installed, e.g. "1.4.1". */
  arduinoCliVersion: string | undefined;
  /** Cores present on this machine, in Pack:Arch form, e.g. ["arduino:avr","esp32:esp32"]. */
  installedCores: string[];
  /** The Pack:Arch derived from the given fqbn, e.g. "arduino:avr". undefined if fqbn is malformed. */
  requiredCore: string | undefined;
  /** requiredCore is present in installedCores. false if fqbn malformed or core absent. */
  requiredCoreInstalled: boolean;
}

export type ArduinoEnvOk = { ok: true; check: ArduinoEnvCheck };

export type ArduinoEnvFailure = {
  ok: false;
  reason:
    | "arduino-cli-not-found"     // binary missing / not on PATH
    | "arduino-cli-unresponsive"  // found but `version` errored/timed out
    | "core-not-installed";       // arduino-cli fine, but the board's core is absent
  check: ArduinoEnvCheck;
  messages: string[];             // human-readable lines ready to print
  fixCommand: string | undefined; // exact command the user should run, e.g. "arduino-cli core install arduino:avr"
};

export type ArduinoEnvResult = ArduinoEnvOk | ArduinoEnvFailure;

/**
 * Verify the environment can build for `fqbn`. Cheap and side-effect-free:
 * runs `arduino-cli version` then `arduino-cli core list --format json`, caches
 * both for the process lifetime, and reports what (if anything) is missing.
 *
 * - If `fqbn` is undefined/empty, checks arduino-cli presence only.
 * - Never installs anything. Never mutates the user environment.
 * - Never throws — always returns a result. Callers decide how to react.
 */
export function checkArduinoEnv(fqbn?: string): ArduinoEnvResult;
```

### Design choices

- **Never throws.** A missing binary is the *expected* error condition this feature exists to catch. Returning a structured `Failure` lets each caller decide whether to print-and-exit, emit a diagnostic, or warn. This mirrors the existing `cli-metadata.ts` precedent of graceful degradation.
- **`version` probe before `core list`.** Calling `core list` when the binary is absent produces an ENOENT indistinguishable from other failures. Probing `version` first cleanly separates `arduino-cli-not-found` from `core-not-installed` and yields a version string for the `doctor` report.
- **In-process cache only.** The check is two sub-second calls; a disk cache would add staleness complexity (unlike the large, slow `board details` metadata cache in `cli-metadata.ts`, which is left untouched). Memoization targets the `--watch` recompile loop, where the check would otherwise re-run every cycle.
- **FQBN parsing is internal.** The function derives `requiredCore` via `fqbn.split(":").slice(0,2).join(":")` and returns it so callers and `doctor` output all agree on what was checked.
- **Injectable spawn seam.** The module exposes a clearly-marked, for-test-only override hook (e.g. an internal `__setArduinoCliRunnerForTest(runner)`) that swaps the default `spawnSync`-based executor with a fake. This keeps the public signature clean (`checkArduinoEnv(fqbn?)`) while making FQBN derivation + set-membership unit-testable without the binary. Only the smoke test exercises the real executor.

## Integration points

The check runs at the top of each path that spawns `arduino-cli`, **before** any transpile/compile work, so users fail fast.

### Path A — cuttlefish build path (via `framework-arduino`)

Gate placement follows where the failure is unrecoverable:

| Build flag | Spawns arduino-cli for | Gate hard-fails if missing? |
|---|---|---|
| plain build (no flags) | `board details` metadata probe only | **No** — probe degrades to warning + static fallback. |
| `--compile` | compile | **Yes** |
| `--upload` | upload | **Yes** |
| `--monitor` | monitor | **Yes** |

- **Hard gate** in `framework-arduino/src/arduino-compile.ts`, at the top of `compileArduinoSketch`, `uploadArduinoSketch`, and `monitorArduinoSketch`. On failure returns a `CompileResult`/`UploadResult` with `success: false` and the human message in `output`. Cuttlefish's existing error printing (`cli.ts:658-671`) renders it unchanged — **cuttlefish stays unaware of the check.**
- **Soft upgrade** in `framework-arduino/src/cli-metadata.ts`: when the `board details` probe fails specifically due to ENOENT (binary missing), augment the existing `TS2CPP_ARDUINO_CLI_PROBE_FAILED` warning with the install hint, then continue to fall back. Non-blocking, strictly an improvement over today.

### Path B — expect test runner (`packages/expect/src/host/compiler.ts`)

Hard gate at the top of `compileSketch` and `uploadSketch`. These have no graceful fallback today (empty failure). On a failed check, return a structured failure the runner surfaces as a test error with the fix command.

### `cuttlefish doctor` subcommand (new)

Walks the loaded board(s) from config, calls `checkArduinoEnv(fqbn)` for each, and prints a report:

```
arduino-cli .... 1.4.1  ✓
arduino:avr ....... installed ✓
esp32:esp32 ....... installed ✓
cube_cell:avr .... NOT installed ✗  →  arduino-cli core install cube_cell:avr
```

Exits 0 if everything present, non-zero otherwise. Same detection module, presentation-only wrapper. Registered alongside the existing subcommands in `cuttlefish/src/utils/cli.ts` and `cuttlefish/src/cli.ts`.

## Error messages

Consistent and actionable across all callers. Produced from each failure's `messages` + `fixCommand`:

```
arduino-cli not found on PATH. Install it: https://arduino.github.io/arduino-cli/
  (then run: arduino-cli core install arduino:avr)

arduino-cli found but required core 'arduino:avr' is not installed.
  Run: arduino-cli core install arduino:avr
```

`doctor` reuses the same strings — one voice across the tool.

## Caching & timeouts

- **In-process memoization** of `version` + `core list` results for the lifetime of a single `cuttlefish`/`cuttlefish-test` invocation. No cross-process disk cache for the check itself.
- **Timeouts:** `version` probe 5s, `core list` 10s. Matches the existing `cli-metadata.ts` 10s discipline. Fails fast rather than hanging.

## Testing

Two layers, matching the repo's `tests/packages/...` + vitest convention:

1. **Unit tests** (`tests/packages/arduino-cli/check.test.ts`) — pure, run anywhere, no real spawn:
   - FQBN → `requiredCore` derivation: `arduino:avr:uno` → `arduino:avr`; `esp32:esp32:esp32` → `esp32:esp32`; malformed/empty → `undefined`.
   - Set-membership against a fixture `installedCores` list (present / absent / fqbn-malformed).
   - `ArduinoEnvResult` construction in each branch.
   - Uses the for-test spawn-seam override hook to inject fakes.

2. **Smoke test** (`tests/packages/arduino-cli/spawn.test.ts`) — presence-gated:
   - Skips with a clear message if `arduino-cli` is not on PATH (CI without it still passes).
   - When present, asserts `checkArduinoEnv("arduino:avr:uno")` returns a contract-shaped result with non-empty `installedCores`.
   - Mirrors the repo's existing hardware-path gating.

## Scope

**In scope:**
- New package `@typecad/arduino-cli` with `checkArduinoEnv()` + types.
- Hard gate in `framework-arduino` compile/upload/monitor (returns failed result, no throw).
- Soft warning upgrade in `framework-arduino` metadata probe (ENOENT → install hint).
- Hard gate in `expect` host compiler (compile + upload).
- New `cuttlefish doctor` subcommand.
- Prod-dep wiring: `framework-arduino` and `expect` both depend on `@typecad/arduino-cli`.
- Unit tests + presence-gated smoke test.

**Explicitly out of scope:**
- Deduplicating the near-identical `compileSketch`/`uploadSketch` spawn code between `framework-arduino` and `expect` into the new package. (The new package is the natural future home, but moving spawns is a separate, riskier refactor.)
- Auto-installing cores.
- Checking for installed *libraries* (`lib list`) — separate concern, separate API.
