// ---------------------------------------------------------------------------
// @typecad/expect — Test runner pipeline
//
// Orchestrates the full test cycle:
//   discover → preprocess → transpile → compile → upload → serial → parse → evaluate → report
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig, RunResult, FileResult } from './types.js';
import { findTestFiles } from './finder.js';
import { preprocess, serialShim, zephyrShim } from './preprocessor.js';
import { transpileTestFile, compileSketch, uploadSketch } from './compiler.js';
import { readSerialOutput } from './serial.js';
import { parseProtocolLines } from './parser.js';
import { reportFileResult, reportSummary } from './reporter.js';

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
export async function run(config: ResolvedConfig): Promise<number> {
  const startTime = Date.now();

  // 1. Discover test files
  const testFiles = findTestFiles(config.projectRoot, config.test.include);

  if (testFiles.length === 0) {
    console.log(`${YELLOW}No test files found matching: ${config.test.include.join(', ')}${RESET}`);
    return 0;
  }

  console.log(`${DIM}Found ${testFiles.length} test file${testFiles.length !== 1 ? 's' : ''}${RESET}`);
  console.log();

  // 2. Process each file sequentially (one compile/upload cycle per file)
  const fileResults: FileResult[] = [];

  for (const filePath of testFiles) {
    const result = await processTestFile(filePath, config);
    fileResults.push(result);
    reportFileResult(result, { verbose: config.test.verbose });
    // --bail: stop after the first file that fails to compile/upload or has a
    // failing test (skipped/compiled files don't count as failures).
    if (config.bail && (result.error || (result.describes.length > 0 && !result.passed))) {
      console.log(`${YELLOW}--bail: stopping after first failure${RESET}`);
      break;
    }
  }

  // 3. Aggregate results
  const runResult = aggregateResults(fileResults, Date.now() - startTime);

  // 4. Final summary
  reportSummary(runResult, {
    board: config.board,
    port: config.test.port,
  });

  return (runResult.totalFailed > 0 || runResult.totalErrors > 0) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Internal — Process a single test file through the full pipeline
// ---------------------------------------------------------------------------

async function processTestFile(
  filePath: string,
  config: ResolvedConfig,
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

  // Validate port only for files that will actually compile/upload. This lets
  // target-incompatible files be skipped without requiring hardware to be
  // connected, and lets --dry-run run without any port (it stops after compile).
  if (!config.test.port && !config.dryRun) {
    return errorResult(filePath, 'No serial port specified. Use --port <port> or set test.port in cuttlefish.config.ts', startTime);
  }

  console.log(`${CYAN}●${RESET} ${relativePath}`);

  // Step 1: Preprocess
  console.log(`  ${DIM}preprocessing...${RESET}`);
  let preprocessed: string;
  try {
    preprocessed = preprocess(source, path.basename(filePath), {
      isAvr: config.target === 'avr' || config.target === 'megaavr',
      shim: config.toolchainType === 'west' ? zephyrShim : serialShim,
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
    config.toolchainType,
    config.configPath,
  );
  if (!transpileResult.success) {
    return errorResult(filePath, transpileResult.error ?? 'Transpilation failed', startTime);
  }

  // Step 3: Compile via the configured toolchain (arduino-cli or west)
  console.log(`  ${DIM}compiling...${RESET}`);
  const compileResult = compileSketch(transpileResult.sketchDir, config.buildTarget, config.framework, config.toolchainType, config.zephyrConfig, config.consoleConfig);
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

  // Step 4: Upload via the configured toolchain
  console.log(`  ${DIM}uploading to ${config.test.port}...${RESET}`);
  const uploadResult = uploadSketch(
    transpileResult.sketchDir,
    config.buildTarget,
    config.test.port,
    config.framework,
    config.toolchainType,
    config.zephyrConfig,
  );
  if (!uploadResult.success) {
    return errorResult(filePath, uploadResult.error ?? 'Upload failed', startTime);
  }

  // Step 5: Read serial output
  console.log(`  ${DIM}reading serial output...${RESET}`);
  const serialResult = await readSerialOutput(
    config.test.port,
    config.test.baudRate,
    config.test.timeout,
    config.test.serialOpenDelay,
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

function getSkipReason(source: string, relativePath: string, config: ResolvedConfig): string | undefined {
  const excludedByConfig = config.test.exclude?.find(pattern => matchesTestPattern(relativePath, pattern));
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
