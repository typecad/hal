// Unit tests for appendSourceLine / appendHeaderLine linemarker emission in
// gdb debug mode. Verifies markers emit only on source-span transitions and
// only when ctx.debugMode === 'gdb'; printf mode emits none.

import { describe, it, expect } from 'vitest';
import { appendSourceLine } from '../../../packages/cuttlefish/src/emit/emitters/line-appender';
import type { EmitterContext } from '../../../packages/cuttlefish/src/emit/emitters/emitter-context';
import type { SourceSpan } from '../../../packages/cuttlefish/src/types';

// Minimal EmitterContext stub — appendSourceLine only touches sourceLines,
// sourceMapEntries, debugMode, and lastEmittedSource. We cast to satisfy TS.
function makeCtx(debugMode: 'gdb' | 'printf'): EmitterContext {
  return {
    sourceLines: [],
    sourceMapEntries: [],
    debugMode,
    lastEmittedSource: null,
  } as unknown as EmitterContext;
}

function span(filePath: string, line: number): SourceSpan {
  return {
    filePath, startOffset: 0, endOffset: 0,
    startLine: line, startColumn: 0, endLine: line, endColumn: 0,
  };
}

describe('appendSourceLine — gdb mode', () => {
  it('emits a linemarker before the first spanned line', () => {
    const ctx = makeCtx('gdb');
    appendSourceLine(ctx, 'int x = 0;', { tsSpan: span('main.ts', 9), nodeKind: 'var_decl' });
    expect(ctx.sourceLines[0]).toMatch(/^# 10 ".*main\.ts"$/);
    expect(ctx.sourceLines[1]).toBe('int x = 0;');
  });

  it('does NOT repeat the marker when the next line has the same span', () => {
    const ctx = makeCtx('gdb');
    appendSourceLine(ctx, 'int x = 0;', { tsSpan: span('main.ts', 9), nodeKind: 'var_decl' });
    appendSourceLine(ctx, 'use(x);',     { tsSpan: span('main.ts', 9), nodeKind: 'expr' });
    // First call: marker + line. Second call: line only (same file+line).
    expect(ctx.sourceLines).toEqual([
      expect.stringMatching(/^# 10 ".*main\.ts"$/),
      'int x = 0;',
      'use(x);',
    ]);
  });

  it('emits a new marker when the source line changes', () => {
    const ctx = makeCtx('gdb');
    appendSourceLine(ctx, 'int x = 0;', { tsSpan: span('main.ts', 9), nodeKind: 'var_decl' });
    appendSourceLine(ctx, 'use(x);',    { tsSpan: span('main.ts', 10), nodeKind: 'expr' });
    expect(ctx.sourceLines[2]).toMatch(/^# 11 ".*main\.ts"$/);
    expect(ctx.sourceLines[3]).toBe('use(x);');
  });

  it('emits a new marker when the source file changes', () => {
    const ctx = makeCtx('gdb');
    appendSourceLine(ctx, 'int x = 0;', { tsSpan: span('main.ts', 9), nodeKind: 'var_decl' });
    appendSourceLine(ctx, 'int y = 1;', { tsSpan: span('other.ts', 0), nodeKind: 'var_decl' });
    expect(ctx.sourceLines[2]).toMatch(/^# 1 ".*other\.ts"$/);
  });

  it('emits no markers in printf mode', () => {
    const ctx = makeCtx('printf');
    appendSourceLine(ctx, 'int x = 0;', { tsSpan: span('main.ts', 9), nodeKind: 'var_decl' });
    expect(ctx.sourceLines).toEqual(['int x = 0;']);
  });

  it('emits no marker when entry is absent (e.g. raw braces)', () => {
    const ctx = makeCtx('gdb');
    appendSourceLine(ctx, '{');
    expect(ctx.sourceLines).toEqual(['{']);
    // lastEmittedSource is unchanged; next spanned line still emits correctly.
    appendSourceLine(ctx, 'int x = 0;', { tsSpan: span('main.ts', 9), nodeKind: 'var_decl' });
    expect(ctx.sourceLines[1]).toMatch(/^# 10 ".*main\.ts"$/);
  });
});
