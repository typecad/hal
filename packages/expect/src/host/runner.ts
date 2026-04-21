// ---------------------------------------------------------------------------
// @typecode/expect — Test runner pipeline
//
// Orchestrates the full test cycle:
//   discover → preprocess → transpile → compile → upload → serial → parse → evaluate → report
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig, RunResult, FileResult } from './types';
import { findTestFiles } from './finder';
import { preprocess } from './preprocessor';
import { transpileTestFile, compileSketch, uploadSketch } from './compiler';
import { readSerialOutput } from './serial';
import { parseProtocolLines } from './parser';
import { reportFileResult, reportResults, reportSummary } from './reporter';

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

  // Validate port
  if (!config.test.port) {
    console.error('Error: No serial port specified. Use --port <port> or set test.port in typecode.config.ts');
    return 2;
  }

  // 2. Process each file sequentially (one compile/upload cycle per file)
  const fileResults: FileResult[] = [];

  for (const filePath of testFiles) {
    const result = await processTestFile(filePath, config);
    fileResults.push(result);
    reportFileResult(result);
  }

  // 3. Aggregate results
  const runResult = aggregateResults(fileResults, Date.now() - startTime);

  // 4. Final summary
  reportSummary(runResult, {
    board: config.board,
    port: config.test.port,
  });

  return runResult.totalFailed > 0 ? 1 : 0;
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

  console.log(`${CYAN}●${RESET} ${relativePath}`);

  // Read source
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return errorResult(filePath, `Failed to read file: ${(e as Error).message}`, startTime);
  }

  // Step 1: Preprocess
  console.log(`  ${DIM}preprocessing...${RESET}`);
  let preprocessed: string;
  try {
    preprocessed = preprocess(source, path.basename(filePath), {
      isAvr: config.target === 'avr' || config.target === 'megaavr',
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
    config.fqbn,
  );
  if (!transpileResult.success) {
    return errorResult(filePath, transpileResult.error ?? 'Transpilation failed', startTime);
  }

  // Step 3: Compile with arduino-cli
  console.log(`  ${DIM}compiling...${RESET}`);
  const compileResult = compileSketch(transpileResult.sketchDir, config.fqbn);
  if (!compileResult.success) {
    return errorResult(filePath, compileResult.error ?? 'Compilation failed', startTime);
  }

  // Step 4: Upload
  console.log(`  ${DIM}uploading to ${config.test.port}...${RESET}`);
  const uploadResult = uploadSketch(
    transpileResult.sketchDir,
    config.fqbn,
    config.test.port,
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

function aggregateResults(files: FileResult[], durationMs: number): RunResult {
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const file of files) {
    for (const desc of file.describes) {
      for (const test of desc.tests) {
        totalTests++;
        if (test.passed) totalPassed++;
        else totalFailed++;
      }
    }
    // Count error files as failures
    if (file.error) {
      totalTests++;
      totalFailed++;
    }
  }

  return {
    files,
    totalTests,
    totalPassed,
    totalFailed,
    durationMs,
  };
}
