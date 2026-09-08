// ---------------------------------------------------------------------------
// cuttlefish test-runner — Vitest-style console reporter
//
// Renders test results to the console with ANSI colors, mimicking vitest's
// output format.
//
// Example output:
//
//  typecad-hal test v0.1.0
//
//  ✓ A0 analog read (2 tests)
//    ✓ reads zero when grounded          2ms
//    ✓ reads less than 100               1ms
//
//  ✗ Temperature sensor (1 of 2 failing)
//    ✓ reads above freezing              3ms
//    ✗ reads room temperature            2ms
//
//      expect(actual).toBeWithinRange(20, 25)
//      Actual:   31
//      Expected: 20–25
//
//  Tests   3 passed | 1 failed (4)
//  Board   Black Pill @ COM3
//  Time    8.42s
// ---------------------------------------------------------------------------

import type { RunResult, FileResult, DescribeResult, TestResult, AssertionResult } from './types.js';
import { describeExpected } from './evaluator.js';

// ---------------------------------------------------------------------------
// ANSI color codes
// ---------------------------------------------------------------------------

const RESET     = '\x1b[0m';
const BOLD      = '\x1b[1m';
const DIM       = '\x1b[2m';
const RED       = '\x1b[31m';
const GREEN     = '\x1b[32m';
const YELLOW    = '\x1b[33m';
const CYAN      = '\x1b[36m';
const WHITE     = '\x1b[37m';
const RED_BG    = '\x1b[41m';
const GREEN_BG  = '\x1b[42m';

const PASS_ICON = `${GREEN}✓${RESET}`;
const FAIL_ICON = `${RED}✗${RESET}`;
const SKIP_ICON = `${YELLOW}↓${RESET}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Print a single test file's results immediately.
 */
export function reportFileResult(
  file: FileResult,
  options: { verbose?: boolean } = {},
): void {
  const verbose = options.verbose ?? false;
  reportFile(file, verbose);

  const failures = collectFailuresFromFile(file);
  if (failures.length > 0) {
    console.log(`${BOLD}${RED} FAILURES${RESET}`);
    console.log();
    for (const f of failures) {
      reportFailure(f);
    }
  }

  console.log();
}

export function reportSummary(
  result: RunResult,
  options: { board?: string; port?: string } = {},
): void {
  const { board, port } = options;
  reportSummarySection(result, board, port);
}

// ---------------------------------------------------------------------------
// Internal — File reporting
// ---------------------------------------------------------------------------

function reportFile(file: FileResult, verbose: boolean): void {
  if (file.skipped) {
    console.log(` ${SKIP_ICON} ${BOLD}${file.filePath}${RESET} ${YELLOW}(skipped)${RESET}`);
    if (verbose && file.skipReason) {
      console.log(`   ${DIM}${file.skipReason}${RESET}`);
    }
    console.log();
    return;
  }

  if (file.error) {
    console.log(` ${FAIL_ICON} ${BOLD}${file.filePath}${RESET} ${RED}(error)${RESET}`);
    console.log(`   ${DIM}${file.error}${RESET}`);
    console.log();
    return;
  }

  if (file.compiled) {
    console.log(` ${PASS_ICON} ${BOLD}${file.filePath}${RESET} ${GREEN}(compiled, dry-run)${RESET}`);
    console.log();
    return;
  }

  for (const desc of file.describes) {
    reportDescribe(desc, verbose);
  }

  // Debug output
  if (verbose && file.debugOutput.length > 0) {
    console.log(`   ${DIM}── serial debug ──${RESET}`);
    for (const line of file.debugOutput) {
      console.log(`   ${DIM}${line}${RESET}`);
    }
    console.log();
  }
}

function reportDescribe(desc: DescribeResult, verbose: boolean): void {
  const totalTests = desc.tests.length;
  const passedTests = desc.tests.filter(t => t.passed).length;
  const failedTests = totalTests - passedTests;

  const icon = desc.passed ? PASS_ICON : FAIL_ICON;
  const countText = desc.passed
    ? `${DIM}(${totalTests} test${totalTests !== 1 ? 's' : ''})${RESET}`
    : `${RED}(${failedTests} of ${totalTests} failing)${RESET}`;

  console.log(` ${icon} ${BOLD}${desc.name}${RESET} ${countText}`);

  for (const test of desc.tests) {
    reportTest(test, verbose);
  }

  console.log();
}

function reportTest(test: TestResult, verbose: boolean): void {
  const icon = test.passed ? PASS_ICON : FAIL_ICON;
  const duration = test.durationMs > 0 ? `${DIM}${test.durationMs}ms${RESET}` : '';
  console.log(`   ${icon} ${test.name}  ${duration}`);

  // In verbose mode, show passing assertion details too
  if (verbose && test.passed) {
    for (const a of test.assertions) {
      console.log(`     ${DIM}${a.matcher}(${a.expected}) → ${a.actual} ✓${RESET}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal — Failure details
// ---------------------------------------------------------------------------

interface FailureInfo {
  describeName: string;
  testName: string;
  assertion: AssertionResult;
}

function collectFailuresFromFile(file: FileResult): FailureInfo[] {
  const failures: FailureInfo[] = [];
  if (file.error) {
    return failures;
  }

  for (const desc of file.describes) {
    for (const test of desc.tests) {
      for (const assertion of test.assertions) {
        if (!assertion.passed) {
          failures.push({
            describeName: desc.name,
            testName: test.name,
            assertion,
          });
        }
      }
    }
  }

  return failures;
}

function reportFailure(f: FailureInfo): void {
  const a = f.assertion;
  console.log(`   ${RED}${BOLD}${f.describeName} > ${f.testName}${RESET}`);
  console.log();
  console.log(`     ${DIM}expect(actual).${a.matcher}(${a.expected})${RESET}`);
  console.log(`     ${RED}Actual:   ${BOLD}${a.actual}${RESET}`);
  console.log(`     ${GREEN}Expected: ${BOLD}${describeExpected(a.matcher, a.expected)}${RESET}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Internal — Summary
// ---------------------------------------------------------------------------

function reportSummarySection(
  result: RunResult,
  board?: string,
  port?: string,
): void {
  // Tests line
  const passedText = result.totalPassed > 0
    ? `${GREEN}${BOLD}${result.totalPassed} passed${RESET}`
    : '';
  const failedText = result.totalFailed > 0
    ? `${RED}${BOLD}${result.totalFailed} failed${RESET}`
    : '';
  const skippedText = result.totalSkipped > 0
    ? `${YELLOW}${BOLD}${result.totalSkipped} skipped${RESET}`
    : '';

  const parts = [passedText, failedText, skippedText].filter(Boolean).join(`${DIM} | ${RESET}`);
  const total = result.totalTests + result.totalSkipped;
  console.log(` ${BOLD}Tests${RESET}   ${parts} ${DIM}(${total})${RESET}`);

  if (result.totalSkipped > 0) {
    const skippedFiles = result.files.filter(file => file.skipped).length;
    const totalFiles = result.files.length;
    console.log(` ${BOLD}Test Files${RESET}  ${YELLOW}${BOLD}${skippedFiles} skipped${RESET} ${DIM}(${totalFiles})${RESET}`);
  }

  // Errors line (compile/upload failures)
  if (result.totalErrors > 0) {
    console.log(` ${BOLD}Errors${RESET}  ${RED}${BOLD}${result.totalErrors} file${result.totalErrors !== 1 ? 's' : ''} failed to build${RESET}`);
  }

  // Board line
  if (board || port) {
    const boardPart = board ?? 'unknown';
    const portPart = port ? ` @ ${port}` : '';
    console.log(` ${BOLD}Board${RESET}   ${boardPart}${portPart}`);
  }

  // Time line
  const seconds = (result.durationMs / 1000).toFixed(2);
  console.log(` ${BOLD}Time${RESET}    ${seconds}s`);

  // Final status bar
  if (result.totalFailed > 0 || result.totalErrors > 0) {
    console.log();
    const failParts: string[] = [];
    if (result.totalFailed > 0) failParts.push(`${result.totalFailed} test${result.totalFailed !== 1 ? 's' : ''} failed`);
    if (result.totalErrors > 0) failParts.push(`${result.totalErrors} build error${result.totalErrors !== 1 ? 's' : ''}`);
    console.log(`${RED_BG}${WHITE}${BOLD} FAIL ${RESET} ${RED}${failParts.join(', ')}${RESET}`);
  } else {
    console.log();
    console.log(`${GREEN_BG}${WHITE}${BOLD} PASS ${RESET} ${GREEN}All tests passed${RESET}`);
  }
}
