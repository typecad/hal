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
