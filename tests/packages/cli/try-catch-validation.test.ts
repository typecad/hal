// ---------------------------------------------------------------------------
// Tests for try/catch validation on architectures without exception support
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { validateTryCatch } from '../../../packages/cli/src/ir/try-catch-validation';
import type { StatementIR } from '../../../packages/cli/src/ir/model';

/** Helper to create a minimal program IR with the given statements */
function makeProgram(stmts: StatementIR[]) {
  return {
    topLevelStatements: stmts,
    functions: [] as Array<{ statements: StatementIR[] }>,
    classes: [] as Array<{
      methods: Array<{ statements: StatementIR[] }>;
      constructor?: { statements: StatementIR[] };
    }>,
  };
}

/** Helper to create boardConstants with a given architecture */
function makeBoardConstants(arch: string) {
  return new Map<string, string | number | boolean>([['architecture', arch]]);
}

describe('Try/Catch Validation', () => {
  it('emits error for try/catch on AVR target', () => {
    const program = makeProgram([
      {
        kind: 'try',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 5, startColumn: 2, endLine: 5, endColumn: 12 },
        tryBlock: [{ kind: 'return', sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 5, startLine: 6, startColumn: 4, endLine: 6, endColumn: 9 }, value: { kind: 'number', value: 1 } }],
        catchBlock: [{ kind: 'return', sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 5, startLine: 8, startColumn: 4, endLine: 8, endColumn: 9 }, value: { kind: 'number', value: 0 } }],
      } as any as StatementIR,
    ]);

    const diagnostics = validateTryCatch(program, makeBoardConstants('avr'));

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].code).toBe('try-catch-unsupported');
    expect(diagnostics[0].message).toContain('AVR');
    expect(diagnostics[0].message).toContain('-fno-exceptions');
    expect(diagnostics[0].line).toBe(5);
    expect(diagnostics[0].source).toBe('try-catch-validation');
    expect(diagnostics[0].hint).toContain('return null');
  });

  it('emits error for throw on AVR target', () => {
    const program = makeProgram([
      {
        kind: 'throw',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 3, startColumn: 0, endLine: 3, endColumn: 10 },
        value: { kind: 'string', value: 'error' },
      } as any as StatementIR,
    ]);

    const diagnostics = validateTryCatch(program, makeBoardConstants('avr'));

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].code).toBe('try-catch-unsupported');
    expect(diagnostics[0].message).toContain('throw');
    expect(diagnostics[0].message).toContain('AVR');
    expect(diagnostics[0].line).toBe(3);
  });

  it('does not emit diagnostic for try/catch on ESP32 target', () => {
    const program = makeProgram([
      {
        kind: 'try',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 5, startColumn: 2, endLine: 5, endColumn: 12 },
        tryBlock: [],
        catchBlock: [],
      } as any as StatementIR,
    ]);

    const diagnostics = validateTryCatch(program, makeBoardConstants('esp32'));

    expect(diagnostics.length).toBe(0);
  });

  it('does not emit diagnostic when boardConstants is undefined', () => {
    const program = makeProgram([
      {
        kind: 'try',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 5, startColumn: 2, endLine: 5, endColumn: 12 },
        tryBlock: [],
        catchBlock: [],
      } as any as StatementIR,
    ]);

    const diagnostics = validateTryCatch(program, undefined);

    expect(diagnostics.length).toBe(0);
  });

  it('detects try/catch nested inside if statement', () => {
    const program = makeProgram([
      {
        kind: 'if',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 50, startLine: 1, startColumn: 0, endLine: 10, endColumn: 1 },
        condition: { kind: 'boolean', value: true },
        thenBranch: [
          {
            kind: 'try',
            sourceSpan: { filePath: 'test.ts', startOffset: 10, endOffset: 40, startLine: 2, startColumn: 2, endLine: 5, endColumn: 3 },
            tryBlock: [],
            catchBlock: [],
          } as any as StatementIR,
        ],
        elseBranch: [],
      } as any as StatementIR,
    ]);

    const diagnostics = validateTryCatch(program, makeBoardConstants('avr'));

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].code).toBe('try-catch-unsupported');
    expect(diagnostics[0].line).toBe(2);
  });

  it('detects try/catch inside function bodies', () => {
    const program = {
      topLevelStatements: [] as StatementIR[],
      functions: [
        {
          statements: [
            {
              kind: 'try',
              sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 10, startColumn: 2, endLine: 10, endColumn: 12 },
              tryBlock: [],
              catchBlock: [],
            } as any as StatementIR,
          ],
        },
      ],
      classes: [],
    };

    const diagnostics = validateTryCatch(program, makeBoardConstants('avr'));

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].line).toBe(10);
  });

  it('detects try/catch inside class methods', () => {
    const program = {
      topLevelStatements: [] as StatementIR[],
      functions: [],
      classes: [
        {
          methods: [
            {
              statements: [
                {
                  kind: 'try',
                  sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 15, startColumn: 4, endLine: 15, endColumn: 14 },
                  tryBlock: [],
                  catchBlock: [],
                } as any as StatementIR,
              ],
            },
          ],
          constructor: undefined,
        },
      ],
    };

    const diagnostics = validateTryCatch(program, makeBoardConstants('avr'));

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].line).toBe(15);
  });

  it('emits error for megaavr architecture', () => {
    const program = makeProgram([
      {
        kind: 'try',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
        tryBlock: [],
        catchBlock: [],
      } as any as StatementIR,
    ]);

    const diagnostics = validateTryCatch(program, makeBoardConstants('megaavr'));

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].message).toContain('MEGAAVR');
  });

  it('does not emit diagnostic for code without try/catch', () => {
    const program = makeProgram([
      {
        kind: 'if',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
        condition: { kind: 'boolean', value: true },
        thenBranch: [{ kind: 'return', sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 5, startLine: 2, startColumn: 0, endLine: 2, endColumn: 5 }, value: { kind: 'number', value: 1 } }],
        elseBranch: [],
      } as any as StatementIR,
    ]);

    const diagnostics = validateTryCatch(program, makeBoardConstants('avr'));

    expect(diagnostics.length).toBe(0);
  });

  it('reports multiple diagnostics for multiple try/catch blocks', () => {
    const program = makeProgram([
      {
        kind: 'try',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 5, startColumn: 0, endLine: 5, endColumn: 10 },
        tryBlock: [],
        catchBlock: [],
      } as any as StatementIR,
      {
        kind: 'try',
        sourceSpan: { filePath: 'test.ts', startOffset: 0, endOffset: 10, startLine: 15, startColumn: 0, endLine: 15, endColumn: 10 },
        tryBlock: [],
        catchBlock: [],
      } as any as StatementIR,
    ]);

    const diagnostics = validateTryCatch(program, makeBoardConstants('avr'));

    expect(diagnostics.length).toBe(2);
    expect(diagnostics[0].line).toBe(5);
    expect(diagnostics[1].line).toBe(15);
  });
});
