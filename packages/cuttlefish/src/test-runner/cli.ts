#!/usr/bin/env node
// ---------------------------------------------------------------------------
// cuttlefish test-runner — CLI entry point
//
// Usage:
//   typecad-hal test [options] [files...]
//
// Options:
//   --port <port>       Serial port (e.g. COM3, /dev/ttyACM0)
//   --board <board>     Board package override
//   --build-target <id> Framework-specific build target override
//   --baud <rate>       Serial baud rate (default: 115200)
//   --timeout <ms>      Serial read timeout in ms (default: 30000)
//   --include <glob>    Test file glob pattern (repeatable)
//   --exclude <glob>    Test file glob pattern to skip (repeatable)
//   --verbose           Show debug serial output and assertion details
//   --help              Show this help
//
// If no files are given, discovers tests via config include patterns.
// ---------------------------------------------------------------------------

import { loadConfig } from './config.js';
import { run } from './runner.js';
import { boardTestPins } from './test-pins.js';
import { listUsbSerialPorts, matchUsbPorts, formatUsbIdentity } from './port-discovery.js';
import type { TestConfig } from './types.js';
import { resolveProjectRoot } from './project-root.js';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface CLIArgs {
  files: string[];
  port?: string;
  board?: string;
  buildTarget?: string;
  baudRate?: number;
  timeout?: number;
  include?: string[];
  exclude?: string[];
  verbose?: boolean;
  help?: boolean;
  config?: string;
  dryRun?: boolean;
  bail?: boolean;
  discover?: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const result: CLIArgs = { files: [] };
  const args = argv.slice(2); // skip node + script

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--config':
        result.config = args[++i];
        break;
      case '--port':
      case '-p':
        result.port = args[++i];
        break;
      case '--board':
      case '-b':
        result.board = args[++i];
        break;
      case '--build-target':
        result.buildTarget = args[++i];
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
      case '--exclude':
      case '-x':
        if (!result.exclude) result.exclude = [];
        result.exclude.push(args[++i]);
        break;
      case '--verbose':
      case '-v':
        result.verbose = true;
        break;
      case '--discover':
        result.discover = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--bail':
        result.bail = true;
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
\x1b[1m\x1b[36m typecad-hal test\x1b[0m — Hardware test runner for TypeCAD

\x1b[1mUsage:\x1b[0m
  typecad-hal test [options] [files...]

\x1b[1mOptions:\x1b[0m
  --port, -p <port>     Serial port (e.g. COM4, /dev/ttyACM0)
  --board, -b <board>   Board package override
  --build-target <id>   Framework-specific build target override
  --baud <rate>         Serial baud rate (default: 115200)
  --timeout, -t <ms>    Serial read timeout (default: 30000)
  --include, -i <glob>  Test file pattern (repeatable)
  --exclude, -x <glob>  Test file pattern to skip (repeatable)
  --verbose, -v         Show debug serial output
  --discover            List attached USB serial ports (VID:PID, serial,
                        manufacturer) and which one the current config/board
                        identity matches, then exit — test-box bring-up aid
  --help, -h            Show this help

\x1b[1mExamples:\x1b[0m
  typecad-hal test --port COM4
  typecad-hal test --port /dev/ttyACM0 tests/my-test.test.ts
  typecad-hal test -p COM4 -v

\x1b[1mConfiguration:\x1b[0m
  Add a \`test\` section to your typecad-hal.config.ts:

    const config = {
      board: 'xiao_ble/nrf52840',
      test: {
        buildTarget: 'blackpill/stm32f411ce',
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

  // npm exec / npm run reset the child cwd to the npm local prefix (the
  // nearest package.json ancestor), stashing the real invocation dir in
  // INIT_CWD — resolve through it so nested suite dirs work under npx.
  // See host/project-root.ts for the full rationale.
  const projectRoot = resolveProjectRoot();

  // Build config overrides from CLI args
  const overrides: Partial<TestConfig> = {};
  if (args.port) overrides.port = args.port;
  if (args.board) overrides.board = args.board;
  if (args.buildTarget) overrides.buildTarget = args.buildTarget;
  if (args.baudRate) overrides.baudRate = args.baudRate;
  if (args.timeout) overrides.timeout = args.timeout;
  if (args.verbose) overrides.verbose = args.verbose;
  if (args.exclude) overrides.exclude = args.exclude;

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
    const configPath = args.config
      ? (path.isAbsolute(args.config) ? args.config : path.resolve(projectRoot, args.config))
      : undefined;
    config = loadConfig(projectRoot, overrides, configPath);
  } catch (e) {
    console.error(`\x1b[31m${(e as Error).message}\x1b[0m`);
    process.exit(2);
  }

  // CLI mode flags (not config-file settings).
  config.dryRun = args.dryRun;
  config.bail = args.bail;

  // --discover: list attached USB serial ports and annotate the match for
  // the active board identity (config test.usb, else the board's
  // test-pins.json usb block). Bring-up aid for multi-board test boxes.
  if (args.discover) {
    const ports = await listUsbSerialPorts();
    const identity = config.test.usb ?? boardTestPins(config.board, config.projectRoot, config.configPath)?.usb;
    const matches = identity ? matchUsbPorts(ports, identity) : [];
    console.log('USB serial ports:');
    if (ports.length === 0) {
      console.log('  (none found)');
    }
    for (const p of ports) {
      const isMatch = identity ? matchUsbPorts([p], identity).length > 0 : false;
      const id = `${p.vid.toUpperCase()}:${p.pid.toUpperCase()}`;
      const serial = p.serialNumber ? ` serial ${p.serialNumber}` : '';
      const mfr = p.manufacturer ? ` [${p.manufacturer}]` : '';
      console.log(`  ${p.path}  ${id}${serial}${mfr}${isMatch ? '  <-- matches this config' : ''}`);
    }
    console.log();
    if (identity) {
      console.log(matches.length === 1
        ? `config identity ${formatUsbIdentity(identity)} -> ${matches[0].path}`
        : `config identity ${formatUsbIdentity(identity)} -> no unique match (${matches.length} found)`);
    } else {
      console.log('(no USB identity on this config or board — set test.usb or a test-pins.json usb block)');
    }
    // Exit 1 when an identity is set but has no unique match, so scripts
    // can gate on discovery success.
    process.exit(identity ? (matches.length === 1 ? 0 : 1) : 0);
  }

  // Run tests
  const exitCode = await run(config);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(`\x1b[31mFatal error: ${(e as Error).message}\x1b[0m`);
  process.exit(2);
});
