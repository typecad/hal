// ---------------------------------------------------------------------------
// Project scaffolding orchestration for `typecode init`
//
// Creates the directory structure and writes all project files.
// Mirrors the pattern in board-scaffold.ts for create-board.
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import type { ArchitectureIdentifier } from "@typecode/core";
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
  /** Fully Qualified Board Name for arduino-cli */
  fqbn: string;
  /** MCU part number */
  mcu: string;
}

/**
 * Static registry of known boards. No network calls needed.
 * New boards are added by contributors. Users who need unlisted boards
 * are directed to `typecode create-board` first.
 */
export const KNOWN_BOARDS: ReadonlyArray<KnownBoard> = [
  {
    id: 'arduino-uno',
    displayName: 'Arduino Uno',
    architecture: 'avr',
    boardPackage: '@typecode/board-arduino-uno',
    frameworkPackage: '@typecode/framework-arduino',
    fqbn: 'arduino:avr:uno',
    mcu: 'ATmega328P',
  },
];

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
 * Scaffold a new TypeCode project.
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
  writeFile('typecode.config.ts', generateProjectConfig(options));
  writeFile('typecode-env.d.ts', generateProjectEnvDts(options));
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
  console.log("Next steps:");
  console.log(`  cd ${relativeDir}`);
  console.log(`  npm install`);
  console.log(`  npx typecode ./src/sketch.ts --compile --fqbn ${options.fqbn}`);
  console.log();
  console.log("To upload to your board:");
  console.log(`  npx typecode ./src/sketch.ts --compile --upload --port ${portHint}`);
  console.log();
  console.log(chalk.gray("To use a different serial port, replace") + " " + chalk.white(portHint) + " " + chalk.gray("with your port."));
}

// Import chalk for colored output (already a CLI dependency)
import chalk from "chalk";
