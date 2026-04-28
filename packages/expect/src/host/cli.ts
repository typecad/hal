#!/usr/bin/env node
// ---------------------------------------------------------------------------
// @typehal/expect — CLI entry point
//
// Usage:
//   typehal-test [options] [files...]
//
// Options:
//   --port <port>       Serial port (e.g. COM3, /dev/ttyACM0)
//   --board <board>     Board package override
//   --fqbn <fqbn>       Fully Qualified Board Name override
//   --baud <rate>       Serial baud rate (default: 115200)
//   --timeout <ms>      Serial read timeout in ms (default: 30000)
//   --include <glob>    Test file glob pattern (repeatable)
//   --verbose           Show debug serial output and assertion details
//   --help              Show this help
//
// If no files are given, discovers tests via config include patterns.
// ---------------------------------------------------------------------------

import { loadConfig } from './config';
import { run } from './runner';
import type { TestConfig } from './types';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface CLIArgs {
  files: string[];
  port?: string;
  board?: string;
  fqbn?: string;
  baudRate?: number;
  timeout?: number;
  include?: string[];
  verbose?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const result: CLIArgs = { files: [] };
  const args = argv.slice(2); // skip node + script

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--port':
      case '-p':
        result.port = args[++i];
        break;
      case '--board':
      case '-b':
        result.board = args[++i];
        break;
      case '--fqbn':
        result.fqbn = args[++i];
        break;
      case '--baud': {
        const val = args[++i];
        const num = parseInt(val, 10);
        if (isNaN(num)) {
          console.error(`--baud requires a number, got "${val}"`);
          process.exit(2);
        }
        result.baudRate = num;
        break;
      }
      case '--timeout':
      case '-t': {
        const val = args[++i];
        const num = parseInt(val, 10);
        if (isNaN(num)) {
          console.error(`--timeout requires a number, got "${val}"`);
          process.exit(2);
        }
        result.timeout = num;
        break;
      }
      case '--include':
      case '-i':
        if (!result.include) result.include = [];
        result.include.push(args[++i]);
        break;
      case '--verbose':
      case '-v':
        result.verbose = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          result.files.push(arg);
        } else {
          console.error(`Unknown option: ${arg}`);
          process.exit(2);
        }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP = `
\x1b[1m\x1b[36m typehal-test\x1b[0m — Hardware test runner for TypeHAL

\x1b[1mUsage:\x1b[0m
  typehal-test [options] [files...]

\x1b[1mOptions:\x1b[0m
  --port, -p <port>     Serial port (e.g. COM4, /dev/ttyACM0)
  --board, -b <board>   Board package override
  --fqbn <fqbn>         Fully Qualified Board Name
  --baud <rate>         Serial baud rate (default: 115200)
  --timeout, -t <ms>    Serial read timeout (default: 30000)
  --include, -i <glob>  Test file pattern (repeatable)
  --verbose, -v         Show debug serial output
  --help, -h            Show this help

\x1b[1mExamples:\x1b[0m
  typehal-test --port COM4
  typehal-test --port /dev/ttyACM0 tests/my-test.test.ts
  typehal-test -p COM4 -v

\x1b[1mConfiguration:\x1b[0m
  Add a \`test\` section to your typehal.config.ts:

    const config = {
      board: '@typehal/board-arduino-uno',
      fqbn: 'arduino:avr:uno',
      test: {
        port: 'COM4',
        include: ['tests/**/*.test.ts'],
        baudRate: 115200,
        timeout: 30000,
      },
    };
`.trim();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  const projectRoot = process.cwd();

  // Build config overrides from CLI args
  const overrides: Partial<TestConfig> = {};
  if (args.port) overrides.port = args.port;
  if (args.board) overrides.board = args.board;
  if (args.fqbn) overrides.fqbn = args.fqbn;
  if (args.baudRate) overrides.baudRate = args.baudRate;
  if (args.timeout) overrides.timeout = args.timeout;
  if (args.verbose) overrides.verbose = args.verbose;

  // If files are specified directly, use them as include patterns
  if (args.files.length > 0) {
    overrides.include = args.files.map(f => {
      // Convert relative paths to be relative to project root
      return path.isAbsolute(f) ? path.relative(projectRoot, f) : f;
    });
  } else if (args.include) {
    overrides.include = args.include;
  }

  // Load config
  let config;
  try {
    config = loadConfig(projectRoot, overrides);
  } catch (e) {
    console.error(`\x1b[31m${(e as Error).message}\x1b[0m`);
    process.exit(2);
  }

  // Run tests
  const exitCode = await run(config);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(`\x1b[31mFatal error: ${(e as Error).message}\x1b[0m`);
  process.exit(2);
});
