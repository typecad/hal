#!/usr/bin/env node
// ---------------------------------------------------------------------------
// @typecode/create — Standalone project scaffolding entry point
//
// Usage: npx @typecode/create [project-name] [options]
//        npx @typecode/create init [project-name] [options]
//
// This is a lightweight alternative to `typecode init` that doesn't require
// the full transpiler toolchain. Only depends on chalk + node built-ins.
// ---------------------------------------------------------------------------

import path from "node:path";
import { scaffoldProject, printInitNextSteps, KNOWN_BOARDS } from "./init-scaffold";
import { runInitWizard } from "./init-wizard";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Minimal argument parser
// ---------------------------------------------------------------------------

interface CreateOptions {
  projectName?: string;
  board?: string;
  framework?: string;
  baud?: number;
  noSketch?: boolean;
  outDir?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): CreateOptions {
  const args = argv.slice(2);
  const options: CreateOptions = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--board' || arg === '-b') {
      options.board = args[++i];
    } else if (arg === '--framework' || arg === '-f') {
      options.framework = args[++i];
    } else if (arg === '--baud') {
      const val = parseInt(args[++i], 10);
      if (!Number.isNaN(val)) options.baud = val;
    } else if (arg === '--no-sketch') {
      options.noSketch = true;
    } else if (arg === '--outDir' || arg === '-o') {
      options.outDir = args[++i];
    } else if (arg === 'init') {
      // Allow "npx @typecode/create init ..." — skip the subcommand
    } else if (!arg.startsWith('-')) {
      options.projectName = arg;
    }

    i++;
  }

  return options;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log();
  console.log(`${chalk.cyan("Usage:")} npx @typecode/create [project-name] [options]`);
  console.log(`       npx @typecode/create init [project-name] [options]`);
  console.log();
  console.log(`${chalk.cyan("Options:")}`);
  console.log(`  --board, -b <id>       Board (arduino-uno, esp32-devkit). Skips wizard.`);
  console.log(`  --framework, -f <id>   Framework (arduino, avr).`);
  console.log(`  --baud <rate>          Serial baud rate (default: 9600).`);
  console.log(`  --no-sketch            Skip generating the starter sketch.`);
  console.log(`  --outDir, -o <dir>     Output directory.`);
  console.log(`  --help, -h             Show this help.`);
  console.log();
  console.log(`${chalk.cyan("Boards:")}`);
  for (const board of KNOWN_BOARDS) {
    console.log(`  ${board.id.padEnd(16)} ${board.displayName} (${board.architecture.toUpperCase()})`);
  }
  console.log();
  console.log(`${chalk.gray("Without --board, launches an interactive wizard.")}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runCreate(argv?: string[]): Promise<void> {
  const options = parseArgs(argv ?? process.argv);

  if (options.help) {
    printHelp();
    return;
  }

  try {
    // Check if we have enough flags for non-interactive mode
    const hasBoard = !!options.board;

    if (hasBoard) {
      // Non-interactive mode: resolve board from registry
      const board = KNOWN_BOARDS.find(b => b.id === options.board);
      if (!board) {
        const available = KNOWN_BOARDS.map(b => `  - ${b.id} (${b.displayName})`).join("\n");
        throw new Error(
          `Unknown board '${options.board}'. Available boards:\n${available}`,
        );
      }

      const framework: 'arduino' | 'avr' = options.framework === 'avr' ? 'avr' : 'arduino';
      const frameworkPackage = framework === 'avr'
        ? '@typecode/framework-avr'
        : '@typecode/framework-arduino';

      const projectName = options.projectName || 'my-project';

      const result = scaffoldProject({
        projectName,
        boardId: board.id,
        boardDisplayName: board.displayName,
        architecture: board.architecture,
        boardPackage: board.boardPackage,
        frameworkPackage,
        framework,
        fqbn: board.fqbn,
        mcu: board.mcu,
        baudRate: options.baud ?? 9600,
        includeSketch: !options.noSketch,
      }, options.outDir);

      console.log("\nCreated project files:");
      for (const file of result.createdFiles) {
        const relative = path.relative(process.cwd(), file);
        console.log(`  ${relative || file}`);
      }

      printInitNextSteps(result.options, result.outDir);
    } else {
      // Interactive mode: launch wizard
      console.log("Launching interactive project setup...\n");
      const wizardResult = await runInitWizard({
        projectName: options.projectName,
        board: options.board,
        framework: options.framework,
        baud: options.baud,
        noSketch: options.noSketch,
      });

      if (!wizardResult) {
        console.log("Project setup cancelled.");
        return;
      }

      const result = scaffoldProject(wizardResult, options.outDir);

      console.log("\nCreated project files:");
      for (const file of result.createdFiles) {
        const relative = path.relative(process.cwd(), file);
        console.log(`  ${relative || file}`);
      }

      printInitNextSteps(result.options, result.outDir);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error creating project: ${message}`);
    process.exitCode = 1;
  }
}

// Run directly when executed as a CLI, not when imported
if (process.argv[1]?.endsWith('create.js')) {
  runCreate();
}
