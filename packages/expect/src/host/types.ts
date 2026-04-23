// ---------------------------------------------------------------------------
// @typecode/expect — Host-side types
//
// Internal type definitions used by the host runner (Node.js process) to
// represent parsed serial output, assertion results, and test reports.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Serial protocol
// ---------------------------------------------------------------------------

/** The prefix that every protocol line starts with. */
export const PROTOCOL_PREFIX = '[TC:';
export const PROTOCOL_SUFFIX = ']';

/**
 * All protocol line types emitted by firmware.
 */
export type ProtocolTag =
  | 'SUITE_START'
  | 'DESCRIBE'
  | 'IT'
  | 'EXPECT'
  | 'SUITE_END';

/**
 * A single parsed protocol line.
 */
export interface ProtocolLine {
  tag: ProtocolTag;
  /** Payload segments (split on `:` after the tag). */
  fields: string[];
  /** The original raw line from serial. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Assertion results
// ---------------------------------------------------------------------------

/**
 * All supported matcher names.
 */
export type MatcherName =
  | 'toBe'
  | 'toBeGreaterThan'
  | 'toBeGreaterThanOrEqual'
  | 'toBeLessThan'
  | 'toBeLessThanOrEqual'
  | 'toBeCloseTo'
  | 'toBeWithinRange'
  | 'toBeTruthy'
  | 'toBeFalsy'
  | 'toNotBe'
  | 'toContain'
  | 'toHaveLength';

/**
 * A single assertion result after host-side evaluation.
 */
export interface AssertionResult {
  matcher: MatcherName;
  /** Expected value(s) as raw string from serial. */
  expected: string;
  /** Actual value as raw string from serial. */
  actual: string;
  /** Whether the assertion passed. */
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Test results
// ---------------------------------------------------------------------------

/**
 * A single `it(...)` test case result.
 */
export interface TestResult {
  name: string;
  assertions: AssertionResult[];
  /** Whether all assertions passed. */
  passed: boolean;
  /** Time between IT start and next IT / describe end (ms). */
  durationMs: number;
}

/**
 * A single `describe(...)` group result.
 */
export interface DescribeResult {
  name: string;
  tests: TestResult[];
  /** Whether all tests passed. */
  passed: boolean;
}

/**
 * Result of running one test file.
 */
export interface FileResult {
  filePath: string;
  describes: DescribeResult[];
  passed: boolean;
  durationMs: number;
  /** Non-test serial output (lines without [TC: prefix). */
  debugOutput: string[];
  /** If the file didn't compile or upload. */
  error?: string;
}

/**
 * Result of the entire test run.
 */
export interface RunResult {
  files: FileResult[];
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  /** Pipeline errors (compile/upload failures) — tracked separately from test failures. */
  totalErrors: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Test-specific configuration — the `test` section of `typecode.config.ts`.
 */
export interface TestConfig {
  /** Glob patterns for test files. Default: `['tests/**\/*.test.ts']`. */
  include: string[];
  /** Serial port (e.g. `'COM3'`, `'/dev/ttyACM0'`). */
  port: string;
  /** Serial baud rate. Default: `115200`. */
  baudRate: number;
  /** Timeout in ms waiting for SUITE_END. Default: `30000`. */
  timeout: number;
  /** Delay in ms before opening serial port (after board reset). Default: `500`. */
  serialOpenDelay?: number;
  /** Fully Qualified Board Name override (e.g. `'arduino:avr:uno'`). */
  fqbn?: string;
  /** Board package override. */
  board?: string;
  /** Show debug serial output and passing assertion details. */
  verbose?: boolean;
}

/**
 * Resolved configuration used by the runner.
 */
export interface ResolvedConfig {
  test: TestConfig;
  /** From typecode.config.ts root. */
  fqbn: string;
  board: string;
  target: string;
  /** Absolute path to project root. */
  projectRoot: string;
}
