// ---------------------------------------------------------------------------
// diagnostics-core.test.ts — the pure half of the Diagnostics integration:
// report shape-checking, the Problems mapping (conflicts at their TS span,
// transpile diagnostics at the entry file), and output-tree discovery.
// The module imports no 'vscode' (the trace-core pattern), so the monorepo
// suite exercises it directly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  readDiagnosticsReport, buildProblemItems, findDiagnosticsReport,
} from '../../../packages/vscode-typecad-hal/src/diagnostics-core';

const REPORT = JSON.stringify({
  metadata: { sourceFile: 'main.ts' },
  peripheralConflicts: [
    {
      pinName: 'PA4', peripheralName: 'SPI1', role: 'SCK', severity: 'error',
      message: 'Pin assigned to two peripherals',
      suggestion: 'Move one peripheral to an unused pin',
      sourceSpan: { filePath: 'src/main.ts', startLine: 12, startColumn: 5, endLine: 12, endColumn: 28 },
    },
    {
      // No span — must fall back to the entry file, line 0.
      pinName: 'PB5', peripheralName: 'PWM2', role: 'ch1', severity: 'warning',
      message: 'PWM claims a pin driven by GPIO',
      suggestion: 'Remove the direct GPIO writes',
    },
  ],
  transpileDiagnostics: [
    { severity: 'warning', message: 'autoboxing removed', code: 'autobox' },
  ],
});

describe('readDiagnosticsReport', () => {
  it('parses a diagnostics.json report', () => {
    const r = readDiagnosticsReport(REPORT)!;
    expect(r.metadata.sourceFile).toBe('main.ts');
    expect(r.peripheralConflicts).toHaveLength(2);
  });

  it('rejects other JSON, partial writes, and non-JSON (the watcher sees those mid-write)', () => {
    expect(readDiagnosticsReport('{"metadata":{"sourceFile":"x"}}')).toBeUndefined(); // no conflicts array
    expect(readDiagnosticsReport('{"error":{"code":"other-schema"}}')).toBeUndefined();
    expect(readDiagnosticsReport('{"metadata":{"sourceFile":"main.ts"')).toBeUndefined();
  });
});

describe('buildProblemItems', () => {
  const root = path.resolve('/proj');
  const entry = path.join(root, 'src', 'main.ts');
  const exists = (p: string): boolean => p === entry;

  it('anchors conflicts at their TS span (1-based report → 0-based range)', () => {
    const items = buildProblemItems(readDiagnosticsReport(REPORT)!, root, exists);
    const conflict = items[0];
    expect(conflict.file).toBe(entry);
    expect(conflict.startLine).toBe(11);
    expect(conflict.startColumn).toBe(4);
    expect(conflict.endLine).toBe(11);
    expect(conflict.endColumn).toBe(27);
    expect(conflict.severity).toBe('error');
    expect(conflict.message).toContain('SPI1');
    expect(conflict.message).toContain('Suggestion');
  });

  it('falls back to the entry file for span-less conflicts; maps severities', () => {
    const items = buildProblemItems(readDiagnosticsReport(REPORT)!, root, exists);
    expect(items[1].file).toBe(entry);
    expect(items[1].startLine).toBe(0);
    expect(items[1].severity).toBe('warning');
    // Transpile diagnostics anchor at the entry file's first line.
    expect(items[2].file).toBe(entry);
    expect(items[2].severity).toBe('warning');
    expect(items[2].code).toBe('autobox');
  });

  it('resolves bare-basename entry files through src/ before the root', () => {
    // exists() only answers for the src/ candidate — the fallback chain
    // must try it before path.resolve(root, 'main.ts').
    const items = buildProblemItems(readDiagnosticsReport(REPORT)!, root, exists);
    expect(items.every((i) => i.file === entry)).toBe(true);
  });
});

describe('findDiagnosticsReport', () => {
  it('finds the newest diagnostics.json under the output tree', () => {
    const root = path.resolve('/proj');
    const a = path.join(root, 'src', 'out', 'src', 'diagnostics.json');
    const b = path.join(root, 'out', 'zephyr', 'diagnostics.json');
    const tree = new Set([path.join(root, 'src', 'out'), path.join(root, 'out'), a, b]);
    const mtimes = new Map([[a, 100], [b, 200]]);
    const found = findDiagnosticsReport(root, {
      exists: (p) => tree.has(p),
      readdir: (p) => (p === path.join(root, 'src', 'out') ? ['src'] : p === path.join(root, 'out') ? ['zephyr'] : []),
      mtimeMs: (p) => mtimes.get(p) ?? 0,
    });
    expect(found?.file).toBe(b); // newer wins, not first-found
  });

  it('returns undefined when no report exists yet', () => {
    const root = path.resolve('/proj');
    expect(findDiagnosticsReport(root, {
      exists: () => false,
      readdir: () => [],
      mtimeMs: () => 0,
    })).toBeUndefined();
  });
});
