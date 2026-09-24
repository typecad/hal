// ---------------------------------------------------------------------------
// diagnostics-core.ts — the pure half of the Diagnostics integration.
//
// Consumes the artifact `typecad-hal build --diagnostics` writes
// (diagnostics.json: peripheral conflicts with TS source spans, the build's
// own transpile diagnostics) and maps it to editor problem items, plus the
// report-file discovery the addon needs. The trace-core pattern: local
// minimal shapes of the JSON contract, no 'vscode' and no engine import, so
// the monorepo suite exercises this module directly.
// ---------------------------------------------------------------------------

import path from 'node:path';

// ── Report shapes (what this module reads) ─────────────────────────────────

export interface DiagnosticsSourceSpan {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface PeripheralConflictItem {
  pinName: string;
  peripheralName: string;
  role: string;
  severity: 'error' | 'warning';
  message: string;
  suggestion: string;
  sourceSpan?: DiagnosticsSourceSpan;
}

export interface TranspileDiagnosticItem {
  severity: string;
  message: string;
  code?: string;
  source?: string;
}

export interface DiagnosticsReportLite {
  metadata: {
    sourceFile: string;
  };
  peripheralConflicts: PeripheralConflictItem[];
  transpileDiagnostics?: TranspileDiagnosticItem[];
}

/** Parse + shape-check a diagnostics.json's text. Undefined on anything that
 *  is not a report (missing file, partial write, other JSON). */
export function readDiagnosticsReport(text: string): DiagnosticsReportLite | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const r = raw as Partial<DiagnosticsReportLite>;
  if (
    typeof r.metadata?.sourceFile !== 'string'
    || !Array.isArray(r.peripheralConflicts)
  ) {
    return undefined;
  }
  return r as DiagnosticsReportLite;
}

// ── Report view (the webview's data) ───────────────────────────────────────
//
// The view reads everything the report offers but must render through any
// generator version, so extraction is shape-tolerant with fallbacks rather
// than a full schema duplicate — a viewer displays, it does not validate.

export interface ReportView {
  metadata: {
    sourceFile: string;
    target: string;
    board?: string;
    framework?: string;
    timestamp?: string;
    flashKb?: number;
    sramKb?: number;
  };
  conflicts: { pinName: string; peripheralName: string; role: string; severity: string; message: string; suggestion: string }[];
  gpio: { pinName: string; mode: string; peripheralRole?: string }[];
  peripherals: { displayName: string; type: string; instance: number; pins: string[]; dtLabel?: string }[];
  pinSummary: { totalPins?: number; usedPins?: number; unusedPins?: number };
  asyncTasks: { name: string; intervalMs?: number }[];
  heap: {
    totalStaticBytes?: number;
    estimatedStackDepth?: number;
    topGlobals: { name: string; cppType: string; bytes: number }[];
    stringLiterals?: number;
  };
  treeShaken: string[];
  buildMs?: number;
  problemCount: number;
}

/** Shape-tolerant view model over a parsed report (see the section note). */
export function buildReportView(report: unknown): ReportView {
  const r = report as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- shape-tolerant read of a foreign JSON document
  const meta = r?.metadata ?? {};
  const pins = r?.pinUsage ?? {};
  const heap = r?.heapEstimate ?? {};
  const timing = r?.buildTiming ?? {};
  const conf = Array.isArray(r?.peripheralConflicts) ? r.peripheralConflicts : [];
  const tdiags = Array.isArray(r?.transpileDiagnostics) ? r.transpileDiagnostics : [];
  return {
    metadata: {
      sourceFile: typeof meta.sourceFile === 'string' ? meta.sourceFile : '?',
      target: typeof meta.target === 'string' ? meta.target : '?',
      ...(typeof meta.board === 'string' ? { board: meta.board } : {}),
      ...(typeof meta.framework === 'string' ? { framework: meta.framework } : {}),
      ...(typeof meta.timestamp === 'string' ? { timestamp: meta.timestamp } : {}),
      ...(typeof meta.boardDetails?.flashKb === 'number' ? { flashKb: meta.boardDetails.flashKb } : {}),
      ...(typeof meta.boardDetails?.sramKb === 'number' ? { sramKb: meta.boardDetails.sramKb } : {}),
    },
    conflicts: conf.map((c: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      pinName: String(c?.pinName ?? '?'),
      peripheralName: String(c?.peripheralName ?? '?'),
      role: String(c?.role ?? '?'),
      severity: c?.severity === 'error' ? 'error' : 'warning',
      message: String(c?.message ?? ''),
      suggestion: String(c?.suggestion ?? ''),
    })),
    gpio: (Array.isArray(pins.gpio) ? pins.gpio : []).map((g: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      pinName: String(g?.pinName ?? '?'),
      mode: String(g?.mode ?? '?'),
      ...(typeof g?.peripheralRole === 'string' ? { peripheralRole: g.peripheralRole } : {}),
    })),
    peripherals: (Array.isArray(pins.peripherals) ? pins.peripherals : []).map((p: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      displayName: String(p?.displayName ?? '?'),
      type: String(p?.type ?? '?'),
      instance: Number(p?.instance ?? 0),
      pins: Array.isArray(p?.pins) ? p.pins.map(String) : [],
      ...(typeof p?.dtLabel === 'string' ? { dtLabel: p.dtLabel } : {}),
    })),
    pinSummary: {
      ...(typeof pins.summary?.totalPins === 'number' ? { totalPins: pins.summary.totalPins } : {}),
      ...(typeof pins.summary?.usedPins === 'number' ? { usedPins: pins.summary.usedPins } : {}),
      ...(typeof pins.summary?.unusedPins === 'number' ? { unusedPins: pins.summary.unusedPins } : {}),
    },
    asyncTasks: (Array.isArray(r?.asyncTasks) ? r.asyncTasks : []).map((t: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      name: String(t?.name ?? '?'),
      ...(typeof t?.intervalMs === 'number' ? { intervalMs: t.intervalMs } : {}),
    })),
    heap: {
      ...(typeof heap.totalStaticBytes === 'number' ? { totalStaticBytes: heap.totalStaticBytes } : {}),
      ...(typeof heap.estimatedStackDepth === 'number' ? { estimatedStackDepth: heap.estimatedStackDepth } : {}),
      topGlobals: (Array.isArray(heap.globalVariables) ? heap.globalVariables : [])
        .map((g: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
          name: String(g?.name ?? '?'),
          cppType: String(g?.cppType ?? '?'),
          bytes: Number(g?.estimatedBytes ?? 0),
        }))
        .sort((a: { bytes: number }, b: { bytes: number }) => b.bytes - a.bytes)
        .slice(0, 12),
      ...(Array.isArray(heap.stringLiterals) ? { stringLiterals: heap.stringLiterals.length } : {}),
    },
    treeShaken: Array.isArray(r?.treeShaking?.removedSymbols) ? r.treeShaking.removedSymbols.map(String) : [],
    ...(typeof timing.totalMs === 'number' ? { buildMs: Math.round(timing.totalMs) } : {}),
    problemCount: conf.length + tdiags.length,
  };
}

// ── Problem mapping ────────────────────────────────────────────────────────

export interface ProblemItem {
  /** Absolute file the item anchors to. */
  file: string;
  /** 0-based line/column (the VS Code Range convention; the report is 1-based). */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  severity: 'error' | 'warning' | 'information';
  message: string;
  code?: string;
}

/** Map a report to editor problem items. Conflicts anchor at their TS source
 *  span when present (falling back to the entry file); transpile diagnostics
 *  carry no location and anchor at the entry file's first line. Tree-shaking
 *  removals are deliberately NOT problems — informational, and anchoring a
 *  symbol list without locations would only spam line 1. */
export function buildProblemItems(
  report: DiagnosticsReportLite,
  root: string,
  exists: (p: string) => boolean,
): ProblemItem[] {
  // Report paths are whatever the transpiler saw (often relative to the
  // project, sometimes a bare basename) — resolve against the root, then
  // src/, before giving up.
  const resolveFile = (p: string | undefined): string | undefined => {
    if (p === undefined || p.length === 0) return undefined;
    if (path.isAbsolute(p)) return exists(p) ? p : undefined;
    for (const c of [path.resolve(root, p), path.resolve(root, 'src', p)]) {
      if (exists(c)) return c;
    }
    return undefined;
  };
  const entry = resolveFile(report.metadata.sourceFile)
    ?? path.resolve(root, report.metadata.sourceFile);

  const zeroBased = (n: number | undefined, fallback: number): number =>
    Math.max(0, (n ?? fallback) - 1);

  const items: ProblemItem[] = [];
  for (const c of report.peripheralConflicts) {
    const span = c.sourceSpan;
    const file = resolveFile(span?.filePath) ?? entry;
    const startLine = zeroBased(span?.startLine, 1);
    const startColumn = zeroBased(span?.startColumn, 1);
    items.push({
      file,
      startLine,
      startColumn,
      endLine: Math.max(startLine, zeroBased(span?.endLine, span?.startLine ?? 1)),
      endColumn: Math.max(startColumn + 1, zeroBased(span?.endColumn, span?.startColumn ?? 1)),
      severity: c.severity,
      message: `${c.message} — ${c.peripheralName} claims ${c.pinName} (${c.role}). Suggestion: ${c.suggestion}`,
      code: 'peripheral-conflict',
    });
  }
  for (const t of report.transpileDiagnostics ?? []) {
    items.push({
      file: entry,
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 1,
      severity: t.severity === 'error' ? 'error' : t.severity === 'warning' ? 'warning' : 'information',
      message: t.message,
      code: t.code,
    });
  }
  return items;
}

// ── Report discovery ───────────────────────────────────────────────────────

/** The filesystem surface discovery needs (injected — the findHalRoot
 *  convention — so the module stays pure and testable). */
export interface DiagnosticsFs {
  exists(p: string): boolean;
  readdir(p: string): string[];
  mtimeMs(p: string): number;
}

/** Find the newest diagnostics.json under the project's output tree. The
 *  generator writes <outBaseDir>/<strategy subdir>/diagnostics.json and every
 *  in-tree strategy's subdir is a single level ('src'), so a shallow scan of
 *  src/out (then out, for a custom outDir that still roots there) covers the
 *  layouts without walking the whole project. */
export function findDiagnosticsReport(
  root: string,
  fs: DiagnosticsFs,
): { file: string; mtimeMs: number } | undefined {
  const candidates: { file: string; mtimeMs: number }[] = [];
  for (const dir of [path.join(root, 'src', 'out'), path.join(root, 'out')]) {
    if (!fs.exists(dir)) continue;
    const leaves = [...fs.readdir(dir), ''];
    for (const leaf of leaves) {
      const file = path.join(dir, leaf, 'diagnostics.json');
      if (!fs.exists(file)) continue;
      try {
        candidates.push({ file, mtimeMs: fs.mtimeMs(file) });
      } catch {
        // unreadable stat — skip the candidate, not the scan
      }
    }
  }
  if (candidates.length === 0) return undefined;
  let newest = candidates[0];
  for (const c of candidates) {
    if (c.mtimeMs > newest.mtimeMs) newest = c;
  }
  return newest;
}

// ── Report page (the webview HTML) ─────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The report webview: dependency-free HTML (no canvas — tables and bars),
 *  initial payload baked in, live updates via postMessage (the trace-panel
 *  contract; the extension's file watcher pushes fresh views). */
export function reportHtml(initial: ReportView | { error: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { font: 13px/1.45 var(--vscode-font-family, system-ui), sans-serif; margin: 12px;
         background: var(--vscode-editor-background, #111); color: var(--vscode-editor-foreground, #ddd); }
  h1 { font-size: 13px; margin: 0 0 8px; font-weight: 600; }
  h2 { font-size: 12px; margin: 18px 0 6px; font-weight: 600;
       color: var(--vscode-descriptionForeground, #888); text-transform: uppercase; letter-spacing: .04em; }
  #meta { color: var(--vscode-descriptionForeground, #888); margin-bottom: 8px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 4px; }
  th, td { text-align: left; padding: 3px 10px 3px 0; vertical-align: top;
           border-bottom: 1px solid var(--vscode-widget-border, #222); }
  th { color: var(--vscode-descriptionForeground, #888); font-weight: normal; }
  tr.conflict-error td { color: var(--vscode-errorForeground, #f66); }
  tr.conflict-warning td { color: var(--vscode-editorWarning-foreground, #ca8); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { border: 1px solid var(--vscode-widget-border, #333); border-radius: 3px;
          padding: 1px 6px; font-size: 11px; }
  .chip b { font-weight: 600; }
  .bar { background: var(--vscode-button-background, #3a6ea5); height: 10px;
         border-radius: 2px; min-width: 2px; }
  .bar-cell { width: 45%; min-width: 120px; }
  .mut { color: var(--vscode-descriptionForeground, #888); }
  details summary { cursor: pointer; color: var(--vscode-descriptionForeground, #888); }
</style></head><body>
<h1>typeCAD/hal diagnostics</h1>
<div id="meta"></div>
<div id="body"></div>
<script>
const vscode = acquireVsCodeApi();
let d = ${JSON.stringify(initial)};
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function render(d) {
  const meta = document.getElementById('meta');
  const body = document.getElementById('body');
  if (d.error) { meta.textContent = ''; body.textContent = d.error; return; }
  const m = d.metadata;
  meta.textContent = [m.board, m.framework, m.target, m.timestamp, 'entry ' + m.sourceFile]
    .filter(Boolean).join(' · ');
  let h = '';
  if (d.conflicts.length > 0) {
    h += '<h2>Peripheral conflicts (' + d.conflicts.length + ')</h2><table>';
    for (const c of d.conflicts) {
      h += '<tr class="conflict-' + c.severity + '"><td>' + esc(c.pinName) + '</td><td>'
        + esc(c.peripheralName) + ' (' + esc(c.role) + ')</td><td>' + esc(c.message)
        + ' — ' + esc(c.suggestion) + '</td></tr>';
    }
    h += '</table>';
  } else {
    h += '<h2>Peripheral conflicts</h2><div class="mut">none</div>';
  }
  if (d.peripherals.length > 0) {
    h += '<h2>Peripheral allocation</h2><table><tr><th>instance</th><th>pins</th><th>devicetree</th></tr>';
    for (const p of d.peripherals) {
      h += '<tr><td>' + esc(p.displayName) + ' <span class="mut">' + esc(p.type) + ' ' + p.instance
        + '</span></td><td>' + esc(p.pins.join(', ')) + '</td><td class="mut">' + esc(p.dtLabel ?? '') + '</td></tr>';
    }
    h += '</table>';
  }
  if (d.gpio.length > 0) {
    const s = d.pinSummary;
    h += '<h2>GPIO pins' + (s.usedPins !== undefined ? ' — ' + s.usedPins + ' of ' + s.totalPins + ' used' : '') + '</h2><div class="chips">';
    for (const g of d.gpio) {
      h += '<span class="chip"><b>' + esc(g.pinName) + '</b> ' + esc(g.mode)
        + (g.peripheralRole ? ' · ' + esc(g.peripheralRole) : '') + '</span>';
    }
    h += '</div>';
  }
  if (d.asyncTasks.length > 0) {
    h += '<h2>Async tasks</h2><div class="chips">';
    for (const t of d.asyncTasks) {
      h += '<span class="chip"><b>' + esc(t.name) + '</b>' + (t.intervalMs !== undefined ? ' · every ' + t.intervalMs + ' ms' : '') + '</span>';
    }
    h += '</div>';
  }
  const heap = d.heap;
  if (heap.totalStaticBytes !== undefined || heap.topGlobals.length > 0) {
    h += '<h2>Static memory</h2><div class="mut">'
      + (heap.totalStaticBytes !== undefined ? heap.totalStaticBytes.toLocaleString() + ' B static' : '')
      + (heap.stringLiterals !== undefined ? ' · ' + heap.stringLiterals + ' string literals' : '')
      + (heap.estimatedStackDepth !== undefined ? ' · est. stack depth ' + heap.estimatedStackDepth + ' frames' : '')
      + '</div>';
    if (heap.topGlobals.length > 0) {
      const max = Math.max(...heap.topGlobals.map((g) => g.bytes), 1);
      h += '<table><tr><th>global</th><th>type</th><th class="bar-cell"></th><th>bytes</th></tr>';
      for (const g of heap.topGlobals) {
        h += '<tr><td>' + esc(g.name) + '</td><td class="mut">' + esc(g.cppType)
          + '</td><td class="bar-cell"><div class="bar" style="width:'
          + Math.max(2, Math.round(g.bytes / max * 100)) + '%"></div></td><td>'
          + g.bytes.toLocaleString() + '</td></tr>';
      }
      h += '</table>';
    }
  }
  if (d.treeShaken.length > 0) {
    h += '<h2>Tree-shaken (' + d.treeShaken.length + ' symbols removed)</h2><details><summary>show removed symbols</summary><div class="chips">';
    for (const s of d.treeShaken.slice(0, 200)) {
      h += '<span class="chip">' + esc(s) + '</span>';
    }
    h += '</div></details>';
  }
  if (d.buildMs !== undefined) {
    h += '<div class="mut" style="margin-top:14px">build ' + d.buildMs + ' ms · ' + d.problemCount + ' problem' + (d.problemCount === 1 ? '' : 's') + '</div>';
  }
  body.innerHTML = h;
}
window.addEventListener('message', (e) => { d = e.data; render(d); });
render(d);
</script></body></html>
`;
}
