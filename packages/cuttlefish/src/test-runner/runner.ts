// ---------------------------------------------------------------------------
// cuttlefish test-runner — Test runner pipeline
//
// Orchestrates the full test cycle:
//   discover → preprocess → transpile → compile → upload → serial → parse → evaluate → report
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig, RunResult, FileResult } from './types.js';
import { findTestFiles } from './finder.js';
import { preprocess, zephyrShim } from './preprocessor.js';
import { transpileTestFile, compileProgram, uploadProgram } from './compiler.js';
import { readSerialOutput } from './serial.js';
import { parseProtocolLines } from './parser.js';
import { reportFileResult, reportSummary } from './reporter.js';
import { boardTestPins, testPinsRolesOf, buildTestPinsSubstitutions } from './test-pins.js';
import type { TestPinsData } from './test-pins.js';
import {
  resolveUsbPort,
  waitForUsbPort,
  formatUsbIdentity,
  type UsbIdentity,
} from './port-discovery.js';

// ---------------------------------------------------------------------------
// ANSI codes (for inline progress messages)
// ---------------------------------------------------------------------------

const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';
const CYAN  = '\x1b[36m';
const YELLOW = '\x1b[33m';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all test files matching the configuration.
 *
 * @returns Exit code: 0 = all passed, 1 = failures, 2 = error.
 */
/**
 * Per-run mutable context shared across files: the board's test-pins data,
 * the USB identity (config `test.usb` wins over the board's test-pins.json),
 * and the currently-resolved upload port (threaded forward — bridge boards
 * keep it across files; CDC consoles re-resolve after every flash).
 */
interface RunContext {
  boardPins: TestPinsData | undefined;
  usbIdentity: UsbIdentity | undefined;
  uploadPort: string;
}

export async function run(config: ResolvedConfig): Promise<number> {
  const startTime = Date.now();

  // 1. Discover test files
  const testFiles = findTestFiles(config.projectRoot, config.test.include);

  if (testFiles.length === 0) {
    console.log(`${YELLOW}No test files found matching: ${config.test.include.join(', ')}${RESET}`);
    return 0;
  }

  console.log(`${DIM}Found ${testFiles.length} test file${testFiles.length !== 1 ? 's' : ''}${RESET}`);

  // 2. Resolve the board's USB identity and an initial upload port.
  const ctx: RunContext = {
    boardPins: boardTestPins(config.board, config.projectRoot, config.configPath),
    usbIdentity: config.test.usb ?? ctxBoardUsb(config),
    uploadPort: config.test.port,
  };

  if (ctx.usbIdentity) {
    console.log(`${DIM}usb identity ${formatUsbIdentity(ctx.usbIdentity)}${RESET}`);
    const resolved = await resolveUsbPort(ctx.usbIdentity);
    if (resolved.port) {
      if (resolved.port !== ctx.uploadPort) {
        console.log(`${DIM}console port resolved: ${resolved.port}${RESET}`);
      }
      ctx.uploadPort = resolved.port;
    } else if (config.test.port) {
      // Bootstrap/fallback: the currently-flashed firmware may predate this
      // board's PID assignment (or a clone bridge may report a different
      // VID/PID). The post-upload re-resolve will pick the identity up.
      console.log(`${YELLOW}${resolved.error}${RESET}`);
      console.log(`${YELLOW}falling back to configured port ${config.test.port}${RESET}`);
    }
    // west + CDC boards flash via a debug probe, not the console port — the
    // port arrives from the post-flash re-enumeration below.
  }
  console.log();

  // 3. Process each file sequentially (one compile/upload cycle per file)
  const fileResults: FileResult[] = [];
  const MAX_FILE_RETRIES = 2;

  for (const filePath of testFiles) {
    let result = await processTestFile(filePath, config, ctx);
    // Nightly-rig hardening: transient hardware glitches fail a file even
    // though the board is fine — a USB console dropout mid-read loses the
    // protocol lines, debug-probe flashes occasionally fail target
    // examination (OpenOCD "Failed to read memory at 0xe000ed04" under
    // repeated SWD cycles), and a port open right after a failed-flash retry
    // can hit a briefly held handle ("access denied"). A fresh
    // compile/upload/read cycle per file recovers all of these without
    // masking persistent failures (those fail every retry).
    const transientPattern = /Timeout after|Serial error|did not re-appear|west flash failed|Upload failed|Failed to open|Access denied/;
    for (let tries = 0; tries < MAX_FILE_RETRIES; tries++) {
      if (!result.error || !transientPattern.test(result.error) || !ctx.usbIdentity) break;
      const cause = result.error.split('\n').find((l) => l.trim().length > 0) ?? result.error;
      console.log(`${YELLOW}transient console loss (${cause.trim()}) — retrying ${path.relative(config.projectRoot, filePath)} (${tries + 1}/${MAX_FILE_RETRIES})${RESET}`);
      result = await processTestFile(filePath, config, ctx);
    }
    fileResults.push(result);
    reportFileResult(result, { verbose: config.test.verbose });
    // --bail: stop after the first file that fails to compile/upload or has a
    // failing test (skipped/compiled files don't count as failures).
    if (config.bail && (result.error || (result.describes.length > 0 && !result.passed))) {
      console.log(`${YELLOW}--bail: stopping after first failure${RESET}`);
      break;
    }
  }

  // 4. Aggregate results
  const runResult = aggregateResults(fileResults, Date.now() - startTime);

  // 5. Final summary
  reportSummary(runResult, {
    board: config.board,
    port: ctx.uploadPort,
  });

  return (runResult.totalFailed > 0 || runResult.totalErrors > 0) ? 1 : 0;
}

/** The board's test-pins.json usb block, when present. */
function ctxBoardUsb(config: ResolvedConfig): UsbIdentity | undefined {
  const usb = boardTestPins(config.board, config.projectRoot, config.configPath)?.usb;
  return usb ? { ...usb } : undefined;
}

// ---------------------------------------------------------------------------
// Internal — Process a single test file through the full pipeline
// ---------------------------------------------------------------------------

async function processTestFile(
  filePath: string,
  config: ResolvedConfig,
  ctx: RunContext,
): Promise<FileResult> {
  const startTime = Date.now();
  const relativePath = path.relative(config.projectRoot, filePath);

  // Read source
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return errorResult(filePath, `Failed to read file: ${(e as Error).message}`, startTime);
  }

  const skipReason = getSkipReason(source, relativePath, config);
  if (skipReason) {
    return skippedResult(relativePath, skipReason, startTime);
  }

  // The board's test-pins data: role gating for the skip check,
  // substitutions for the preprocessor.
  const testPinsData = ctx.boardPins;
  const missingRolesReason = checkRequiredRoles(source, config, testPinsData);
  if (missingRolesReason) {
    return skippedResult(relativePath, missingRolesReason, startTime);
  }

  // Validate port only for files that will actually compile/upload. A USB
  // identity satisfies this (the port resolves after upload for CDC boards);
  // target-incompatible files still skip without hardware; --dry-run stops
  // after compile and needs no port at all.
  if (!ctx.uploadPort && !ctx.usbIdentity && !config.dryRun) {
    return errorResult(filePath, 'No serial port specified. Use --port <port>, set test.port, or set test.usb in typecad-hal.config.ts', startTime);
  }

  console.log(`${CYAN}●${RESET} ${relativePath}`);

  // Step 1: Preprocess (with test-pin role substitution for this board)
  console.log(`  ${DIM}preprocessing...${RESET}`);
  let preprocessed: string;
  try {
    preprocessed = preprocess(source, path.basename(filePath), {
      shim: zephyrShim,
      testPins: testPinsData ? buildTestPinsSubstitutions(testPinsData) : undefined,
    });
  } catch (e) {
    return errorResult(filePath, `Preprocessing failed: ${(e as Error).message}`, startTime);
  }

  // Step 2: Transpile to C++
  console.log(`  ${DIM}transpiling...${RESET}`);
  const transpileResult = transpileTestFile(
    preprocessed,
    filePath,
    config.projectRoot,
    config.buildTarget,
    config.configPath,
  );
  if (!transpileResult.success) {
    return errorResult(filePath, transpileResult.error ?? 'Transpilation failed', startTime);
  }

  // Step 3: Compile via west (through the Zephyr Toolchain)
  console.log(`  ${DIM}compiling...${RESET}`);
  const compileResult = compileProgram(transpileResult.projectDir, config.buildTarget, config.zephyrConfig, config.framework);
  if (!compileResult.success) {
    return errorResult(filePath, compileResult.error ?? 'Compilation failed', startTime);
  }

  // --dry-run: stop after a successful compile. Skips upload + serial read so
  // the pipeline can be verified without hardware attached.
  if (config.dryRun) {
    const durationMs = Date.now() - startTime;
    console.log(`  ${DIM}compiled (dry-run, skipping upload and tests)${RESET}`);
    return { filePath: relativePath, describes: [], passed: true, durationMs, debugOutput: [], compiled: true };
  }

  // Step 4: Upload via the configured toolchain. With a USB identity active,
  // refresh the resolved port first — a mid-run dropout can leave the
  // threaded port stale (matters for bridge uploads; probes ignore it).
  if (ctx.usbIdentity && ctx.uploadPort) {
    const fresh = await resolveUsbPort(ctx.usbIdentity);
    if (fresh.port && fresh.port !== ctx.uploadPort) {
      console.log(`  ${DIM}console port re-resolved: ${fresh.port}${RESET}`);
      ctx.uploadPort = fresh.port;
    }
  }

  console.log(`  ${DIM}uploading${ctx.uploadPort ? ` to ${ctx.uploadPort}` : ''}...${RESET}`);
const uploadResult = uploadProgram(
  transpileResult.projectDir,
    config.buildTarget,
    ctx.uploadPort,
    config.zephyrConfig,
    config.framework,
  );
  if (!uploadResult.success) {
    return errorResult(filePath, uploadResult.error ?? 'Upload failed', startTime);
  }

  // Step 4b: Re-resolve the console port. CDC consoles re-enumerate after a
  // flash and may return under a different COM/tty number; bridge boards
  // (Uno/ESP32 devkits) keep their port. The identity-based lookup settles
  // after serialOpenDelay and then polls briefly for the re-enumeration.
  let readPort = ctx.uploadPort;
  let readOpenDelay = config.test.serialOpenDelay;
  if (ctx.usbIdentity) {
    console.log(`  ${DIM}waiting for ${formatUsbIdentity(ctx.usbIdentity)} to re-enumerate...${RESET}`);
    const settled = await waitForUsbPort(ctx.usbIdentity, config.test.serialOpenDelay ?? 500);
    if (settled) {
      if (settled !== readPort) {
        console.log(`  ${DIM}console port re-resolved: ${settled}${RESET}`);
      }
      readPort = settled;
      ctx.uploadPort = settled;
      // The settle wait above already covered the open delay.
      readOpenDelay = 250;
    } else if (readPort) {
      console.log(`${YELLOW}USB port for ${formatUsbIdentity(ctx.usbIdentity)} did not re-appear — reading ${readPort}${RESET}`);
    } else {
      return errorResult(
        filePath,
        `USB port for ${formatUsbIdentity(ctx.usbIdentity)} did not re-appear after upload`,
        startTime,
      );
    }
  }

  // Step 5: Read serial output
  console.log(`  ${DIM}reading serial output...${RESET}`);
  const serialResult = await readSerialOutput(
    readPort ?? '',
    config.test.baudRate,
    config.test.timeout,
    readOpenDelay,
    { resetAfterOpen: config.test.resetAfterOpen ?? config.target === 'esp32' },
  );

  if (serialResult.error && !serialResult.completed) {
    return errorResult(filePath, serialResult.error, startTime);
  }

  // Step 6: Parse protocol lines
  const describes = parseProtocolLines(serialResult.protocolLines);

  const durationMs = Date.now() - startTime;
  const passed = describes.every(d => d.passed);

  return {
    filePath: relativePath,
    describes,
    passed,
    durationMs,
    debugOutput: serialResult.debugLines,
  };
}

// ---------------------------------------------------------------------------
// Internal — Helpers
// ---------------------------------------------------------------------------

function errorResult(filePath: string, error: string, startTime: number): FileResult {
  return {
    filePath,
    describes: [],
    passed: false,
    durationMs: Date.now() - startTime,
    debugOutput: [],
    error,
  };
}

function skippedResult(filePath: string, reason: string, startTime: number): FileResult {
  return {
    filePath,
    describes: [],
    passed: true,
    durationMs: Date.now() - startTime,
    debugOutput: [],
    skipped: true,
    skipReason: reason,
  };
}

function aggregateResults(files: FileResult[], durationMs: number): RunResult {
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  for (const file of files) {
    if (file.skipped) {
      totalSkipped++;
      continue;
    }
    for (const desc of file.describes) {
      for (const test of desc.tests) {
        totalTests++;
        if (test.passed) totalPassed++;
        else totalFailed++;
      }
    }
    if (file.error) {
      totalErrors++;
    }
  }

  return {
    files,
    totalTests,
    totalPassed,
    totalFailed,
    totalErrors,
    totalSkipped,
    durationMs,
  };
}

/**
 * Skip files whose required test-pins roles are not provided by the
 * configured board. Directive form (roles from test-pins.json schema):
 *   // @typecad-requires-roles pwm, pwmAlt
 */
function checkRequiredRoles(source: string, config: ResolvedConfig, testPinsData: ReturnType<typeof boardTestPins>): string | undefined {
  const match = source.match(/@typecad-requires-roles\s+([A-Za-z0-9_,\s]+)/);
  if (!match) return undefined;

  const required = match[1]
    .split(/[,\s]+/)
    .map(r => r.trim())
    .filter(Boolean);
  if (required.length === 0) return undefined;

  if (!testPinsData) {
    return `${config.board} ships no test-pins.json — cannot provide roles: ${required.join(', ')}`;
  }

  const roles = testPinsRolesOf(testPinsData);
  const missing = required.filter(role => !roles.has(role));
  if (missing.length > 0) {
    return `board ${config.board} does not provide test-pins role(s): ${missing.join(', ')}`;
  }

  return undefined;
}

function getSkipReason(source: string, relativePath: string, config: ResolvedConfig): string | undefined {  const excludedByConfig = config.test.exclude?.find(pattern => matchesTestPattern(relativePath, pattern));
  if (excludedByConfig) {
    return `matched test.exclude pattern '${excludedByConfig}'`;
  }

  const skipTarget = findTargetDirective(source, 'typecad-skip-target');
  if (skipTarget && targetListMatches(skipTarget.targets, config)) {
    return skipTarget.reason ?? `skipped for target '${targetLabel(config)}'`;
  }

  const onlyTarget = findTargetDirective(source, 'typecad-only-target');
  if (onlyTarget && !targetListMatches(onlyTarget.targets, config)) {
    return onlyTarget.reason ?? `requires target '${onlyTarget.targets.join(', ')}'`;
  }

  return undefined;
}

function findTargetDirective(
  source: string,
  directive: 'typecad-skip-target' | 'typecad-only-target',
): { targets: string[]; reason?: string } | undefined {
  const re = new RegExp(`@${directive}\\s+([^:\\r\\n]+)(?::\\s*(.*))?`, 'i');
  const match = source.match(re);
  if (!match) return undefined;

  const targets = match[1]
    .split(/[,\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (targets.length === 0) return undefined;
  return { targets, reason: match[2]?.trim() || undefined };
}

function targetListMatches(targets: string[], config: ResolvedConfig): boolean {
  const tokens = new Set<string>();
  if (config.target) tokens.add(config.target.toLowerCase());
  if (config.buildTarget) {
    const buildTarget = config.buildTarget.toLowerCase();
    tokens.add(buildTarget);
    const parts = buildTarget.split(':');
    if (parts[0]) tokens.add(parts[0]);
    if (parts[1]) tokens.add(parts[1]);
    if (parts[2]) tokens.add(parts[2]);
  }
  if (config.board) {
    const board = config.board.toLowerCase();
    tokens.add(board);
    const lastSegment = board.split('/').pop();
    if (lastSegment) tokens.add(lastSegment);
  }

  return targets.some(target => target === '*' || tokens.has(target.toLowerCase()));
}

function targetLabel(config: ResolvedConfig): string {
  return config.buildTarget || config.target || config.board || 'unknown';
}

function matchesTestPattern(relativePath: string, pattern: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  if (!normalizedPattern.includes('*') && !normalizedPattern.includes('?')) {
    return normalizedPath === normalizedPattern;
  }
  return globToRegex(normalizedPattern).test(normalizedPath);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\?/g, '[^/]')
    .replace(/\*\*\//g, '(.+/)?')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${pattern}$`);
}
