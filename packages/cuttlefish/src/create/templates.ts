import type { ArchitectureIdentifier } from '../api/index.js';
import { LINT_RULES } from '../ir/feature-registry.js';
import { isBuiltinFramework } from './framework-catalog.js';

export interface CreateProjectOptions {
  projectName: string;
  targetId: string;
  targetDisplayName: string;
  isNative: boolean;
  architecture?: ArchitectureIdentifier;
  /** Qualified Zephyr board target (board-target projects). */
  board?: string;
  /** True when the board's devicetree declares an LED (pack fact — drives
   *  the starter between LED-blink and console-heartbeat). */
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
  /** Serial port picked at create time (console.port + test.port). Absent →
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

  // @typecad/hal is needed by every build, not just embedded ones: the
  // transpiler unconditionally warms the HAL source modules (loadHALModules in
  // transpile.ts), and resolveHALSourceDir() throws "Could not resolve
  // @typecad/hal/src/" if the package is absent. Embedded targets pull it in
  // transitively (framework + board packages depend on it),
  // but native targets have no board package, so HAL must be an explicit
  // direct dependency here.
  const deps: Record<string, string> = {
    "@typecad/cuttlefish": "^1.0.0-alpha.3",
    "@typecad/hal": "^1.0.0-alpha.3",
  };
  // Built-in frameworks (native) ship inside @typecad/cuttlefish — no
  // separate dependency entry.
  if (!isBuiltinFramework(frameworkPackage)) {
    deps[frameworkPackage] = "^1.0.0-alpha.3";
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

  // Developer-utility scripts shared by every target (native + embedded).
  // None require hardware or extra dependencies:
  //   dev        — auto-retranspile on save (transpile-only; append --compile
  //                to also compile on each change). The fast "does it
  //                typecheck" feedback loop.
  //   gen-decls  — generate TypeScript .d.ts from C++ headers. File-argument:
  //                `npm run gen-decls -- lib/foo.h` or `-- --all lib/`.
  //   gen-libdefs — generate library-definition stubs from a TS file's imports.
  //                File-argument: `npm run gen-libdefs -- src/main.ts`.
  const devScripts = [
    '"dev": "cuttlefish build --watch"',
    '"gen-decls": "cuttlefish gen-decls"',
    '"gen-libdefs": "cuttlefish gen-libdefs"',
  ];

  if (options.isNative) {
    const devDepsJson = baseDevDeps.join(',\n');
    return `{
  "name": "${projectName}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "cuttlefish build",
    "compile": "cuttlefish build --compile",
    "lint": "eslint --config .cuttlefish/eslint.config.mjs src/",
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
  //  - @typecad/expect: hardware tests run on the board via cuttlefish-test
  //    (`npm run test:hw`), scoped to tests/**/*.test.ts.
  //  - @typecad/simulator + vitest: simulate the board in Node (`npm run
  //    simulate`), scoped to sim/**/*.test.ts so vitest never collides with the
  //    @typecad/expect no-op stubs under tests/.
  // Versions mirror the workspace's published releases / root devDeps.
  const devDepsJson = [
    ...baseDevDeps,
    '    "@typecad/expect": "^1.0.0-alpha.3"',
    '    "@typecad/simulator": "^1.0.0-alpha.3"',
    '    "vitest": "^4.0.18"',
  ].join(',\n');
  return `{
  "name": "${projectName}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "cuttlefish build",
    "compile": "cuttlefish build --compile",
    "upload": "cuttlefish build --compile --upload",
    "monitor": "cuttlefish build --compile --upload --monitor",
    "test:hw": "npm exec -- cuttlefish-test",
    "simulate": "vitest run sim/",
    "lint": "eslint --config .cuttlefish/eslint.config.mjs src/",
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
  // The @typecad/board virtual import resolves for board AND MCU-only targets
  // (the transpile writes .cuttlefish/board.ts re-exporting either). The
  // @typecad/test-pins module is board data — MCU-only targets have none.
  const hasBoard = !!options.board || !!options.soc;
  const paths = (hasBoard || options.soc)
    ? `,
    "paths": {
      "@typecad/board": ["./.cuttlefish/board.ts"]${hasBoard ? `,
      "@typecad/test-pins": ["./.cuttlefish/test-pins.ts"]` : ''}
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
  "include": ["src/**/*.ts", "types/**/*.ts", "cuttlefish.config.ts", ".cuttlefish/cuttlefish-env.d.ts"${options.isNative ? '' : ', "sim/**/*.ts"'}]
}
`;
}

export function generateProjectConfig(options: CreateProjectOptions): string {
  if (options.isNative) {
    return `// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Project configuration
//
// Auto-generated by 'cuttlefish create'. Edit to customise your build.
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
  const baudLine = options.baudRate ? `\n\n  // Console polyfill configuration\n  console: {\n    baudRate: ${options.baudRate},\n    // Serial port for upload/monitor. Override with --port on the CLI.\n    port: '${portValue}',\n  },` : '';

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
  const zephyrProbeBlock = zephyrFields.length > 0
    ? `

  // Zephyr-specific configuration.
  zephyr: {
${zephyrFields.join('\n')}
  },`
    : '';

  // Hardware test runner configuration — used by \`npm run test:hw\` (cuttlefish-test,
  // provided by @typecad/expect). Defaults: baudRate 115200, timeout 30000,
  // include tests/**/*.test.ts.
  const testBaud = options.baudRate && options.baudRate !== 115200 ? `\n    baudRate: ${options.baudRate},` : '';
  const testLine = `\n\n  // Hardware test runner (@typecad/expect / \`npm run test:hw\`)\n  test: {\n    // Serial port for the test board. Override with --port on the CLI or the\n    // CUTTLEFISH_PORT env var (e.g. CUTTLEFISH_PORT=/dev/ttyUSB0 npm run test:hw).\n    port: '${portValue}',${testBaud}\n  },`;

  return `// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Project configuration
//
// Auto-generated by 'cuttlefish create'. Edit to customise your build.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/main.ts',
${socLine}${boardLine}
  // Framework package — controls code generation strategy
  framework: '${options.frameworkPackage}',${frameworkDataBlock}

  // Transpiled output (the Zephyr app lands in src/out)
  output: {
    outDir: './out',
  },${zephyrProbeBlock}${baudLine}${testLine}
};

export default config;
`;
}

export function generateProjectEnvDts(options: CreateProjectOptions): string {
  // The @typecad/board virtual module resolves for board AND MCU-only targets
  // — the transpile's first build rewrites this placeholder either way.
  if (!options.board && !options.soc) {
    return `// ---------------------------------------------------------------------------
// cuttlefish-env.d.ts — Global type declarations
//
// Auto-generated by 'cuttlefish create'. Do not edit manually.
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

  // console — declared here (not pulled from lib.dom) so this project does not
  // need "dom" in tsconfig lib just to type console.log. Avoiding lib.dom also
  // keeps DOM global type names (Node, Element, Event, ...) out of scope, so a
  // user class named e.g. Node is not shadowed by the DOM global. The
  // transpiler regenerates this file on build and may merge extra members
  // (readLine/readCharacter) onto the Console interface.
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

  // JS-style timers (declared here so a project does not need "dom" in tsconfig
  // lib to type setInterval/setTimeout). The transpiler rewrites these to
  // __tc_setInterval/__tc_setTimeout and emits the timer_methods polyfill when
  // used. Note: Timing.setInterval/setTimeout (from @typecad/hal) is the
  // preferred single entry point and is typed via the @typecad/board import.
  declare function setInterval(handler: () => void, timeout?: number): number;
  declare function setTimeout(handler: () => void, timeout?: number): number;
  declare function clearInterval(id: number): void;
  declare function clearTimeout(id: number): void;
}

export {};
`;
  }

  return `// ---------------------------------------------------------------------------
// cuttlefish-env.d.ts — Virtual module declaration for '@typecad/board'
//
// Auto-generated by 'cuttlefish create'. Do not edit manually.
// To change the board, update cuttlefish.config.ts and re-run the transpiler.
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

  // console — declared here (not pulled from lib.dom) so this project does not
  // need "dom" in tsconfig lib just to type console.log. Avoiding lib.dom also
  // keeps DOM global type names (Node, Element, Event, ...) out of scope, so a
  // user class named e.g. Node is not shadowed by the DOM global. The
  // transpiler regenerates this file on build and may merge extra members
  // (readLine/readCharacter) onto the Console interface.
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

  // JS-style timers (declared here so a project does not need "dom" in tsconfig
  // lib to type setInterval/setTimeout). The transpiler rewrites these to
  // __tc_setInterval/__tc_setTimeout and emits the timer_methods polyfill when
  // used. Note: Timing.setInterval/setTimeout (from @typecad/hal) is the
  // preferred single entry point and is typed via the @typecad/board import.
  declare function setInterval(handler: () => void, timeout?: number): number;
  declare function setTimeout(handler: () => void, timeout?: number): number;
  declare function clearInterval(id: number): void;
  declare function clearTimeout(id: number): void;
}

declare module '@typecad/board' {
  export * from './board.js';
  export type Owned<T = unknown> = T;
  export type Shared<T = unknown> = T;
  export type Mutable<T = unknown> = T;
}

export {};
`;
}

export function generateStarterProgram(options: CreateProjectOptions): string {
  if (options.isNative) {
    return `// ---------------------------------------------------------------------------
// Hello World — Native desktop application
//
// Compiles to a native executable via g++/clang++.
// ---------------------------------------------------------------------------

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log("Hello from Cuttlefish!");
console.log("Fibonacci(10) =", fibonacci(10));
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

import { GPIO, Time } from '@typecad/hal';
import { ${options.starterPin} } from '@typecad/board';

const led = new GPIO(${options.starterPin}, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(1000);
}
`;
  }

  return `// ---------------------------------------------------------------------------
// Blink — The classic "Hello World" of embedded
//
// ${options.hasLed === false
    ? `This board's devicetree declares no LED — a console heartbeat instead.`
    : `Toggles the onboard LED every second using the recommended GPIO pattern.`}
// ---------------------------------------------------------------------------

${options.hasLed === false
    ? `import { Time } from '@typecad/hal';

let beats: number = 0;

while (true) {
  beats = beats + 1;
  console.log(\`beat \${beats}\`);
  Time.sleep(1000);
}
`
    : `import { GPIO, Time } from '@typecad/hal';
import { LED } from '@typecad/board';

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
// Runs on the board via \`npm run test:hw\` (cuttlefish-test). Each test file is
// transpiled, flashed to the board, and its assertions are evaluated on the host
// over serial. Change the serial port in cuttlefish.config.ts (the \`test.port\`
// field) or override it with the CUTTLEFISH_PORT env var.
//
// API: describe(...).it(...).expect(value).<matcher>() chains. Import pin
// objects from '@typecad/board' to assert on real hardware I/O. Every file ends
// with done().
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/expect';

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
// @typecad/simulator package). No board, serial port, or west build required.
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
} from "@typecad/simulator";

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
  // boardType mirrors the target chosen with \`cuttlefish create\`.
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
.cuttlefish-cache.json

# Generated boilerplate (regenerated on build — do not commit)
.cuttlefish/cuttlefish-env.d.ts
.cuttlefish/eslint.config.mjs
.cuttlefish/eslint-transpiler-rules.mjs
`;
}

export function generateEditorconfig(_options: CreateProjectOptions): string {
  return `# Auto-generated by 'cuttlefish create'. Edit to customise your build.
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
      // (no-restricted-syntax, the cuttlefish/* AST rules, no-explicit-any,
      // no-eval, ...) consume type information, so enabling type-aware linting
      // only forces ESLint to build a full TS type-program per file — ~3.4s of
      // pure overhead on small projects with zero change to what is detected.
      // If a future rule needs types, scope project to that rule only via
      // parserOptions on a dedicated config block, not globally.
    },
    plugins: {
      "@typescript-eslint": tseslint,
      cuttlefish: transpilerPlugin,
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
      // Cuttlefish transpiler-compatibility plugin rules.
      "cuttlefish/no-delete-non-map": "error",
      "cuttlefish/no-object-static-non-map": "error",
      "cuttlefish/no-super-outside-method": "error",
      "cuttlefish/no-typeof-non-primitive": "error",
      "cuttlefish/no-destructured-without-init": "error",
      "cuttlefish/no-fractional-to-number-type": "error",
      "cuttlefish/no-array-param-content-mutation": "error",
      "cuttlefish/no-container-functional-methods": "error",
      "cuttlefish/no-undefined-compare-on-get": "error",
      "cuttlefish/no-map-struct-mutation": "error",
      "cuttlefish/no-mutating-method-on-const-collection": "warn",
      "cuttlefish/no-readonly-loop-variable-mutation": "warn",
      "cuttlefish/no-undefined-compare-on-struct-field": "error",
      "cuttlefish/no-typed-array-param-length": "error",
      "cuttlefish/no-typed-array-return": "error",
      "cuttlefish/no-typed-array-field": "error",
      "cuttlefish/no-dynamic-property-access": "error",
      "cuttlefish/no-this-in-free-function": "error",
    },
  },
];
`;
}
