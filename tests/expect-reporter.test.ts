// ---------------------------------------------------------------------------
// Unit tests for @typecode/expect — Reporter
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { reportResults } from '../packages/expect/src/host/reporter';
import type { RunResult } from '../packages/expect/src/host/types';

describe('reporter', () => {
  it('reports all-passing results without errors', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result: RunResult = {
      files: [{
        filePath: 'tests/analog.test.ts',
        describes: [{
          name: 'A0 reads',
          tests: [
            {
              name: 'reads zero',
              assertions: [{ matcher: 'toBe', expected: '0', actual: '0', passed: true }],
              passed: true,
              durationMs: 2,
            },
          ],
          passed: true,
        }],
        passed: true,
        durationMs: 5000,
        debugOutput: [],
      }],
      totalTests: 1,
      totalPassed: 1,
      totalFailed: 0,
      durationMs: 5000,
    };

    reportResults(result);

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('typecode-test');
    expect(output).toContain('A0 reads');
    expect(output).toContain('reads zero');
    expect(output).toContain('1 passed');
    expect(output).toContain('PASS');

    logSpy.mockRestore();
  });

  it('reports failing results with failure details', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result: RunResult = {
      files: [{
        filePath: 'tests/temp.test.ts',
        describes: [{
          name: 'temperature',
          tests: [
            {
              name: 'room temp',
              assertions: [{
                matcher: 'toBeWithinRange',
                expected: '20,25',
                actual: '31',
                passed: false,
              }],
              passed: false,
              durationMs: 3,
            },
          ],
          passed: false,
        }],
        passed: false,
        durationMs: 6000,
        debugOutput: [],
      }],
      totalTests: 1,
      totalPassed: 0,
      totalFailed: 1,
      durationMs: 6000,
    };

    reportResults(result);

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('1 failed');
    expect(output).toContain('FAIL');
    expect(output).toContain('Actual');
    expect(output).toContain('31');

    logSpy.mockRestore();
  });

  it('includes board and port info', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result: RunResult = {
      files: [],
      totalTests: 0,
      totalPassed: 0,
      totalFailed: 0,
      durationMs: 100,
    };

    reportResults(result, { board: 'Arduino Uno', port: 'COM4' });

    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Arduino Uno');
    expect(output).toContain('COM4');

    logSpy.mockRestore();
  });
});
