import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import type { ArchitectureIdentifier } from "../api/index.js";
import type { InitProjectOptions } from "./init-templates.js";
import {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateStarterTest,
  generateStarterSim,
  generateGitignore,
  generateBoardForwardingFile,
  generateEslintConfig,
} from "./init-templates.js";
import { generateEslintRules } from "./eslint-rules-template.js";

export interface KnownTarget {
  id: string;
  displayName: string;
  isNative: boolean;
  architecture?: ArchitectureIdentifier;
  boardPackage?: string;
  frameworkPackage: string;
  framework: string;
  buildTarget?: string;
  mcu?: string;
  /** Framework-specific config (becomes frameworkData in cuttlefish.config.ts).
   *  Used by framework-esp32 to carry `target: 'esp32'|'esp32s3'|'esp32c3'|'esp32c6'`. */
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
    frameworkPackage: '@typecad/framework-arduino',
    framework: 'arduino',
    buildTarget: 'arduino:avr:uno',
    mcu: 'atmega328p',
  },
  {
    id: 'esp32-devkit',
    displayName: 'ESP32 DevKit',
    isNative: false,
    architecture: 'esp32',
    boardPackage: '@typecad/board-esp32-devkit',
    frameworkPackage: '@typecad/framework-arduino',
    framework: 'arduino',
    buildTarget: 'esp32:esp32:esp32',
    mcu: 'esp32',
  },
  {
    id: 'esp32-devkit-idf',
    displayName: 'ESP32 DevKit (native ESP-IDF)',
    isNative: false,
    architecture: 'esp32',
    boardPackage: '@typecad/board-esp32-devkit',
    frameworkPackage: '@typecad/framework-esp32',
    framework: 'esp32',
    buildTarget: 'esp32:esp32:esp32',
    mcu: 'esp32',
    frameworkData: { target: 'esp32' },
  },
  {
    id: 'esp32s3',
    displayName: 'ESP32-S3',
    isNative: false,
    architecture: 'esp32s3',
    boardPackage: '@typecad/board-esp32s3',
    frameworkPackage: '@typecad/framework-arduino',
    framework: 'arduino',
    buildTarget: 'esp32:esp32:esp32s3',
    mcu: 'esp32s3',
  },
  {
    id: 'esp32s3-idf',
    displayName: 'ESP32-S3 (native ESP-IDF)',
    isNative: false,
    architecture: 'esp32s3',
    boardPackage: '@typecad/board-esp32s3',
    frameworkPackage: '@typecad/framework-esp32',
    framework: 'esp32',
    buildTarget: 'esp32:esp32:esp32s3',
    mcu: 'esp32s3',
    frameworkData: { target: 'esp32s3' },
  },
  {
    id: 'esp32c3',
    displayName: 'ESP32-C3',
    isNative: false,
    architecture: 'esp32c3',
    boardPackage: '@typecad/board-esp32c3',
    frameworkPackage: '@typecad/framework-arduino',
    framework: 'arduino',
    buildTarget: 'esp32:esp32:esp32c3',
    mcu: 'esp32c3',
  },
  {
    id: 'esp32c3-idf',
    displayName: 'ESP32-C3 (native ESP-IDF)',
    isNative: false,
    architecture: 'esp32c3',
    boardPackage: '@typecad/board-esp32c3',
    frameworkPackage: '@typecad/framework-esp32',
    framework: 'esp32',
    buildTarget: 'esp32:esp32:esp32c3',
    mcu: 'esp32c3',
    frameworkData: { target: 'esp32c3' },
  },
  {
    id: 'esp32c6',
    displayName: 'ESP32-C6',
    isNative: false,
    architecture: 'esp32c6',
    boardPackage: '@typecad/board-esp32c6',
    frameworkPackage: '@typecad/framework-arduino',
    framework: 'arduino',
    buildTarget: 'esp32:esp32:esp32c6',
    mcu: 'esp32c6',
  },
  {
    id: 'esp32c6-idf',
    displayName: 'ESP32-C6 (native ESP-IDF)',
    isNative: false,
    architecture: 'esp32c6',
    boardPackage: '@typecad/board-esp32c6',
    frameworkPackage: '@typecad/framework-esp32',
    framework: 'esp32',
    buildTarget: 'esp32:esp32:esp32c6',
    mcu: 'esp32c6',
    frameworkData: { target: 'esp32c6' },
  },
  {
    id: 'rp2040',
    displayName: 'RP2040 (Pico)',
    isNative: false,
    architecture: 'rp2040',
    boardPackage: '@typecad/board-rp2040',
    frameworkPackage: '@typecad/framework-arduino',
    framework: 'arduino',
    buildTarget: 'rp2040:rp2040:rpipico',
    mcu: 'rp2040',
  },
  {
    id: 'rp2350',
    displayName: 'RP2350 (Pico 2)',
    isNative: false,
    architecture: 'rp2350',
    boardPackage: '@typecad/board-rp2350',
    frameworkPackage: '@typecad/framework-arduino',
    framework: 'arduino',
    buildTarget: 'rp2040:rp2040:rpipico2',
    mcu: 'rp2350',
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
  options: InitProjectOptions;
}

export function scaffoldProject(
  options: InitProjectOptions,
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

export function printInitNextSteps(options: InitProjectOptions, outDir: string): void {
  const relativeDir = path.relative(process.cwd(), outDir) || '.';

  console.log();
  console.log(chalk.cyan(`⤳ Cuttlefish`));
  console.log();
  console.log(chalk.bold.white("Next steps:"));
  console.log(chalk.dim(`  cd ${relativeDir}`));
  console.log(chalk.dim(`  npm install`));
  console.log(`  ${chalk.cyan("npm run compile")}`);

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
