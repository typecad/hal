# demo-ui ESP32 Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a bare, transpile-clean ESP32 demo project at `./demo-ui` using `@typecad/framework-arduino` + `@typecad/board-esp32-devkit`, wired into the monorepo as a workspace member.

**Architecture:** A new sibling directory of `./demo` mirroring its layout (config + env + tsconfig + eslint + src/main.ts). Target architecture flips from AVR→ESP32; otherwise the structure, scripts, and conventions match `./demo` exactly. This is a **scaffold**, not feature code — there is no unit-testable logic, so the success gate is "transpile clean + lint clean" rather than TDD unit tests. Verification steps substitute for the usual red/green test cycle.

**Tech Stack:** TypeCAD cuttlefish transpiler, `@typecad/framework-arduino`, `@typecad/board-esp32-devkit`, `@typecad/mcu-esp32`, `arduino-cli` toolchain, ESLint + typescript-eslint.

**Spec:** `docs/superpowers/specs/2026-06-19-demo-ui-scaffold-design.md`

---

## File Structure

All new files live under `demo-ui/` at the repo root (sibling of `demo/`), plus one edit to the root `package.json`.

- **Create** `demo-ui/package.json` — project metadata + workspace `"*"` deps + scripts (copied from `demo/package.json`)
- **Create** `demo-ui/tsconfig.json` — TypeScript config (copied verbatim from `demo/tsconfig.json`)
- **Create** `demo-ui/cuttlefish.config.ts` — ESP32 transpile config
- **Create** `demo-ui/cuttlefish-env.d.ts` — seeded ambient declarations (copied from `demo/`, board package name changed)
- **Create** `demo-ui/eslint.config.mjs` — lint config (copied verbatim from `demo/eslint.config.mjs`)
- **Create** `demo-ui/src/main.ts` — minimal ESP32 blinky skeleton
- **Modify** `package.json` (root) — add `"demo-ui"` to the `workspaces` array

---

## Task 1: Project metadata files

**Files:**
- Create: `demo-ui/package.json`
- Create: `demo-ui/tsconfig.json`

- [ ] **Step 1: Create `demo-ui/package.json`**

```json
{
  "name": "demo-ui",
  "version": "1.0.0",
  "description": "ESP32 DevKit demo using the TypeCAD transpiler",
  "type": "module",
  "scripts": {
    "build": "cuttlefish build",
    "compile": "cuttlefish build --compile",
    "upload": "cuttlefish build --compile --upload --port COM7 --monitor",
    "transpile": "cuttlefish build --no-transpile",
    "lint": "eslint src/"
  },
  "dependencies": {
    "@typecad/framework-arduino": "*",
    "@typecad/board-esp32-devkit": "*",
    "@typecad/mcu-esp32": "*"
  },
  "devDependencies": {
    "eslint": "^10.4.1",
    "@typescript-eslint/parser": "^8.61.0",
    "@typescript-eslint/eslint-plugin": "^8.61.0"
  }
}
```

- [ ] **Step 2: Create `demo-ui/tsconfig.json`** (verbatim copy of `demo/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "cuttlefish-env.d.ts"],
  "exclude": ["node_modules"],
  "types": []
}
```

- [ ] **Step 3: Commit**

```bash
git add demo-ui/package.json demo-ui/tsconfig.json
git commit -m "chore(demo-ui): add package.json and tsconfig"
```

---

## Task 2: Transpile config + seeded env declarations

**Files:**
- Create: `demo-ui/cuttlefish.config.ts`
- Create: `demo-ui/cuttlefish-env.d.ts`

- [ ] **Step 1: Create `demo-ui/cuttlefish.config.ts`**

```ts
// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Project configuration
//
// Targets the ESP32 DevKit (ESP32-WROOM-32) via the Arduino ESP32 core. This
// demo scaffold is the home for upcoming UI-graphics work on this branch; it
// currently contains only a minimal blinky skeleton.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Entry point — the main TypeScript file to transpile. The transpiler wraps
  // top-level statements into `setup()` and synthesizes an empty `loop()`.
  entry: './src/main.ts',

  // Target architecture — ESP32 (32-bit Xtensa LX6, STL available, FreeRTOS
  // under the Arduino core).
  target: 'esp32',

  // MCU package — silicon-level pin/port definitions for the ESP32-WROOM-32.
  mcu: '@typecad/mcu-esp32',

  // Board package — ESP32 DevKit pin definitions, aliases (D0/D13, A0–A5), and
  // peripheral mappings (I2C/SPI/UART buses).
  board: '@typecad/board-esp32-devkit',

  // Framework package — controls code generation strategy (setup/loop, Serial,
  // .ino output).
  framework: '@typecad/framework-arduino',

  // Build target — FQBN passed straight through to `arduino-cli compile`.
  // Matches the board package's `build.frameworks.arduino` value.
  frameworkData: {
    buildTarget: 'esp32:esp32:esp32',
  },

  // Output / build options.
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  // Toolchain — `arduino-cli` invokes xtensa-esp32-elf-g++ from the installed
  // `esp32:esp32` core (no system-wide toolchain needed).
  toolchain: {
    type: 'arduino-cli',
  },

  // Console polyfill configuration — `Serial.begin(115200)` is injected at the
  // top of `setup()` so `console.log` reaches the serial monitor.
  console: {
    baudRate: 115200,
  },
};

export default config;
```

- [ ] **Step 2: Create `demo-ui/cuttlefish-env.d.ts`**

Copy `demo/cuttlefish-env.d.ts` verbatim, then make exactly two edits:
1. Line 7 header comment: change `Board: @typecad/board-arduino-uno` → `Board: @typecad/board-esp32-devkit`
2. Line 107: change `export * from '@typecad/board-arduino-uno';` → `export * from '@typecad/board-esp32-devkit';`

Full file content:

```ts
// ---------------------------------------------------------------------------
// cuttlefish-env.d.ts — Virtual module declaration for '@typecad'
//
// Auto-generated by the cuttlefish transpiler. Do not edit manually.
// To change the board, update cuttlefish.config.ts and re-run the transpiler.
//
// Board: @typecad/board-esp32-devkit
// ---------------------------------------------------------------------------

declare global {
  type Owned<T = unknown> = T;
  type Shared<T = unknown> = T;
  type Mutable<T = unknown> = T;

  // C-style explicit number types recognized by the transpiler
  type uint8_t = number;
  type int8_t = number;
  type uint16_t = number;
  type int16_t = number;
  type uint32_t = number;
  type int32_t = number;
  type size_t = number;
  type float = number;
  type double = number;

  // console — declared here (not pulled from lib.dom) so a project does not
  // need "dom" in tsconfig lib just to type console.log. Avoiding lib.dom
  // also keeps DOM global type names (Node, Element, Event, Document, ...)
  // out of scope, so a user class named e.g. `Node` is not shadowed by the
  // DOM global of the same name. Platforms may declaration-merge extra
  // members onto this interface via ambientTypeDeclarations().
  interface Console {
    log(...args: unknown[]): void;
    info(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  }
  const console: Console;

  // Convenience helper for volatile variables in TypeCAD programs.
  // The transpiler detects calls to volatile() and emits the C++ volatile qualifier.
  declare function volatile<T>(value: T): T;

  // JS-style timers
  declare function setInterval(handler: () => void, timeout?: number): number;
  declare function setTimeout(handler: () => void, timeout?: number): number;
  declare function clearInterval(id: number): void;
  declare function clearTimeout(id: number): void;

  // Timing utilities (transpiled to millis/micros/delay/delayMicroseconds)
  const Timing: {
    millis(): number;
    micros(): number;
    delay(ms: number): void;
    delayMicroseconds(us: number): void;
  };

  // EEPROM non-volatile storage (transpiled to EEPROM.*)
  const EEPROM: {
    read(addr: number): number;
    write(addr: number, value: number): void;
    update(addr: number, value: number): void;
    length(): number;
    get<T>(addr: number, ref: T): T;
    put<T>(addr: number, ref: T): void;
  };

  // Watchdog timer (transpiled to wdt_enable/wdt_reset/wdt_disable)
  const WDT: {
    enable(timeout?: '15ms' | '30ms' | '60ms' | '120ms' | '250ms' | '500ms' | '1s' | '2s' | '4s' | '8s'): void;
    reset(): void;
    disable(): void;
  };

  // Key-value non-volatile storage (EEPROM-backed on AVR, native Preferences.h on ESP32)
  const Preferences: {
    begin(name: string, readOnly?: boolean): void;
    end(): void;
    putInt(key: string, value: number): void;
    getInt(key: string, defaultValue: number): number;
    putUInt(key: string, value: number): void;
    getUInt(key: string, defaultValue: number): number;
    putBool(key: string, value: boolean): void;
    getBool(key: string, defaultValue: boolean): boolean;
    putFloat(key: string, value: number): void;
    getFloat(key: string, defaultValue: number): number;
    putString(key: string, value: string): void;
    getString(key: string, defaultValue: string): string;
    remove(key: string): void;
  };
}
declare module '@TypeCAD' {
  export type Owned<T = any> = T;
  export type Shared<T = any> = T;
  export type Mutable<T = any> = T;
}
declare global {
  export type Owned<T = any> = T;
  export type Shared<T = any> = T;
  export type Mutable<T = any> = T;
}
declare global {
}

declare module '@typecad' {
  export * from '@typecad/board-esp32-devkit';
}

export {};
```

- [ ] **Step 3: Commit**

```bash
git add demo-ui/cuttlefish.config.ts demo-ui/cuttlefish-env.d.ts
git commit -m "chore(demo-ui): add cuttlefish config and seeded env declarations"
```

---

## Task 3: ESLint config

**Files:**
- Create: `demo-ui/eslint.config.mjs`

- [ ] **Step 1: Copy `demo/eslint.config.mjs` to `demo-ui/eslint.config.mjs` verbatim**

```bash
cp demo/eslint.config.mjs demo-ui/eslint.config.mjs
```

No edits needed — the config imports `../eslint-transpiler-rules.mjs`, which resolves to the repo-root file from `demo-ui/` exactly as it does from `demo/`.

- [ ] **Step 2: Verify the relative import resolves**

Run: `node -e "require('url').pathToFileURL(require('path').resolve('demo-ui/../eslint-transpiler-rules.mjs'))" && echo OK`
Expected: prints a file:// URL followed by `OK` (confirms `eslint-transpiler-rules.mjs` exists at repo root, one level up from `demo-ui/`).

- [ ] **Step 3: Commit**

```bash
git add demo-ui/eslint.config.mjs
git commit -m "chore(demo-ui): add eslint config"
```

---

## Task 4: Minimal ESP32 main.ts skeleton

**Files:**
- Create: `demo-ui/src/main.ts`

- [ ] **Step 1: Create `demo-ui/src/main.ts`**

A one-shot skeleton that imports the on-board LED (GPIO2 via the `LED` alias), configures it as an output, toggles it once, and logs a startup banner. Structurally mirrors `demo/src/main.ts` (top-level statements + a `main()` call; framework synthesizes `setup()` and an empty `loop()`).

```ts
// ---------------------------------------------------------------------------
// main.ts — ESP32 DevKit blinky skeleton (cuttlefish, Arduino ESP32 core)
//
// Bare scaffold for upcoming UI-graphics work. No UI content yet — just a
// transpile-clean ESP32 skeleton that confirms the board/framework packages
// resolve and code generation targets the right architecture.
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board-esp32-devkit';

// On-board LED on GPIO2 (the `LED` board alias).
const led = LED.asOutput();

function main(): void {
  console.log('--- demo-ui: ESP32 DevKit skeleton ---');
  led.high();
  console.log('led on');
  led.low();
  console.log('led off');
  console.log('done');
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add demo-ui/src/main.ts
git commit -m "chore(demo-ui): add minimal ESP32 blinky skeleton"
```

---

## Task 5: Wire demo-ui into the root workspace

**Files:**
- Modify: `package.json` (root) — `workspaces` array

- [ ] **Step 1: Add `"demo-ui"` to the root workspaces array**

In the root `package.json`, the `workspaces` array currently contains `"demo"` (and `"native_demo"`). Insert `"demo-ui"` immediately after `"demo"`:

```json
  "workspaces": [
    "packages/cuttlefish",
    "packages/hal",
    "packages/mcu-atmega328p",
    "packages/mcu-esp32",
    "packages/framework-avr",
    "packages/framework-arduino",
    "packages/framework-native",
    "packages/board-arduino-uno",
    "packages/board-esp32-devkit",
    "packages/expect",
    "packages/ui",
    "packages/simulator",
    "demo",
    "demo-ui",
    "native_demo"
  ],
```

- [ ] **Step 2: Run `npm install` from the repo root**

Run: `npm install`
Expected: completes without error and links `demo-ui`'s `"*"` dependencies to the local workspace packages. (A few npm deprecation warnings are fine; no `ERESOLVE` / peer-dep errors.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add demo-ui to root workspaces"
```

Note: `package-lock.json` will likely change as a side effect of `npm install` registering the new workspace — include it in the commit if it changed.

---

## Task 6: Verify — transpile clean + lint clean

**Files:** none (verification only)

This task is the success gate for the scaffold (substitutes for unit tests — there is no testable logic).

- [ ] **Step 1: Transpile from the demo-ui directory**

Run: `npm run build --workspace demo-ui`
Expected: exit code 0. The transpiler emits output to `demo-ui/out/` and regenerates `demo-ui/cuttlefish-env.d.ts` (which may show as modified — that's expected; the transpiler owns this file).

- [ ] **Step 2: If the env file was regenerated, re-add it**

Run: `git status demo-ui/cuttlefish-env.d.ts`
If modified: `git add demo-ui/cuttlefish-env.d.ts` and commit with message `chore(demo-ui): regenerate env declarations after first transpile`. If clean, skip.

- [ ] **Step 3: Lint from the demo-ui directory**

Run: `npm run lint --workspace demo-ui`
Expected: exit code 0, no errors. (Warnings are acceptable; errors are not.)

- [ ] **Step 4: Confirm generated output exists**

Run: `ls demo-ui/out/`
Expected: a non-empty directory containing the generated C++/`.ino` artifact (exact filename depends on the framework emitter).

- [ ] **Step 5: If anything was regenerated in Step 2, verify final tree state**

Run: `git status`
Expected: clean working tree (or only the committed regenerated env file). No stray untracked files under `demo-ui/` other than `out/` and `node_modules/`.

---

## Notes for the implementer

- **No unit tests.** This is a scaffold; the transpile (Task 6 Step 1) and lint (Task 6 Step 3) runs are the verification. Do not invent test files.
- **`cuttlefish-env.d.ts` is owned by the transpiler.** The seeded copy in Task 2 exists only so `tsconfig`/lint resolve before the first transpile. After Task 6 Step 1 it will be regenerated — accept that diff.
- **Do not run `npm run compile`** unless the esp32 Arduino core is installed locally. Transpile + lint are the success bar; `compile` (which invokes `arduino-cli compile --fqbn esp32:esp32:esp32`) is environment-dependent and out of scope for this scaffold.
- **The `upload` script hardcodes `COM7`** — copied verbatim from `demo/`. It's a script string, never run during this scaffold; leave it as-is.
