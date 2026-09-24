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
  hint?: string;
  /** The originator's file reference — often a build intermediate
   *  (app.ui.html) that does not exist on disk; resolution falls back to the
   *  report entry file. */
  filePath?: string;
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

/** Find where a compat-report label (`#id`, `<tag>`) lives in source text.
 *  The CSS selector wins — that is where the flagged style is declared —
 *  then markup/script id occurrences. Returns a 0-based anchor. */
function anchorLabel(text: string, label: string): { line: number; column: number; length: number } | undefined {
  const patterns: string[] = [];
  if (label.startsWith('#')) {
    const id = label.slice(1);
    patterns.push(`#${id}`, `id="${id}"`, `id='${id}'`, `id: '${id}'`, `id: "${id}"`);
  } else if (label.startsWith('<') && label.endsWith('>')) {
    patterns.push(`<${label.slice(1, -1)}`);
  } else {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const p of patterns) {
      const column = lines[i].indexOf(p);
      if (column >= 0) return { line: i, column, length: p.length };
    }
  }
  return undefined;
}

/** Map a report to editor problem items. Conflicts anchor at their TS source
 *  span when present (falling back to the entry file); transpile diagnostics
 *  carry no line, but compat-report messages lead with the node label
 *  (`#id:`, `<tag>:`) — when the anchor file's text is readable, the item
 *  jumps to that label's line instead of a useless 1:1. Tree-shaking
 *  removals are deliberately NOT problems — informational, and anchoring a
 *  symbol list without locations would only spam line 1. */
export function buildProblemItems(
  report: DiagnosticsReportLite,
  root: string,
  exists: (p: string) => boolean,
  readText?: (p: string) => string | undefined,
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
    // filePath often names an intermediate (app.ui.html) that does not exist
    // on disk — resolve falls through to the report's entry file.
    const file = resolveFile(t.filePath) ?? entry;
    let startLine = 0;
    let startColumn = 0;
    let endColumn = 1;
    if (readText !== undefined) {
      const labelMatch = /^([#<][\w-]*):\s/.exec(t.message);
      const text = labelMatch !== null ? readText(file) : undefined;
      const anchor = text !== undefined && labelMatch !== null
        ? anchorLabel(text, labelMatch[1])
        : undefined;
      if (anchor !== undefined) {
        startLine = anchor.line;
        startColumn = anchor.column;
        endColumn = anchor.column + anchor.length;
      }
    }
    items.push({
      file,
      startLine,
      startColumn,
      endLine: startLine,
      endColumn,
      severity: t.severity === 'error' ? 'error' : t.severity === 'warning' ? 'warning' : 'information',
      message: t.message + (t.hint !== undefined && t.hint.length > 0 ? ` Hint: ${t.hint}` : ''),
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

// ── Markdown rendering (diagnostics.md → panel HTML) ───────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render the subset of Markdown the diagnostics report writer emits:
 *  headings, tables, blockquotes, fenced code, lists, hr, and inline
 *  code/bold/italic/links. Anything else passes through as a paragraph.
 *  HTML-escaped throughout — the report embeds user paths and code names.
 *  Mermaid fences become <pre class="mermaid"> blocks the page hands to
 *  mermaid.js (falling back to the readable source when it cannot load). */
export function renderMarkdown(md: string): string {
  const inline = (src: string): string => {
    let out = '';
    for (const part of src.split(/(`[^`]+`)/g)) {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        out += '<code>' + esc(part.slice(1, -1)) + '</code>';
        continue;
      }
      let t = esc(part);
      t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
      t = t.replace(/(^|[\s(])_([^_]+)_/g, '$1<i>$2</i>');
      t = t.replace(/(^|[\s(*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
      out += t;
    }
    return out;
  };
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\w*)/.exec(line);
    if (fence !== null) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence (or EOF)
      const body = buf.join('\n');
      out.push(fence[1] === 'mermaid'
        ? '<pre class="mermaid">' + esc(body) + '</pre>'
        : '<pre><code>' + esc(body) + '</code></pre>');
      continue;
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1])) {
      const cells = (r: string): string[] => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push('<table><tr>' + header.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr>'
        + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('')
        + '</table>');
      continue;
    }
    if (/^> ?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^> ?/.test(lines[i])) {
        buf.push(lines[i].replace(/^> ?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length + 1; // demote one: # is the panel title
      out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
      i++;
      continue;
    }
    if (/^ *([-*]|\d+\.) /.test(line)) {
      const ordered = /^ *\d+\. /.test(line);
      const itemRe = ordered ? /^ *\d+\. (.*)$/ : /^ *[-*] (.*)$/;
      const items: string[] = [];
      while (i < lines.length) {
        const m = itemRe.exec(lines[i]);
        if (m === null) break;
        items.push(m[1]);
        i++;
      }
      out.push('<' + (ordered ? 'ol' : 'ul') + '>'
        + items.map((t) => '<li>' + inline(t) + '</li>').join('')
        + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }
    if (/^ *---+ *$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== ''
      && !/^(#{1,6} |```|\||> ?| *([-*]|\d+\.) | *---+ *$)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return out.join('\n');
}

// ── Report page (the webview HTML) ─────────────────────────────────────────

export interface ReportPayload {
  /** renderMarkdown() output of diagnostics.md. */
  html: string;
  /** Quick-glance line above the report (board · framework · entry). */
  meta?: string;
  problemCount?: number;
}

/** The report webview over diagnostics.md itself: the markdown is rendered
 *  host-side (renderMarkdown); the page injects it and hands the Mermaid
 *  blocks to mermaid.js from a CDN — offline (or blocked), the diagram
 *  source stays readable in place. Live updates via postMessage (the
 *  trace-panel contract; the extension's file watcher pushes fresh views). */
export function reportHtml(initial: ReportPayload | { error: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: https:;">
<style>
  body { font: 13px/1.5 var(--vscode-font-family, system-ui), sans-serif; margin: 12px 16px;
         background: var(--vscode-editor-background, #111); color: var(--vscode-editor-foreground, #ddd); }
  h1 { font-size: 14px; margin: 0 0 6px; font-weight: 600; }
  h2 { font-size: 13px; margin: 20px 0 6px; font-weight: 600;
       border-bottom: 1px solid var(--vscode-widget-border, #222); padding-bottom: 3px; }
  h3, h4 { font-size: 12px; margin: 14px 0 4px; font-weight: 600; }
  #meta { color: var(--vscode-descriptionForeground, #888); margin-bottom: 10px; }
  #meta .problems { color: var(--vscode-editorWarning-foreground, #ca8); }
  blockquote { margin: 4px 0 10px; padding: 2px 10px; border-left: 3px solid var(--vscode-widget-border, #333);
               color: var(--vscode-descriptionForeground, #999); }
  blockquote b, blockquote code { color: var(--vscode-editor-foreground, #ddd); }
  table { border-collapse: collapse; margin: 6px 0 12px; max-width: 100%; }
  th, td { text-align: left; padding: 3px 14px 3px 0; vertical-align: top; font-size: 12px;
           border-bottom: 1px solid var(--vscode-widget-border, #222); }
  th { color: var(--vscode-descriptionForeground, #888); font-weight: normal; }
  code { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
         background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 0 4px; border-radius: 3px; }
  pre { overflow: auto; }
  pre code { display: block; padding: 8px; }
  pre.mermaid { text-align: center; background: var(--vscode-textCodeBlock-background, #1a1a1a);
                border: 1px solid var(--vscode-widget-border, #222); border-radius: 4px; padding: 8px; }
  pre.mermaid:not([data-processed]) { font-family: var(--vscode-editor-font-family, monospace);
                font-size: 11px; white-space: pre; text-align: left; color: var(--vscode-descriptionForeground, #888); }
  hr { border: 0; border-top: 1px solid var(--vscode-widget-border, #222); margin: 14px 0; }
  ul, ol { margin: 4px 0 10px; padding-left: 22px; }
  li { margin: 2px 0; }
</style></head><body>
<h1>typeCAD/hal diagnostics</h1>
<div id="meta"></div>
<div id="body"></div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
const vscode = acquireVsCodeApi();
let d = ${JSON.stringify(initial)};
async function render(d) {
  const meta = document.getElementById('meta');
  const body = document.getElementById('body');
  if (d.error) { meta.textContent = ''; body.textContent = d.error; return; }
  meta.innerHTML = '';
  if (d.meta !== undefined && d.meta.length > 0) meta.append(d.meta + ' · ');
  if (d.problemCount !== undefined) {
    const s = document.createElement('span');
    s.className = 'problems';
    s.textContent = d.problemCount + ' problem' + (d.problemCount === 1 ? '' : 's') + ' (Problems panel)';
    meta.append(s);
  }
  body.innerHTML = d.html;
  if (window.mermaid !== undefined) {
    try {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
      await mermaid.run({ nodes: Array.from(document.querySelectorAll('pre.mermaid')) });
    } catch (e) { /* a bad diagram stays as its readable source */ }
  }
}
window.addEventListener('message', (e) => { d = e.data; void render(d); });
void render(d);
</script></body></html>
`;
}
