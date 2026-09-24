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
  buildReportView, reportHtml, renderMarkdown,
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

  it('anchors label-prefixed diagnostics at their real source line and keeps the hint', () => {
    const text = [
      '<script>',            // 0
      '  ui.mount(screen);', // 1
      '</script>',           // 2
      '<style>',             // 3
      '  #lvtxt { font-size: 9px; }', // 4  ← the flagged style
      '</style>',            // 5
    ].join('\n');
    const report = readDiagnosticsReport(JSON.stringify({
      metadata: { sourceFile: 'main.ui' },
      peripheralConflicts: [],
      transpileDiagnostics: [
        { severity: 'warning', code: 'css-mono-font-size-floor', hint: 'Use 10px minimum.',
          filePath: 'main.ui.html', // build intermediate — must fall back to the entry file
          message: '#lvtxt: font-size 9px is below the 1bpp legibility floor (10px).' },
        { severity: 'warning', message: '<text>: alpha is ignored — the color renders fully opaque.' },
        { severity: 'info', code: 'css-ua-scale', hint: 'Override per element.',
          message: 'Display-anchored UA defaults active: root text 12px.' },
      ],
    }))!;
    const items = buildProblemItems(report, root, exists, () => text);
    // #lvtxt → the CSS selector line (0-based 4), column of the selector.
    expect(items[0].startLine).toBe(4);
    expect(items[0].startColumn).toBe(2);
    expect(items[0].endColumn).toBe(2 + '#lvtxt'.length);
    expect(items[0].message).toContain('Hint: Use 10px minimum.');
    // <text> has no match in this text → stays anchored at 1:1.
    expect(items[1].startLine).toBe(0);
    expect(items[1].startColumn).toBe(0);
    // Document-level (no label prefix) stays at 1:1 — that IS its scope.
    expect(items[2].startLine).toBe(0);
    expect(items[2].message).toContain('Hint: Override per element.');
  });

  it('falls back to markup/script id occurrences when no CSS selector matches', () => {
    const text = '<button id=\'invert\'>Invert</button>';
    const report = readDiagnosticsReport(JSON.stringify({
      metadata: { sourceFile: 'main.ui' },
      peripheralConflicts: [],
      transpileDiagnostics: [
        { severity: 'warning', message: '#invert: font-size 20px is 31% of the display height.' },
      ],
    }))!;
    const items = buildProblemItems(report, root, exists, () => text);
    expect(items[0].startLine).toBe(0);
    expect(items[0].startColumn).toBe(8);
    expect(items[0].endColumn).toBe(8 + "id='invert'".length);
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

describe('buildReportView', () => {
  it('maps the report shape-tolerantly (sorted top globals, rounded build ms, problem count)', () => {
    const view = buildReportView({
      metadata: {
        sourceFile: 'main.ts', target: 'zephyr', board: 'blackpill', timestamp: '2026-09-23T00:00:00Z',
        boardDetails: { flashKb: 512, sramKb: 128 },
      },
      peripheralConflicts: [{ pinName: 'PA4', peripheralName: 'SPI1', role: 'SCK', severity: 'error', message: 'm', suggestion: 's' }],
      transpileDiagnostics: [{ severity: 'warning', message: 'w1' }],
      pinUsage: {
        gpio: [{ pinName: 'PA0', mode: 'ANALOG', peripheralRole: 'ADC1 in1' }],
        peripherals: [{ type: 'adc', instance: 1, displayName: 'ADC1', pins: ['PA0'], dtLabel: 'adc1' }],
        summary: { totalPins: 50, usedPins: 3, unusedPins: 47 },
      },
      asyncTasks: [{ name: 'sampler', intervalMs: 1000 }],
      heapEstimate: {
        globalVariables: [
          { name: 'small', cppType: 'int32_t', estimatedBytes: 4 },
          { name: 'big', cppType: 'uint8_t[512]', estimatedBytes: 512 },
        ],
        stringLiterals: [{ value: 'x', estimatedBytes: 2 }],
        totalStaticBytes: 1024, estimatedStackDepth: 7,
      },
      treeShaking: { removedSymbols: ['a', 'b'] },
      buildTiming: { phases: {}, totalMs: 4321.6 },
    });
    expect(view.metadata.board).toBe('blackpill');
    expect(view.metadata.flashKb).toBe(512);
    expect(view.conflicts).toHaveLength(1);
    expect(view.gpio[0].peripheralRole).toBe('ADC1 in1');
    expect(view.peripherals[0].dtLabel).toBe('adc1');
    expect(view.pinSummary.usedPins).toBe(3);
    expect(view.asyncTasks[0].intervalMs).toBe(1000);
    expect(view.heap.topGlobals[0].name).toBe('big'); // sorted by bytes desc
    expect(view.heap.stringLiterals).toBe(1);
    expect(view.treeShaken).toEqual(['a', 'b']);
    expect(view.buildMs).toBe(4322);
    expect(view.problemCount).toBe(2); // 1 conflict + 1 transpile diagnostic
  });

  it('survives a minimal report (missing sections default to empty)', () => {
    const view = buildReportView({ metadata: { sourceFile: 'main.ts' }, peripheralConflicts: [] });
    expect(view.conflicts).toEqual([]);
    expect(view.gpio).toEqual([]);
    expect(view.heap.topGlobals).toEqual([]);
    expect(view.problemCount).toBe(0);
  });
});

describe('renderMarkdown', () => {
  it('renders the report subset: headings, tables, blockquotes, lists, hr', () => {
    const html = renderMarkdown([
      '# Build Diagnostics',
      '',
      '> **Source:** `app.ui` | **Target:** `generic`',
      '>',
      '> **Board:** esp32s3',
      '',
      '---',
      '',
      '## Project Summary',
      '',
      '| Metric | Status / Value |',
      '| :--- | :--- |',
      '| **Entry Points** | 1 |',
      '| **Pin Usage** | 0 / 64 pins |',
      '',
      '- `main()`',
      '- second item',
    ].join('\n'));
    expect(html).toContain('<h2>Build Diagnostics</h2>'); // demoted one level
    expect(html).toContain('<blockquote><b>Source:</b> <code>app.ui</code>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<table><tr><th>Metric</th><th>Status / Value</th></tr>');
    expect(html).toContain('<tr><td><b>Entry Points</b></td><td>1</td></tr>');
    expect(html).toContain('<ul><li><code>main()</code></li><li>second item</li></ul>');
  });

  it('renders mermaid fences as mermaid blocks with escaped source; plain fences as code', () => {
    const html = renderMarkdown('```mermaid\nflowchart LR\n  a --> b\n```\n```cpp\nint x;\n```');
    expect(html).toContain('<pre class="mermaid">flowchart LR\n  a --&gt; b</pre>');
    expect(html).toContain('<pre><code>int x;</code></pre>');
  });

  it('escapes HTML in the source text', () => {
    expect(renderMarkdown('text with <script>alert(1)</script> and & amp'))
      .toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('reportHtml', () => {
  it('bakes the rendered markdown in and listens for live postMessage updates', () => {
    const html = reportHtml({ html: '<h2>Project Summary</h2><table></table>', meta: 'xiao_ble · entry main.ts', problemCount: 2 });
    expect(html).toContain('acquireVsCodeApi()');
    expect(html).toContain("addEventListener('message'");
    expect(html).toContain('<h2>Project Summary</h2>'); // the markdown render is baked in
    expect(html).toContain('"meta":"xiao_ble · entry main.ts"');
  });

  it('renders the error payload path for a missing report', () => {
    expect(reportHtml({ error: 'No diagnostics.json yet' })).toContain('No diagnostics.json yet');
  });

  it('loads mermaid for the diagrams with a readable-source fallback when offline', () => {
    const html = reportHtml({ html: '<pre class="mermaid">flowchart TD</pre>' });
    expect(html).toContain('src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"');
    expect(html).toContain('pre.mermaid:not([data-processed])'); // offline fallback styling
  });

  it('serves the bundled mermaid from the webview resource when provided', () => {
    const html = reportHtml(
      { html: '<pre class="mermaid">flowchart TD</pre>' },
      { mermaidSrc: 'https://7l3q.webview/resources/media/mermaid.min.js', scriptSrc: 'https://7l3q.webview' },
    );
    expect(html).toContain('src="https://7l3q.webview/resources/media/mermaid.min.js"');
    expect(html).toContain("script-src 'unsafe-inline' https://7l3q.webview;");
    expect(html).not.toContain('cdn.jsdelivr.net/npm/mermaid'); // no CDN dependency when bundled
  });

  // The trace-core lesson: an unescaped character class in the page script
  // makes the whole panel a SyntaxError. Compile (never run) the script.
  it('the embedded script is syntactically valid JavaScript (compiles, never runs)', () => {
    const m = /<script>\nconst vscode = acquireVsCodeApi[\s\S]*?<\/script>/.exec(reportHtml({ html: '<p>x</p>' }));
    expect(m).not.toBeNull();
    expect(() => new Function(m![1])).not.toThrow();
  });
});
