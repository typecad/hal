// Unit tests for the .cuttlefish-gdb.py generator. The script rewrites hoisted
// _isr_N frame names in the VS Code call stack (the one gap #line markers
// leave for anonymous lambdas). Map entries come from the .thcppmap.json sidecar.

import { describe, it, expect } from 'vitest';
import { generateGdbScript } from '../../../packages/framework-esp32/src/toolchain/gdb-script';
import type { GeneratedSourceMap } from '../../../packages/cuttlefish/src/types';

const MAP: GeneratedSourceMap = {
  version: 1,
  generatedFilePath: 'main/main.cc',
  sourceFilePath: 'main.ts',
  entries: [
    { generatedStartLine: 100, generatedStartColumn: 1, generatedEndLine: 105, generatedEndColumn: 2,
      tsSpan: { filePath: 'main.ts', startOffset: 0, endOffset: 10, startLine: 6, startColumn: 0, endLine: 6, endColumn: 10 },
      nodeKind: 'function_definition', symbolName: 'main_isr_0' },
    { generatedStartLine: 110, generatedStartColumn: 1, generatedEndLine: 112, generatedEndColumn: 2,
      tsSpan: { filePath: 'main.ts', startOffset: 20, endOffset: 30, startLine: 21, startColumn: 0, endLine: 21, endColumn: 10 },
      nodeKind: 'function_definition', symbolName: 'main_isr_1' },
    { generatedStartLine: 50, generatedStartColumn: 1, generatedEndLine: 50, generatedEndColumn: 10,
      tsSpan: { filePath: 'main.ts', startOffset: 40, endOffset: 50, startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
      nodeKind: 'function_definition', symbolName: 'setup' },
  ],
};

describe('generateGdbScript', () => {
  it('emits a FrameDecorator-based filter for _isr_N symbols only', () => {
    const out = generateGdbScript(MAP);
    expect(out).toContain('from gdb.FrameDecorator import FrameDecorator');
    expect(out).toContain('class _CuttlefishDecorator(FrameDecorator)');
    expect(out).toContain('gdb.frame_filters["_cuttlefish_isr"]');

    // Only _isr_N entries appear in the map; setup() does not.
    expect(out).toContain('"main_isr_0"');
    expect(out).toContain('"main_isr_1"');
    expect(out).not.toContain('"setup"');
  });

  it('labels each _isr_N with its TS file:line (1-based)', () => {
    const out = generateGdbScript(MAP);
    // main_isr_0 is at main.ts startLine 6 → display line 7
    expect(out).toContain('"main_isr_0": "<lambda> @ main.ts:7"');
    expect(out).toContain('"main_isr_1": "<lambda> @ main.ts:22"');
  });

  it('emits an empty (but still valid) filter when no _isr_N symbols exist', () => {
    const noIsr: GeneratedSourceMap = { ...MAP, entries: MAP.entries.filter(e => !/_isr_/.test(e.symbolName ?? '')) };
    const out = generateGdbScript(noIsr);
    expect(out).toContain('_ISR_MAP = {}');
    expect(out).toContain('gdb.frame_filters["_cuttlefish_isr"]');
  });
});
