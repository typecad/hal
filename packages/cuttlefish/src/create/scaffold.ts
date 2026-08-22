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
  generateStarterSketch,
  generateStarterTest,
  generateStarterSim,
  generateGitignore,
  generateEditorconfig,
  generateBoardForwardingFile,
  generateEslintConfig,
} from "./templates.js";
import { generateEslintRules } from "./eslint-rules-template.js";
import { writeEditorIntegration } from "./editor-integration.js";

export interface KnownTarget {
  id: string;
  displayName: string;
  isNative: boolean;
  architecture?: ArchitectureIdentifier;
  boardPackage?: string;
  /** Framework package + id. Optional on embedded targets: the scaffold wizard
   *  fills these in by discovering installed @typecad/framework-* packages, so
   *  KNOWN_TARGETS board entries do not hardcode a framework. Native targets
   *  set them directly. */
  frameworkPackage?: string;
  framework?: string;
  buildTarget?: string;
  mcu?: string;
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
    id: 'arduino-uno',
    displayName: 'Arduino Uno',
    isNative: false,
    architecture: 'avr',
    boardPackage: '@typecad/board-arduino-uno',
    buildTarget: 'arduino:avr:uno',
    mcu: 'atmega328p',
  },
  {
    id: 'esp32-devkit',
    displayName: 'ESP32 DevKit',
    isNative: false,
    architecture: 'esp32',
    boardPackage: '@typecad/board-esp32-devkit',
    buildTarget: 'esp32:esp32:esp32',
    mcu: 'esp32',
  },
  {
    id: 'esp32s3',
    displayName: 'ESP32-S3',
    isNative: false,
    architecture: 'esp32s3',
    boardPackage: '@typecad/board-esp32s3',
    buildTarget: 'esp32:esp32:esp32s3',
    mcu: 'esp32s3',
  },
  {
    id: 'esp32c3',
    displayName: 'ESP32-C3',
    isNative: false,
    architecture: 'esp32c3',
    boardPackage: '@typecad/board-esp32c3',
    buildTarget: 'esp32:esp32:esp32c3',
    mcu: 'esp32c3',
  },
  {
    id: 'esp32c6',
    displayName: 'ESP32-C6',
    isNative: false,
    architecture: 'esp32c6',
    boardPackage: '@typecad/board-esp32c6',
    buildTarget: 'esp32:esp32:esp32c6',
    mcu: 'esp32c6',
  },
  {
    id: 'rp2040',
    displayName: 'RP2040 (Pico)',
    isNative: false,
    architecture: 'rp2040',
    boardPackage: '@typecad/board-rp2040',
    buildTarget: 'rp2040:rp2040:rpipico',
    mcu: 'rp2040',
  },
  {
    id: 'rp2350',
    displayName: 'RP2350 (Pico 2)',
    isNative: false,
    architecture: 'rp2350',
    boardPackage: '@typecad/board-rp2350',
    buildTarget: 'rp2040:rp2040:rpipico2',
    mcu: 'rp2350',
  },
  {
    id: 'xiao-nrf52840',
    displayName: 'XIAO nRF52840',
    isNative: false,
    architecture: 'nrf52',
    boardPackage: '@typecad/board-xiao-nrf52840',
    // Zephyr-only target: the build target is the `west build -b` board id,
    // not an Arduino FQBN (frameworkTargetProfile resolves it for Zephyr).
    buildTarget: 'xiao_ble/nrf52840',
    mcu: 'nrf52840',
  },
  {
    id: 'blackpill-f411ce',
    displayName: 'Black Pill (STM32F411)',
    isNative: false,
    architecture: 'stm32f411',
    boardPackage: '@typecad/board-blackpill-f411ce',
    // Zephyr-only target: the build target is the `west build -b` board id,
    // not an Arduino FQBN (frameworkTargetProfile resolves it for Zephyr).
    buildTarget: 'blackpill_f411ce/stm32f411xe',
    mcu: 'stm32f411',
  },
];

export function registerKnownTarget(target: KnownTarget): void {
  const existing = _knownTargets.findIndex(t => t.id === target.id);
  if (existing >= 0) {
    _knownTargets[existing] = target;
  } else {
    _knownTargets.push(target);
  }
}

export const KNOWN_TARGETS: ReadonlyArray<KnownTarget> = _knownTargets;

/** @deprecated Use KNOWN_TARGETS */
export const KNOWN_BOARDS = _knownTargets;
/** @deprecated Use KnownTarget */
export type KnownBoard = KnownTarget;

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
  for (const file of writeEditorIntegration(resolvedOutDir)) createdFiles.push(file);

  if (options.boardPackage) {
    const boardFilePath = path.join(cuttlefishDir, 'board.ts');
    fs.writeFileSync(boardFilePath, generateBoardForwardingFile(options.boardPackage), 'utf-8');
    createdFiles.push(boardFilePath);
  }

  if (options.includeSketch) {
    const entryName = 'main.ts';
    const sketchPath = path.join(srcDir, entryName);
    fs.writeFileSync(sketchPath, generateStarterSketch(options), 'utf-8');
    createdFiles.push(sketchPath);
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
    const portHint = process.platform === 'win32' ? 'COM4' : '/dev/ttyACM0';
    console.log();
    console.log(chalk.bold.white("To simulate without hardware:"));
    console.log(`  ${chalk.cyan("npm run simulate")}`);
    console.log();
    console.log(chalk.bold.white("To upload to your board:"));
    console.log(`  ${chalk.cyan("npm run upload")}`);
    console.log();
    console.log(chalk.bold.white("To run hardware tests:"));
    console.log(`  ${chalk.cyan("npm run test:hw")}`);
    console.log();
    console.log(chalk.dim(`Edit ${chalk.white("cuttlefish.config.ts")} to change the serial port from ${chalk.white(portHint)} to your port.`));
  }
}
