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
    mcu: 'ATmega328P',
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
    mcu: 'ESP32-WROOM-32',
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

  function writeFile(fileName: string, content: string): string {
    const filePath = path.join(resolvedOutDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    createdFiles.push(filePath);
    return filePath;
  }

  writeFile('package.json', generateProjectPackageJson(options));
  writeFile('tsconfig.json', generateProjectTsconfig(options));
  writeFile('cuttlefish.config.ts', generateProjectConfig(options));
  writeFile('cuttlefish-env.d.ts', generateProjectEnvDts(options));
  writeFile('eslint.config.mjs', generateEslintConfig(options));
  writeFile('eslint-transpiler-rules.mjs', generateEslintRules(options));
  writeFile('.gitignore', generateGitignore(options));

  if (options.boardPackage) {
    fs.mkdirSync(cuttlefishDir, { recursive: true });
    const boardFilePath = path.join(cuttlefishDir, 'board.ts');
    fs.writeFileSync(boardFilePath, generateBoardForwardingFile(options.boardPackage), 'utf-8');
    createdFiles.push(boardFilePath);
  }

  if (options.includeSketch) {
    const entryName = options.isNative ? 'main.ts' : 'sketch.ts';
    const sketchPath = path.join(srcDir, entryName);
    fs.writeFileSync(sketchPath, generateStarterSketch(options), 'utf-8');
    createdFiles.push(sketchPath);
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
    console.log(chalk.bold.white("To upload to your board:"));
    console.log(`  ${chalk.cyan("npm run upload")}`);
    console.log();
    console.log(chalk.dim(`Edit ${chalk.white("package.json")} to change the serial port from ${chalk.white(portHint)} to your port.`));
  }
}
