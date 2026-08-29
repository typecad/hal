import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import type { ArchitectureIdentifier } from "../api/index.js";
import type { CreateProjectOptions } from "./templates.js";
import {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterProgram,
  generateStarterTest,
  generateStarterSim,
  generateGitignore,
  generateEditorconfig,
  generateEslintConfig,
} from "./templates.js";
import { generateEslintRules } from "./eslint-rules-template.js";
import { writeEditorIntegration } from "./editor-integration.js";

export interface KnownTarget {
  id: string;
  displayName: string;
  isNative: boolean;
  architecture?: ArchitectureIdentifier;
  /** Qualified Zephyr board target — the config's board: value and the
   *  boardgen input (materialized to .cuttlefish/board.ts at create). */
  board?: string;
  /** Framework package + id. Optional on embedded targets: the scaffold wizard
   *  fills these in by discovering installed @typecad/framework-* packages, so
   *  KNOWN_TARGETS board entries do not hardcode a framework. Native targets
   *  set them directly. */
  frameworkPackage?: string;
  framework?: string;
  buildTarget?: string;
  soc?: string;
  /** Framework-specific config (becomes frameworkData in cuttlefish.config.ts).
   *  Carries framework-specific target/options data for the selected framework. */
  frameworkData?: Record<string, unknown>;
}

const _knownTargets: KnownTarget[] = [
  {
    id: 'native',
    displayName: 'Native Desktop',
    isNative: true,
    frameworkPackage: '@typecad/framework-native',
    framework: 'native',
  },
  {
    id: 'esp32-devkit',
    displayName: 'ESP32 DevKit',
    isNative: false,
    architecture: 'esp32',
    board: 'esp32_devkitc/esp32/procpu',
    buildTarget: 'esp32_devkitc/esp32/procpu',
    soc: 'esp32',
  },
  {
    id: 'esp32s3',
    displayName: 'ESP32-S3',
    isNative: false,
    architecture: 'esp32s3',
    board: 'esp32s3_devkitc/esp32s3/procpu',
    buildTarget: 'esp32s3_devkitc/esp32s3/procpu',
    soc: 'esp32s3',
  },
  {
    id: 'esp32c3',
    displayName: 'ESP32-C3',
    isNative: false,
    architecture: 'esp32c3',
    board: 'esp32c3_devkitm/esp32c3',
    buildTarget: 'esp32c3_devkitm/esp32c3',
    soc: 'esp32c3',
  },
  {
    id: 'esp32c6',
    displayName: 'ESP32-C6',
    isNative: false,
    architecture: 'esp32c6',
    board: 'esp32c6_devkitc/esp32c6/hpcore',
    buildTarget: 'esp32c6_devkitc/esp32c6/hpcore',
    soc: 'esp32c6',
  },
  {
    id: 'rp2040',
    displayName: 'RP2040 (Pico)',
    isNative: false,
    architecture: 'rp2040',
    board: 'rpi_pico/rp2040',
    buildTarget: 'rpi_pico',
    soc: 'rp2040',
  },
  {
    id: 'rp2350',
    displayName: 'RP2350 (Pico 2)',
    isNative: false,
    architecture: 'rp2350',
    board: 'rpi_pico2/rp2350a/m33',
    buildTarget: 'rpi_pico2/rp2350a/m33',
    soc: 'rp2350a',
  },
  {
    id: 'xiao-nrf52840',
    displayName: 'XIAO nRF52840',
    isNative: false,
    architecture: 'nrf52',
    board: 'xiao_ble/nrf52840',
    // Zephyr-only target: the build target is the `west build -b` board id,
    // not an Arduino FQBN (frameworkTargetProfile resolves it for Zephyr).
    buildTarget: 'xiao_ble/nrf52840',
    soc: 'nrf52840',
  },
  {
    id: 'blackpill-f411ce',
    displayName: 'Black Pill (STM32F411)',
    isNative: false,
    architecture: 'stm32f411',
    board: 'blackpill_f411ce/stm32f411xe',
    // Zephyr-only target: the build target is the `west build -b` board id,
    // not an Arduino FQBN (frameworkTargetProfile resolves it for Zephyr).
    buildTarget: 'blackpill_f411ce/stm32f411xe',
    soc: 'stm32f411xe',
  },
  {
    id: 'nano-33-iot',
    displayName: 'Arduino Nano 33 IoT (SAMD21)',
    isNative: false,
    architecture: 'samd21',
    board: 'arduino_nano_33_iot/samd21g18a',
    // Zephyr-only target: the build target is the `west build -b` board id,
    // not an Arduino FQBN (frameworkTargetProfile resolves it for Zephyr).
    buildTarget: 'arduino_nano_33_iot/samd21g18a',
    soc: 'samd21g18a',
  },
];

// ---------------------------------------------------------------------------
// MCU-only targets — program bare silicon with no board package. The catalog
// mirrors the mcus/ packages: architecture + the Zephyr SoC name(s) from the
// soc name (the join key into the board catalog —
// an MCU with zephyrSocs supports both generated custom boards and any
// upstream board built on that SoC). The consistency tests keep this in sync
// with the packages, the same way BOARD_PROBE_METHODS mirrors board data.
// ---------------------------------------------------------------------------

export interface KnownMcu {
  id: string;
  displayName: string;
  architecture: ArchitectureIdentifier;
  /** Zephyr SoC name — the config's soc: value (contract projects program
   *  bare silicon through the curated soc descriptor). */
  soc: string;
  /** A safe output-capable port pin for the starter program (no board-level
   *  LED alias exists on bare silicon). */
  starterPin: string;
}

const _knownMcus: KnownMcu[] = [
  { id: 'esp32',      displayName: 'ESP32 (bare silicon)',    architecture: 'esp32',    soc: 'esp32',      starterPin: 'GPIO2' },
  { id: 'esp32c3',    displayName: 'ESP32-C3 (bare silicon)', architecture: 'esp32c3',  soc: 'esp32c3',    starterPin: 'GPIO8' },
  { id: 'esp32c6',    displayName: 'ESP32-C6 (bare silicon)', architecture: 'esp32c6',  soc: 'esp32c6',    starterPin: 'GPIO8' },
  { id: 'esp32s3',    displayName: 'ESP32-S3 (bare silicon)', architecture: 'esp32s3',  soc: 'esp32s3',    starterPin: 'GPIO2' },
  { id: 'nrf52840',   displayName: 'nRF52840 (bare silicon)', architecture: 'nrf52',    soc: 'nrf52840',   starterPin: 'P1_11' },
  { id: 'rp2040',     displayName: 'RP2040 (bare silicon)',   architecture: 'rp2040',  soc: 'rp2040',     starterPin: 'GP25' },
  { id: 'rp2350',     displayName: 'RP2350 (bare silicon)',   architecture: 'rp2350',  soc: 'rp2350a',    starterPin: 'GP25' },
  { id: 'samd21',     displayName: 'SAMD21 (bare silicon)',   architecture: 'samd21',  soc: 'samd21g18a', starterPin: 'PB23' },
  { id: 'stm32f411',  displayName: 'STM32F411 (bare silicon — contract PCBs)', architecture: 'stm32f411', soc: 'stm32f411xe', starterPin: 'PA5' },
];

export const KNOWN_MCUS: ReadonlyArray<KnownMcu> = _knownMcus;

export const KNOWN_TARGETS: ReadonlyArray<KnownTarget> = _knownTargets;

export function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface ScaffoldProjectResult {
  createdFiles: string[];
  outDir: string;
  options: CreateProjectOptions;
}

export function scaffoldProject(
  options: CreateProjectOptions,
  outDir?: string,
): ScaffoldProjectResult {
  const resolvedOutDir = outDir
    ? path.resolve(outDir)
    : path.resolve(process.cwd(), options.projectName);

  if (fs.existsSync(resolvedOutDir)) {
    const contents = fs.readdirSync(resolvedOutDir);
    if (contents.length > 0) {
      throw new Error(
        `Directory '${resolvedOutDir}' already exists and is not empty. ` +
        `Choose a different project name or use --outDir to specify a different location.`,
      );
    }
  }

  const srcDir = path.join(resolvedOutDir, 'src');
  const cuttlefishDir = path.join(resolvedOutDir, '.cuttlefish');
  const createdFiles: string[] = [];

  fs.mkdirSync(srcDir, { recursive: true });
  // .cuttlefish/ holds generated boilerplate (env.d.ts, eslint config, board.ts)
  fs.mkdirSync(cuttlefishDir, { recursive: true });

  function writeFile(fileName: string, content: string): string {
    const filePath = path.join(resolvedOutDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    createdFiles.push(filePath);
    return filePath;
  }

  writeFile('package.json', generateProjectPackageJson(options));
  writeFile('tsconfig.json', generateProjectTsconfig(options));
  writeFile('cuttlefish.config.ts', generateProjectConfig(options));
  writeFile('.cuttlefish/cuttlefish-env.d.ts', generateProjectEnvDts(options));
  writeFile('.cuttlefish/eslint.config.mjs', generateEslintConfig(options));
  writeFile('.cuttlefish/eslint-transpiler-rules.mjs', generateEslintRules(options));
  writeFile('.gitignore', generateGitignore(options));
  writeFile('.editorconfig', generateEditorconfig(options));

  // Editor integration: workspace-bundled VS Code extension for .ui syntax
  // highlighting (best-effort — warns and skips if the assets are missing).
  // hideNpm: end-user projects are not npm packages — hide VS Code's NPM
  // Scripts view and npm task detection.
  for (const file of writeEditorIntegration(resolvedOutDir, undefined, true)) createdFiles.push(file);

  if (options.board) {
    // Board-target projects materialize .cuttlefish/board.ts + board.json on
    // the first build (config-loader → the framework's board generator);
    // nothing to write here.
  }

  if (options.includeStarter) {
    const entryName = 'main.ts';
    const entryPath = path.join(srcDir, entryName);
    fs.writeFileSync(entryPath, generateStarterProgram(options), 'utf-8');
    createdFiles.push(entryPath);
  }

  // Embedded projects get a starter hardware test (@typecad/expect / cuttlefish-test).
  // Native projects have no serial/board path, so they get no test setup.
  if (!options.isNative) {
    const testsDir = path.join(resolvedOutDir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    const testPath = path.join(testsDir, '01-basics.test.ts');
    fs.writeFileSync(testPath, generateStarterTest(options), 'utf-8');
    createdFiles.push(testPath);

    // Host-side simulation (@typecad/simulator + vitest). sim/ is kept separate
    // from tests/ so `vitest run sim/` never loads the @typecad/expect no-op
    // stubs, and `cuttlefish-test` (which globs tests/) never tries to flash a
    // simulator file as firmware.
    const simDir = path.join(resolvedOutDir, 'sim');
    fs.mkdirSync(simDir, { recursive: true });
    const simPath = path.join(simDir, 'main.test.ts');
    fs.writeFileSync(simPath, generateStarterSim(options), 'utf-8');
    createdFiles.push(simPath);
  }

  return { createdFiles, outDir: resolvedOutDir, options };
}

export function printCreateNextSteps(
  options: CreateProjectOptions,
  outDir: string,
  opts: { installed?: boolean; debugProfile?: boolean } = {},
): void {
  const relativeDir = path.relative(process.cwd(), outDir) || '.';

  console.log();
  console.log(chalk.cyan(`⤳ Cuttlefish`));
  console.log();
  console.log(chalk.bold.white("Next steps:"));
  console.log(chalk.dim(`  cd ${relativeDir}`));
  // When create already installed dependencies, don't tell the user to do it again.
  if (!opts.installed) {
    console.log(chalk.dim(`  npm install`));
  }
  console.log(`  ${chalk.cyan("npm run compile")}`);

  if (opts.debugProfile) {
    console.log();
    console.log(chalk.bold.white("To debug (VS Code):"));
    console.log(`  ${chalk.cyan("open the folder and press F5")} ${chalk.dim("(builds + flashes, then attaches GDB)")}`);
  }

  console.log();
  console.log(chalk.bold.white("To edit .ui files (VS Code):"));
  console.log(`  ${chalk.cyan("open the folder and approve the workspace extension")} ${chalk.dim("(adds .ui syntax highlighting)")}`);

  if (!options.isNative) {
    console.log();
    console.log(chalk.bold.white("To simulate without hardware:"));
    console.log(`  ${chalk.cyan("npm run simulate")}`);
    console.log();
    console.log(chalk.bold.white("To upload to your board:"));
    console.log(`  ${chalk.cyan("npm run upload")}`);
    console.log();
    console.log(chalk.bold.white("To run hardware tests:"));
    console.log(`  ${chalk.cyan("npm run test:hw")}`);
    if (!options.port) {
      const portHint = process.platform === 'win32' ? 'COM4' : '/dev/ttyACM0';
      console.log();
      console.log(chalk.dim(`No serial port was set — edit ${chalk.white("cuttlefish.config.ts")} to change ${chalk.white(portHint)} to your port (or pass --port on any command).`));
    }
  }
}
