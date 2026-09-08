import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchitectureIdentifier } from '../api/index.js';
import { LINT_RULES } from '../ir/feature-registry.js';
import { isBuiltinFramework } from './framework-catalog.js';

/**
 * Dependency range for the scaffolded @typecad/* entries — the engine's own
 * version, which the whole ecosystem is lockstep-pinned to. Derived from this
 * package's manifest at scaffold time so it never goes stale.
 */
function typecadRange(): string {
  const manifest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version as string;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Could not read the engine's own version from ${manifest}`);
  }
  return `^${version}`;
}

export interface CreateProjectOptions {
  projectName: string;
  targetId: string;
  targetDisplayName: string;
  isNative: boolean;
  architecture?: ArchitectureIdentifier;
  /** Qualified Zephyr board target (board-target projects). */
  board?: string;
  /** True when the board's devicetree declares an LED (pack fact — drives
   *  the starter between an I/O skeleton and LED-blink). */
  hasLed?: boolean;
  frameworkPackage: string;
  framework: string;
  buildTarget?: string;
  /** Zephyr SoC name (bare-silicon / contract projects). */
  soc?: string;
  baudRate?: number;
  includeStarter: boolean;
  toolchainType?: string;
  /** Extra frameworkData fields (e.g. `{ target: 'esp32s3' }` for framework-esp32). */
  frameworkData?: Record<string, unknown>;
  /** Selected probe-method id (Zephyr boards with a probeMethods table);
   *  emits the zephyr.probe section in the scaffolded config. */
  probeMethod?: string;
  /** Probe methods the board supports (wizard/catalog data) — used to write
   *  the config comment listing the alternatives. */
  probeMethods?: { id: string; description?: string }[];
  /** Pre-baked zephyr.runnerArgs for the selected probe method (from
   *  probeRunnerQuirks — board-catalog facts, e.g. an srst-based openocd.cfg
   *  behind a debug header with no NRST). Emitted after probe with an
   *  explanatory comment. */
  probeRunnerArgs?: string[];
  /** Serial port picked at create time (test.port). Absent →
   *  the platform hint placeholder. */
  port?: string;
  /** MCU-only Zephyr target: emit `zephyr.customBoard: true` so the framework
   *  generates an out-of-tree board named after the build target. */
  zephyrCustomBoard?: boolean;
  /** Starter-program pin for MCU-only targets (a port name — bare silicon has
   *  no board-level LED alias). */
  starterPin?: string;
}

export function generateProjectPackageJson(options: CreateProjectOptions): string {
  const { projectName, frameworkPackage } = options;
  const range = typecadRange();

  // @typecad/hal is the product package — the surface user code imports, the
  // testing DSL ('@typecad/hal/testing') and simulator ('@typecad/hal/sim')
  // subpaths, and (transitively) the cuttlefish engine. Every target lists it
  // directly: the transpiler resolves the project's own hal copy for board
  // generation and HAL source parsing.
  const deps: Record<string, string> = {
    "@typecad/hal": range,
  };
  // Built-in frameworks (native) ship inside @typecad/cuttlefish — no
  // separate dependency entry. An absent/empty frameworkPackage here would
  // otherwise emit a broken `"undefined"` dependency entry; fail loudly at
  // scaffold time instead.
  if (!isBuiltinFramework(frameworkPackage)) {
    if (typeof frameworkPackage !== 'string' || frameworkPackage.length === 0 || !frameworkPackage.startsWith('@')) {
      throw new Error(
        `Cannot scaffold project dependencies: framework package is ${JSON.stringify(frameworkPackage)} ` +
        `(framework: ${JSON.stringify(options.framework)}). The create flow must resolve a concrete framework package.`,
      );
    }
    deps[frameworkPackage] = range;
  }

  const depsJson = Object.entries(deps)
    .map(([k, v]) => `    "${k}": "${v}"`)
    .join(',\n');

  // The scaffolded eslint.config.mjs imports @typescript-eslint/parser and the
  // eslint-transpiler-rules plugin (which is plain JS, no dep). Without these
  // devDependencies `npm run lint` fails to resolve the parser/plugin in a
  // freshly created project. Versions mirror the repo demo's package.json.
  const baseDevDeps = [
    '    "eslint": "^10.4.1"',
    '    "@typescript-eslint/parser": "^8.61.0"',
    '    "@typescript-eslint/eslint-plugin": "^8.61.0"',
  ];

  // Developer-utility script shared by every target (native + embedded).
  // Requires no hardware or extra dependencies:
  //   dev — auto-retranspile on save (transpile-only; append --compile
  //         to also compile on each change). The fast "does it typecheck"
  //         feedback loop.
  const devScripts = [
    '"dev": "typecad-hal build --watch"',
  ];

  if (options.isNative) {
    const devDepsJson = baseDevDeps.join(',\n');
    return `{
  "name": "${projectName}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "typecad-hal build",
    "compile": "typecad-hal build --compile",
    "lint": "eslint --config .typecad-hal/eslint.config.mjs src/",
    "clean": "typecad-hal clean",
    ${devScripts.join(',\n    ')}
  },
  "dependencies": {
${depsJson}
  },
  "devDependencies": {
${devDepsJson}
  }
}
`;
  }

  // Embedded projects get two host-side testing tiers:
  //  - hardware tests run on the board via typecad-hal test (`npm run
  //    test:hw`), scoped to tests/**/*.test.ts. The describe/expect DSL
  //    ships inside @typecad/hal (its '@typecad/hal/testing' subpath) and
  //    the runner is part of @typecad/cuttlefish — no extra package.
  //  - vitest: simulate the board in Node (`npm run simulate`), scoped to
  //    sim/**/*.test.ts so vitest never collides with the testing DSL's
  //    no-op stubs under tests/.
  const devDepsJson = [
    ...baseDevDeps,
    '    "vitest": "^4.0.18"',
  ].join(',\n');
  return `{
  "name": "${projectName}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "typecad-hal build",
    "compile": "typecad-hal build --compile",
    "upload": "typecad-hal build --compile --upload",
    "monitor": "typecad-hal build --compile --upload --monitor",
    "test:hw": "npm exec -- typecad-hal test",
    "simulate": "vitest run sim/",
    "lint": "eslint --config .typecad-hal/eslint.config.mjs src/",
    "clean": "typecad-hal clean",
    ${devScripts.join(',\n    ')}
  },
  "dependencies": {
${depsJson}
  },
  "devDependencies": {
${devDepsJson}
  }
}
`;
}

export function generateProjectTsconfig(options: CreateProjectOptions): string {
  // The virtual board module resolves for board AND MCU-only targets (the
  // transpile's first build rewrites the placeholder either way). User code
  // imports EVERYTHING from '@typecad/hal' — the mapping below points that
  // specifier at the generated narrowed module (.typecad-hal/board.ts), so
  // pins, pre-wired instances, and hardware classes all come from the one
  // specifier, and hardware this board lacks fails at module resolution.
  // The @typecad/test-pins module is board data — MCU-only targets have none.
  const hasBoard = !!options.board || !!options.soc;
  const paths = (hasBoard || options.soc)
    ? `,
    "paths": {
      "@typecad/hal": ["./.typecad-hal/board.ts"]${hasBoard ? `,
      "@typecad/test-pins": ["./.typecad-hal/test-pins.ts"]` : ''}
    }`
    : '';

  return `{
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
    "resolveJsonModule": true,
    "allowArbitraryExtensions": true,
    "allowImportingTsExtensions": true,
    "rootDirs": ["src", "types"]${paths}
  },
  "include": ["src/**/*.ts", "types/**/*.ts", "typecad-hal.config.ts", ".typecad-hal/typecad-hal-env.d.ts"${options.isNative ? '' : ', "sim/**/*.ts"'}]
}
`;
}

/**
 * The app dir the scaffolded config produces, workspace-relative with forward
 * slashes ('src/out'): the CLI resolves output.outDir against the ENTRY's
 * directory, so generateProjectConfig's fixed `entry: './src/main.ts'` +
 * `outDir: './out'` always yields src/out. Kept beside the values it mirrors;
 * the create-time debug-artifact writer needs it (the framework would
 * otherwise assume the default).
 */
export function starterAppRel(
  entry = './src/main.ts',
  outDir = './out',
): string {
  const entryDir = path.posix.dirname(entry.replace(/\\/g, '/'));
  return path.posix.normalize(
    path.posix.join(entryDir === '.' ? '' : entryDir, outDir.replace(/\\/g, '/')),
  );
}

export function generateProjectConfig(options: CreateProjectOptions): string {
  if (options.isNative) {
    return `// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Project configuration
//
// Auto-generated by 'typecad-hal create'. Edit to customise your build.
// ---------------------------------------------------------------------------

const config = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/main.ts',

  // Framework package — controls code generation strategy
  framework: '${options.frameworkPackage}',

  // Output options
  output: {
    outDir: './out',
  },
};

export default config;
`;
  }

  // The build target rides `board:` for board projects; only board-less
  // projects (bare silicon / contract, whose target is a generated custom
  // board) need the explicit frameworkData entry.
  const buildTarget = options.buildTarget;
  let frameworkDataBlock = '';
  if (buildTarget && buildTarget !== options.board) {
    frameworkDataBlock = `\n  // Framework data — the generated custom board's name (no upstream board).\n  frameworkData: {\n    buildTarget: '${buildTarget}',\n  },`;
  }

  const socLine = options.soc
    ? `
  // Zephyr SoC — bare silicon; the board module is generated from the
  // curated soc descriptor (contract projects narrow it further).
  soc: '${options.soc}',
`
    : '';

  const boardLine = options.board
    ? `
  // Zephyr board target — the project-local board module is generated
  // from the framework's board data pack on first build.
  board: '${options.board}',`
    : '';

  const portHint = process.platform === 'win32' ? 'COM4' : '/dev/ttyACM0';
  const portValue = options.port ?? portHint;

  // zephyr.* section — probe (boards with a probe-method table) and/or
  // customBoard (MCU-only targets: generate an out-of-tree board for the
  // chip, named after frameworkData.buildTarget).
  const zephyrFields: string[] = [];
  if (options.zephyrCustomBoard) {
    zephyrFields.push(`    // Generate an out-of-tree Zephyr board for this MCU under
    // boards/typecad/ (no board package exists for this hardware). The
    // board's name comes from frameworkData.buildTarget above.
    customBoard: true,`);
  }
  if (options.probeMethod) {
    const probeIds = (options.probeMethods ?? []).map((m) => m.id).join(', ');
    zephyrFields.push(`    // How this board attaches a probe (picked at create time;
    // the board also supports: ${probeIds || 'see the framework docs'}). Serves
    // flashing AND debugging.
    probe: '${options.probeMethod}',`);
  }
  if (options.probeRunnerArgs && options.probeRunnerArgs.length > 0) {
    const quirks = options.probeRunnerArgs.map((a) => `'${a}'`).join(', ');
    zephyrFields.push(`    // Quirk: this board's openocd.cfg drives OpenOCD resets through the
    // SRST pin. When the probe's NRST line isn't wired to the target (the
    // BlackPill's SWD header has no NRST pin at all), \`reset init\` times out
    // with "timed out while waiting for target halted". These args force
    // pin-independent core resets instead — remove them if NRST is wired and
    // pin resets are wanted.
    runnerArgs: [${quirks}],`);
  }
  const zephyrProbeBlock = zephyrFields.length > 0
    ? `

  // Zephyr-specific configuration.
  zephyr: {
${zephyrFields.join('\n')}
  },`
    : '';

  // Hardware test runner configuration — used by \`npm run test:hw\` (typecad-hal test,
  // provided by the built-in test-runner). Defaults: baudRate 115200, timeout 30000,
  // include tests/**/*.test.ts.
  const testBaud = options.baudRate && options.baudRate !== 115200 ? `\n    baudRate: ${options.baudRate},` : '';
  const testLine = `\n\n  // Hardware test runner (\`npm run test:hw\`)\n  test: {\n    // Serial port for the test board. Override with --port on the CLI or the\n    // TYPECAD_HAL_PORT env var (e.g. TYPECAD_HAL_PORT=/dev/ttyUSB0 npm run test:hw).\n    port: '${portValue}',${testBaud}\n  },`;

  return `// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Project configuration
//
// Auto-generated by 'typecad-hal create'. Edit to customise your build.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/hal/config';

const config: TypecadConfig = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/main.ts',
${socLine}${boardLine}
  // Framework package — controls code generation strategy
  framework: '${options.frameworkPackage}',${frameworkDataBlock}

  // Transpiled output (the Zephyr app lands in src/out)
  output: {
    outDir: './out',
  },${zephyrProbeBlock}${testLine}
};

export default config;
`;
}

export function generateProjectEnvDts(options: CreateProjectOptions): string {
  // The @typecad/hal virtual module resolves for board AND MCU-only targets
  // — the transpile's first build rewrites this placeholder either way.
  if (!options.board && !options.soc) {
    return `// ---------------------------------------------------------------------------
// typecad-hal-env.d.ts — Global type declarations
//
// Auto-generated by 'typecad-hal create'. Do not edit manually.
// ---------------------------------------------------------------------------

declare global {
  type Owned<T = unknown> = T;
  type Shared<T = unknown> = T;
  type Mutable<T = unknown> = T;
  // SafeVariable: SEU-resistant storage. The transpiler lowers SafeVariable<number>
  // to a C++ template with inverted-redundancy storage. Declared as an interface
  // (not a type alias) so the TS type checker recognizes method calls.
  // Arithmetic T only (integral or floating-point); string is rejected by a
  // static_assert in the emitted C++ template.
  interface SafeVariable<T = number> { set(value: T): void; get(): T; valid(): boolean; hasFault(): boolean; }
  // SafeInt: chainable bounds-checked signed-integer arithmetic. The transpiler
  // lowers SafeInt<number> to SafeInt<int32_t> (a C++ template with sticky-fault
  // overflow detection). Signed integer T only — unsigned/bool/float/string are
  // rejected by a static_assert in the emitted C++ template.
  interface SafeInt<T = number> {
    add(delta: T): SafeInt<T>; sub(delta: T): SafeInt<T>;
    mul(factor: T): SafeInt<T>; divide(d: T): SafeInt<T>; mod(d: T): SafeInt<T>;
    negate(): SafeInt<T>; absValue(): SafeInt<T>;
    get(): T; hasFault(): boolean; valid(): boolean; reset(newValue: T): void;
  }

  type uint8_t = number;
  type int8_t = number;
  type uint16_t = number;
  type int16_t = number;
  type uint32_t = number;
  type int32_t = number;
  type size_t = number;
  type float = number;
  type double = number;

  // Convenience helper for volatile variables in TypeCAD programs.
  // The transpiler detects calls to volatile() and emits the C++ volatile qualifier.
  declare function volatile<T>(value: T): T;
}

export {};
`;
  }

  return `// ---------------------------------------------------------------------------
// typecad-hal-env.d.ts — Global type declarations
//
// Auto-generated by 'typecad-hal create'. Do not edit manually.
// To change the board, update typecad-hal.config.ts and re-run the transpiler.
//
// User code imports everything from '@typecad/hal' — the tsconfig paths
// mapping resolves that specifier
// onto .typecad-hal/board.ts, the narrowed hardware gateway. No ambient
// module declaration: the real package must not be shadowed.
//
// Board: ${options.targetDisplayName}
// ---------------------------------------------------------------------------

declare global {
  type Owned<T = unknown> = T;
  type Shared<T = unknown> = T;
  type Mutable<T = unknown> = T;
  // SafeVariable: SEU-resistant storage. The transpiler lowers SafeVariable<number>
  // to a C++ template with inverted-redundancy storage. Declared as an interface
  // (not a type alias) so the TS type checker recognizes method calls.
  // Arithmetic T only (integral or floating-point); string is rejected by a
  // static_assert in the emitted C++ template.
  interface SafeVariable<T = number> { set(value: T): void; get(): T; valid(): boolean; hasFault(): boolean; }
  // SafeInt: chainable bounds-checked signed-integer arithmetic. The transpiler
  // lowers SafeInt<number> to SafeInt<int32_t> (a C++ template with sticky-fault
  // overflow detection). Signed integer T only — unsigned/bool/float/string are
  // rejected by a static_assert in the emitted C++ template.
  interface SafeInt<T = number> {
    add(delta: T): SafeInt<T>; sub(delta: T): SafeInt<T>;
    mul(factor: T): SafeInt<T>; divide(d: T): SafeInt<T>; mod(d: T): SafeInt<T>;
    negate(): SafeInt<T>; absValue(): SafeInt<T>;
    get(): T; hasFault(): boolean; valid(): boolean; reset(newValue: T): void;
  }

  type uint8_t = number;
  type int8_t = number;
  type uint16_t = number;
  type int16_t = number;
  type uint32_t = number;
  type int32_t = number;
  type size_t = number;
  type float = number;
  type double = number;

  // Convenience helper for volatile variables in TypeCAD programs.
  // The transpiler detects calls to volatile() and emits the C++ volatile qualifier.
  declare function volatile<T>(value: T): T;
}

export {};
`;
}

export function generateStarterProgram(options: CreateProjectOptions): string {
  if (options.isNative) {
    return `// ---------------------------------------------------------------------------
// Hello World — Native desktop application
//
// Compiles to a native executable via g++/clang++. There is no console.* here
// — results are observable through the debugger or your own channels.
// ---------------------------------------------------------------------------

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const fib10 = fibonacci(10);
`;
  }

  // MCU-only target: bare silicon has no board-level LED alias — blink a
  // port pin from the MCU datasheet instead.
  if (!options.board && options.starterPin) {
    return `// ---------------------------------------------------------------------------
// Blink — The classic "Hello World" of embedded
//
// MCU-only target (no board package): ${options.targetDisplayName}. Pins are
// addressed by their datasheet port names — see the MCU package for the full
// pinout and each pin's capabilities.
// ---------------------------------------------------------------------------

import { GPIO, Time, ${options.starterPin} } from '@typecad/hal';

const led = new GPIO(${options.starterPin}, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(1000);
}
`;
  }

  return `// ---------------------------------------------------------------------------
// Starter — The skeleton every program grows from
//
// ${options.hasLed === false
    ? `This board's devicetree declares no LED — wire up your board's I/O below.`
    : `Toggles the onboard LED every second using the recommended GPIO pattern.`}
// ---------------------------------------------------------------------------

${options.hasLed === false
    ? `import { Time } from '@typecad/hal';

// This board exports no LED alias — add a peripheral here (GPIO on a header
// pin, UART0/USB0 for serial output, ...) and drive it in the loop.
while (true) {
  Time.sleep(1000);
}
`
    : `import { GPIO, Time, LED } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(1000);
}
`}
`;
}

export function generateStarterTest(_options: CreateProjectOptions): string {
  return `// ---------------------------------------------------------------------------
// Hardware test — Basics
//
// Runs on the board via \`npm run test:hw\` (typecad-hal test). Each test file is
// transpiled, flashed to the board, and its assertions are evaluated on the host
// over serial. Change the serial port in typecad-hal.config.ts (the \`test.port\`
// field) or override it with the TYPECAD_HAL_PORT env var.
//
// API: describe(...).it(...).expect(value).<matcher>() chains. Import pin
// objects from '@typecad/hal' to assert on real hardware I/O. Every file ends
// with done().
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/hal/testing';

describe("Basics")
  .it("adds two numbers")
  .expect(
    (() => {
      const a = 1;
      let b = 2;
      return a + b;
    })
  ).toBe(3)
  .it("multiplies two numbers")
  .expect(
    (() => {
      let a = 3;
      let b = 4;
      return a * b;
    })
  ).toBe(12)
  .it("reads an array element")
  .expect(
    (() => {
      const data = new Uint8Array([0xAA, 0x10, 0x20]);
      return data[1];
    })
  ).toBe(0x10)
  .it("clamps a value to a range")
  .expect(
    (() => {
      const value = 2000;
      return Math.max(0, Math.min(1023, value));
    })
  ).toBe(1023);

done();
`;
}

export function generateStarterSim(options: CreateProjectOptions): string {
  const boardType = options.targetId;
  return `// ---------------------------------------------------------------------------
// Hardware simulation — Button + LED
//
// Runs entirely on your computer with \`npm run simulate\` (vitest + the
// simulator built into @typecad/hal — its '@typecad/hal/sim' subpath). No
// board, serial port, or west build required.
// The simulator mirrors the pins/peripherals of your ${options.targetDisplayName}
// (${boardType}); you inject fake inputs and assert on the outputs in Node.
//
// This is the fast tier — iterate on logic here, then confirm on real hardware
// with \`npm run test:hw\` (which flashes tests/ to the board).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  createSimBoard,
  type SimBoard,
  type SimDigitalPin,
} from "@typecad/hal/sim";

// ===========================================================================
// FIRMWARE LOGIC
// ---------------------------------------------------------------------------
// Factor your firmware into a function that takes the simulated pins as
// arguments. In a real project this same logic runs on the board against real
// pins — here it runs against the sim board so you can test it without hardware.
// ===========================================================================

/**
 * Reads a button and reflects its state on an LED.
 *
 * To use your own logic: replace the body of this function with whatever your
 * firmware does (read a sensor, drive a motor, print to serial, ...). As long
 * as it only touches pins you pass in, the simulator can exercise it.
 */
function reflectButtonOnLed(button: SimDigitalPin, led: SimDigitalPin): void {
  // The button pin is pulled HIGH (1) at rest and reads LOW (0) when pressed.
  if (button.isLow()) {
    led.high();
  } else {
    led.low();
  }
}

// ===========================================================================
// TEST BENCH
// ---------------------------------------------------------------------------
// \`createSimBoard\` builds an in-memory version of your board. The pin numbers
// below match the physical pinout. Add the pins/peripherals your firmware uses:
// board.digital(n), board.analog(n), board.pwm(n), board.serial(n),
// board.i2c(n), board.spi(n), board.interrupt(n).
// ===========================================================================

function setupSim(): { board: SimBoard; button: SimDigitalPin; led: SimDigitalPin } {
  // boardType mirrors the target chosen with \`typecad-hal create\`.
  const board = createSimBoard({ boardType: "${boardType}" });

  const button = board.digital(2).asInputPullUp();  // button on pin 2 (INPUT_PULLUP)
  const led = board.digital(13).asOutput(false);    // LED on pin 13

  return { board, button, led };
}

describe("Button + LED (simulator)", () => {
  beforeEach(() => {
    // A fresh board per test keeps state isolated. For a long-running sim you
    // can call board.reset() between cycles instead.
  });

  it("keeps the LED off while the button is released", () => {
    const { button, led } = setupSim();

    // Button at rest: INPUT_PULLUP reads HIGH.
    reflectButtonOnLed(button, led);

    expect(led.getBitValue()).toBe(0);
  });

  it("turns the LED on while the button is pressed", () => {
    const { button, led } = setupSim();

    // Simulate a press: drive the button pin LOW.
    button.injectValue(0);
    reflectButtonOnLed(button, led);

    expect(led.getBitValue()).toBe(1);
  });
});
`;
}

export function generateGitignore(_options: CreateProjectOptions): string {
  return `node_modules/
out/
dist/
*.thcppmap.json
.typecad-hal-cache.json

# Generated boilerplate (regenerated on build — do not commit)
.typecad-hal/typecad-hal-env.d.ts
.typecad-hal/eslint.config.mjs
.typecad-hal/eslint-transpiler-rules.mjs
`;
}

export function generateEditorconfig(_options: CreateProjectOptions): string {
  return `# Auto-generated by 'typecad-hal create'. Edit to customise your build.
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.{ts,js,mjs,cjs,json,css,ui,md,yml}]
indent_style = space
indent_size = 2
`;
}

export function generateEslintConfig(_options: CreateProjectOptions): string {
  // `no-restricted-syntax` selectors are generated from LINT_RULES
  // (packages/cuttlefish/src/ir/feature-registry.ts), the single source of
  // truth shared with build-time prescan diagnostics. Do not hand-edit the
  // array below.
  const transpilerRulesJson = JSON.stringify(
    LINT_RULES.map(({ selector, message }) => ({ selector, message })),
    null,
    2,
  ).replace(/\n/g, "\n  ");

  return `import tsparser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import transpilerPlugin from "./eslint-transpiler-rules.mjs";

// Auto-generated from feature-registry.ts LINT_RULES — do not edit by hand.
const transpilerRules = ${transpilerRulesJson};

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "out/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      // NOTE: do NOT set parserOptions.project here. None of the rules below
      // (no-restricted-syntax, the typecad-hal/* AST rules, no-explicit-any,
      // no-eval, ...) consume type information, so enabling type-aware linting
      // only forces ESLint to build a full TS type-program per file — ~3.4s of
      // pure overhead on small projects with zero change to what is detected.
      // If a future rule needs types, scope project to that rule only via
      // parserOptions on a dedicated config block, not globally.
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "typecad-hal": transpilerPlugin,
    },
    rules: {
      "no-restricted-syntax": ["error", ...transpilerRules],
      // Core ESLint + @typescript-eslint AOT-safety rules.
      "@typescript-eslint/no-explicit-any": "error",
      "no-delete-var": "error",
      "no-eval": "error",
      "no-sparse-arrays": "error",
      "no-restricted-globals": [
        "error",
        { "name": "Proxy", "message": "[transpiler] Proxy is not supported (no AOT lowering). Avoid." },
        { "name": "Reflect", "message": "[transpiler] Reflect is not supported (no AOT lowering). Avoid." },
        { "name": "WeakRef", "message": "[transpiler] WeakRef depends on the GC schedule — bare metal has no GC. Avoid." },
        { "name": "FinalizationRegistry", "message": "[transpiler] FinalizationRegistry depends on the GC schedule — bare metal has no GC. Avoid." },
        { "name": "Symbol", "message": "[transpiler] Symbol depends on runtime symbol lookup / the iterator protocol, which has no AOT lowering. Avoid." },
      ],
      // Transpiler-compatibility plugin rules.
      "typecad-hal/no-delete-non-map": "error",
      "typecad-hal/no-object-static-non-map": "error",
      "typecad-hal/no-super-outside-method": "error",
      "typecad-hal/no-typeof-non-primitive": "error",
      "typecad-hal/no-destructured-without-init": "error",
      "typecad-hal/no-fractional-to-number-type": "error",
      "typecad-hal/no-array-param-content-mutation": "error",
      "typecad-hal/no-container-functional-methods": "error",
      "typecad-hal/no-undefined-compare-on-get": "error",
      "typecad-hal/no-map-struct-mutation": "error",
      "typecad-hal/no-mutating-method-on-const-collection": "warn",
      "typecad-hal/no-readonly-loop-variable-mutation": "warn",
      "typecad-hal/no-undefined-compare-on-struct-field": "error",
      "typecad-hal/no-typed-array-param-length": "error",
      "typecad-hal/no-typed-array-return": "error",
      "typecad-hal/no-typed-array-field": "error",
      "typecad-hal/no-dynamic-property-access": "error",
      "typecad-hal/no-this-in-free-function": "error",
    },
  },
];
`;
}
