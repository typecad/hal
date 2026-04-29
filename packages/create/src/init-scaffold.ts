// ---------------------------------------------------------------------------
// Project scaffolding orchestration for `typehal init`
//
// Creates the directory structure and writes all project files.
// Mirrors the pattern in board-scaffold.ts for create-board.
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import type { ArchitectureIdentifier } from "./types";
import type { InitProjectOptions } from "./init-templates";
import {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateGitignore,
} from "./init-templates";

// ---------------------------------------------------------------------------
// Built-in board registry
// ---------------------------------------------------------------------------

export interface KnownBoard {
  /** Unique identifier (e.g., 'arduino-uno') */
  id: string;
  /** Human-readable name (e.g., 'Arduino Uno') */
  displayName: string;
  /** Target architecture */
  architecture: ArchitectureIdentifier;
  /** npm package name for the board */
  boardPackage: string;
  /** Default framework package */
  frameworkPackage: string;
  /** Fully Qualified Board Name for toolchain (optional, framework-specific) */
  buildTarget?: string;
  /** MCU part number */
  mcu: string;
}

const _knownBoards: KnownBoard[] = [
  {
    id: 'arduino-uno',
    displayName: 'Arduino Uno',
    architecture: 'avr',
    boardPackage: '@typehal/board-arduino-uno',
    frameworkPackage: '@typehal/framework-arduino',
    buildTarget: 'arduino:avr:uno',
    mcu: 'ATmega328P',
  },
  {
    id: 'esp32-devkit',
    displayName: 'ESP32 DevKit',
    architecture: 'esp32',
    boardPackage: '@typehal/board-esp32-devkit',
    frameworkPackage: '@typehal/framework-arduino',
    buildTarget: 'esp32:esp32:esp32',
    mcu: 'ESP32-WROOM-32',
  },
];

/**
 * Register a board for use in `typehal init`.
 * Framework/board packages call this at load time to make themselves
 * discoverable by the scaffolding wizard.
 */
export function registerKnownBoard(board: KnownBoard): void {
  const existing = _knownBoards.findIndex(b => b.id === board.id);
  if (existing >= 0) {
    _knownBoards[existing] = board;
  } else {
    _knownBoards.push(board);
  }
}

/**
 * Known boards available for project scaffolding.
 * Includes built-in defaults (Arduino Uno, ESP32 DevKit) plus any
 * boards registered via `registerKnownBoard()`.
 */
export const KNOWN_BOARDS: ReadonlyArray<KnownBoard> = _knownBoards;

// ---------------------------------------------------------------------------
// Project name validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a project name.
 * - Converts to lowercase
 * - Replaces spaces and underscores with hyphens
 * - Removes invalid characters
 */
export function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Scaffold orchestration
// ---------------------------------------------------------------------------

export interface ScaffoldProjectResult {
  /** Absolute paths of all created files */
  createdFiles: string[];
  /** The resolved output directory */
  outDir: string;
  /** The options used for scaffolding */
  options: InitProjectOptions;
}

/**
 * Scaffold a new TypeHAL project.
 *
 * Creates the directory structure and writes all project files.
 * Returns the list of created file paths.
 */
export function scaffoldProject(
  options: InitProjectOptions,
  outDir?: string,
): ScaffoldProjectResult {
  const resolvedOutDir = outDir
    ? path.resolve(outDir)
    : path.resolve(process.cwd(), options.projectName);

  // Safety check: refuse to overwrite an existing directory with content
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
  const createdFiles: string[] = [];

  // Ensure directories exist
  fs.mkdirSync(srcDir, { recursive: true });

  // Helper to write a file and track it
  function writeFile(fileName: string, content: string): string {
    const filePath = path.join(resolvedOutDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    createdFiles.push(filePath);
    return filePath;
  }

  // Generate all project files
  writeFile('package.json', generateProjectPackageJson(options));
  writeFile('tsconfig.json', generateProjectTsconfig(options));
  writeFile('typehal.config.ts', generateProjectConfig(options));
  writeFile('typehal-env.d.ts', generateProjectEnvDts(options));
  writeFile('.gitignore', generateGitignore(options));

  // Optional starter sketch
  if (options.includeSketch) {
    const sketchPath = path.join(srcDir, 'sketch.ts');
    fs.writeFileSync(sketchPath, generateStarterSketch(options), 'utf-8');
    createdFiles.push(sketchPath);
  }

  return { createdFiles, outDir: resolvedOutDir, options };
}

// ---------------------------------------------------------------------------
// Next-steps printer
// ---------------------------------------------------------------------------

/**
 * Print "Next steps" instructions after scaffolding.
 */
export function printInitNextSteps(options: InitProjectOptions, outDir: string): void {
  const relativeDir = path.relative(process.cwd(), outDir) || '.';
  const portHint = process.platform === 'win32' ? 'COM4' : '/dev/ttyACM0';

  console.log();
  console.log(chalk.cyan(`⤳ typeHAL`));
  console.log();
  console.log(chalk.bold.white("Next steps:"));
  console.log(chalk.dim(`  cd ${relativeDir}`));
  console.log(chalk.dim(`  npm install`));
  console.log(`  ${chalk.cyan("npm run compile")}`);
  console.log();
  console.log(chalk.bold.white("To upload to your board:"));
  console.log(`  ${chalk.cyan("npm run upload")}`);
  console.log();
  console.log(chalk.dim(`Edit ${chalk.white("package.json")} to change the serial port from ${chalk.white(portHint)} to your port.`));
}
