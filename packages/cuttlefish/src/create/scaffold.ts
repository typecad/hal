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
   *  boardgen input (materialized to .typecad-hal/board.ts at create). */
  board?: string;
  /** Framework package + id. Optional on embedded targets: the scaffold wizard
   *  fills these in by discovering installed @typecad/framework-* packages, so
   *  KNOWN_TARGETS board entries do not hardcode a framework. Native targets
   *  set them directly. */
  frameworkPackage?: string;
  framework?: string;
  buildTarget?: string;
  soc?: string;
  /** Framework-specific config (becomes frameworkData in typecad-hal.config.ts).
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
];

// Bare-silicon (contract) targets were removed with the curated soc layer:
// every embedded target resolves through the board catalog like any other.


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
  const cuttlefishDir = path.join(resolvedOutDir, '.typecad-hal');
  const createdFiles: string[] = [];

  fs.mkdirSync(srcDir, { recursive: true });
  // .typecad-hal/ holds generated boilerplate (env.d.ts, eslint config, board.ts)
  fs.mkdirSync(cuttlefishDir, { recursive: true });

  function writeFile(fileName: string, content: string): string {
    const filePath = path.join(resolvedOutDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    createdFiles.push(filePath);
    return filePath;
  }

  writeFile('package.json', generateProjectPackageJson(options));
  writeFile('tsconfig.json', generateProjectTsconfig(options));
  writeFile('typecad-hal.config.ts', generateProjectConfig(options));
  writeFile('.typecad-hal/typecad-hal-env.d.ts', generateProjectEnvDts(options));
  writeFile('.typecad-hal/eslint.config.mjs', generateEslintConfig(options));
  writeFile('.typecad-hal/eslint-transpiler-rules.mjs', generateEslintRules(options));
  writeFile('.gitignore', generateGitignore(options));
  writeFile('.editorconfig', generateEditorconfig(options));

  // Editor integration: workspace-bundled VS Code extension for .ui syntax
  // highlighting (best-effort — warns and skips if the assets are missing).
  // hideNpm: end-user projects are not npm packages — hide VS Code's NPM
  // Scripts view and npm task detection.
  for (const file of writeEditorIntegration(resolvedOutDir, undefined, true)) createdFiles.push(file);

  if (options.board) {
    // Board-target projects materialize .typecad-hal/board.ts + board.json on
    // the first build (config-loader → the framework's board generator);
    // nothing to write here.
  }

  if (options.includeStarter) {
    const entryName = 'main.ts';
    const entryPath = path.join(srcDir, entryName);
    fs.writeFileSync(entryPath, generateStarterProgram(options), 'utf-8');
    createdFiles.push(entryPath);
  }

  // Embedded projects get a starter hardware test (typecad-hal test).
  // Native projects have no serial/board path, so they get no test setup.
  if (!options.isNative) {
    const testsDir = path.join(resolvedOutDir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    const testPath = path.join(testsDir, '01-basics.test.ts');
    fs.writeFileSync(testPath, generateStarterTest(options), 'utf-8');
    createdFiles.push(testPath);

    // Host-side simulation (@typecad/hal/sim + vitest). sim/ is kept separate
    // from tests/ so `vitest run sim/` never loads the testing DSL no-op
    // stubs, and `typecad-hal test` (which globs tests/) never tries to flash a
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
      console.log(chalk.dim(`No serial port was set — edit ${chalk.white("typecad-hal.config.ts")} to change ${chalk.white(portHint)} to your port (or pass --port on any command).`));
    }
  }
}
