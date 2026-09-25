// ---------------------------------------------------------------------------
// diagnostics.ts — the Diagnostics commands: generate + Problems mapping.
//
// "Generate Report" builds with --diagnostics through the shared typeCAD/hal
// terminal (the Flash & Monitor pattern); the artifact lands in the project's
// output tree. A recursive watcher (armed on first use) maps each fresh
// diagnostics.json into the Problems panel — peripheral conflicts at their
// TypeScript source span, build diagnostics at the entry file — so a
// double-claimed pin becomes a clickable jump-to-source, the one thing the
// CLI cannot do. Tree-shaking stays a report fact, never a problem.
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  readDiagnosticsReport, buildProblemItems, buildReportView, findDiagnosticsReport,
  renderMarkdown, reportHtml, type ReportPayload,
} from './diagnostics-core';
import { typecadTerminal } from './terminal';

const DEBOUNCE_MS = 500;

let watcher: fs.FSWatcher | undefined;
let watchedRoot: string | undefined;
let debounceTimer: NodeJS.Timeout | undefined;

// The report webview panel (one at a time — a second open just refreshes),
// the trace-panel contract: initial payload baked in, live views pushed by
// a watcher on the report file.
let reportPanel: vscode.WebviewPanel | undefined;
let reportWatcher: fs.FSWatcher | undefined;
let reportPanelRoot: string | undefined;
// Set at registration — resolves the bundled media/ (mermaid) root.
let extContext: vscode.ExtensionContext | undefined;

const realFs = {
  exists: (p: string): boolean => fs.existsSync(p),
  readdir: (p: string): string[] => {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  },
  mtimeMs: (p: string): number => fs.statSync(p).mtimeMs,
};

/** Read the newest report and (re)populate the collection. Returns the item
 *  count; 0 also when no report exists (the collection is cleared so stale
 *  problems never outlive their report). */
function refreshProblems(
  collection: vscode.DiagnosticCollection,
  root: string,
): number {
  const found = findDiagnosticsReport(root, realFs);
  if (found === undefined) {
    collection.clear();
    return 0;
  }
  let report;
  try {
    report = readDiagnosticsReport(fs.readFileSync(found.file, 'utf8'));
  } catch {
    report = undefined; // mid-write — the watcher will bring the closed file
  }
  if (report === undefined) {
    return 0;
  }
  const items = buildProblemItems(report, root, realFs.exists, (f) => {
    try {
      return fs.readFileSync(f, 'utf8');
    } catch {
      return undefined;
    }
  });
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const item of items) {
    const severity = item.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : item.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(item.startLine, item.startColumn, item.endLine, item.endColumn),
      item.message,
      severity,
    );
    diagnostic.source = 'typeCAD/hal';
    diagnostic.code = item.code ?? 'diagnostics';
    const list = byFile.get(item.file);
    if (list === undefined) {
      byFile.set(item.file, [diagnostic]);
    } else {
      list.push(diagnostic);
    }
  }
  collection.clear();
  for (const [file, diagnostics] of byFile) {
    collection.set(vscode.Uri.file(file), diagnostics);
  }
  return items.length;
}

/** Read the newest report and build the webview's payload: the rendered
 *  diagnostics.md (the canonical report) plus a quick-glance meta line from
 *  the JSON beside it. */
function viewFor(root: string): { view: ReportPayload | { error: string }; file?: string; missing: boolean } {
  const found = findDiagnosticsReport(root, realFs);
  if (found === undefined) {
    return {
      view: { error: 'No diagnostics.json in the output tree yet — run typeCAD/hal: Diagnostics — Generate Report first.' },
      missing: true,
    };
  }
  try {
    const report = readDiagnosticsReport(fs.readFileSync(found.file, 'utf8'));
    if (report === undefined) {
      return { view: { error: `${path.relative(root, found.file)} is not a readable report (mid-write?) — it will refresh.` }, file: found.file, missing: false };
    }
    let markdown: string | undefined;
    try {
      markdown = fs.readFileSync(found.file.replace(/\.json$/, '.md'), 'utf8');
    } catch {
      markdown = undefined;
    }
    if (markdown === undefined) {
      return { view: { error: 'diagnostics.json found, but diagnostics.md is missing beside it — rebuild with --diagnostics.' }, file: found.file, missing: false };
    }
    const view = buildReportView(report);
    const m = view.metadata;
    const meta = [m.board, m.framework, m.target, `entry ${m.sourceFile}`]
      .filter((x) => x !== undefined)
      .join(' · ');
    return {
      view: { html: renderMarkdown(markdown), meta, problemCount: view.problemCount },
      file: found.file,
      missing: false,
    };
  } catch {
    return { view: { error: `Could not read ${path.relative(root, found.file)}.` }, file: found.file, missing: false };
  }
}

/** Open (or refresh) the report panel and stream fresh views from the
 *  report file — the watcher on its directory is all the streaming needed
 *  (the build rewrites diagnostics.json atomically enough for read+parse). */
function openReportPanel(root: string): void {
  const { view, file, missing } = viewFor(root);
  if (reportPanel === undefined) {
    reportPanel = vscode.window.createWebviewPanel(
      'typecadDiagnosticsView',
      'typeCAD/hal Diagnostics',
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    reportPanel.onDidDispose(() => {
      reportPanel = undefined;
      reportPanelRoot = undefined;
      reportWatcher?.close();
      reportWatcher = undefined;
    });
  } else {
    reportPanel.reveal();
  }
  if (reportPanelRoot !== root) {
    reportWatcher?.close();
    reportWatcher = undefined;
    reportPanelRoot = root;
  }
  // Offline-first diagrams: serve the bundled mermaid from the extension's
  // media/ via the webview resource URI; when the bundle is absent (a
  // vendored copy that skipped it), fall back to the CDN default.
  let mermaidOptions: Parameters<typeof reportHtml>[1];
  if (extContext !== undefined) {
    const mermaidPath = extContext.asAbsolutePath(path.join('media', 'mermaid.min.js'));
    if (fs.existsSync(mermaidPath)) {
      mermaidOptions = {
        mermaidSrc: reportPanel.webview.asWebviewUri(vscode.Uri.file(mermaidPath)).toString(),
        scriptSrc: reportPanel.webview.cspSource,
      };
    }
  }
  reportPanel.webview.html = reportHtml(view, mermaidOptions);
  if (file !== undefined && reportWatcher === undefined) {
    try {
      reportWatcher = fs.watch(path.dirname(file), (_event, name) => {
        if (name !== path.basename(file) || reportPanel === undefined) return;
        const fresh = viewFor(root);
        void reportPanel.webview.postMessage(fresh.view);
      });
    } catch {
      // unreadable directory — the panel shows the baked payload only
    }
  }
  if (missing) {
    void vscode.window.showInformationMessage(
      'No diagnostics.json in the output tree yet — run typeCAD/hal: Diagnostics — Generate Report first.',
    );
  }
}

export function registerDiagnostics(
  context: vscode.ExtensionContext,
  resolveRoot: () => string | undefined,
): void {
  extContext = context;
  const collection = vscode.languages.createDiagnosticCollection('typecad-hal');
  context.subscriptions.push(collection);
  // One stable dispose handle — armWatcher swaps the underlying watcher as
  // the root changes without stacking subscriptions.
  context.subscriptions.push({ dispose: () => { watcher?.close(); watcher = undefined; } });

  // Set by Generate, consumed by the watcher: when the fresh report the
  // build just wrote lands, open the report panel — "generate" ends with
  // the report in front of you, not just a terminal line.
  let openPanelOnNextReport = false;

  const armWatcher = (root: string): void => {
    if (watchedRoot === root && watcher !== undefined) return;
    watcher?.close();
    watcher = undefined;
    watchedRoot = root;
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, name) => {
        if (typeof name !== 'string' || path.basename(name.replaceAll('\\', '/')) !== 'diagnostics.json') {
          return;
        }
        if (debounceTimer !== undefined) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          refreshProblems(collection, root);
          if (openPanelOnNextReport) {
            openPanelOnNextReport = false;
            openReportPanel(root);
          }
        }, DEBOUNCE_MS);
      });
    } catch {
      // Recursive watch unsupported on this platform — the manual command
      // still refreshes; only the auto-update is lost.
      watcher = undefined;
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('typecad-diagnostics.generate', () => {
      const root = resolveRoot();
      if (root === undefined) {
        void vscode.window.showWarningMessage('typeCAD/hal: no project root — open a typecad-hal project first.');
        return;
      }
      armWatcher(root);
      refreshProblems(collection, root);
      openPanelOnNextReport = true;
      typecadTerminal(root).sendText('npx typecad-hal build --diagnostics');
    }),
    vscode.commands.registerCommand('typecad-diagnostics.showProblems', async () => {
      const root = resolveRoot();
      if (root === undefined) {
        void vscode.window.showWarningMessage('typeCAD/hal: no project root — open a typecad-hal project first.');
        return;
      }
      armWatcher(root);
      const found = findDiagnosticsReport(root, realFs);
      if (found === undefined) {
        void vscode.window.showInformationMessage(
          'No diagnostics.json in the output tree yet — run typeCAD/hal: Diagnostics — Generate Report first.',
        );
        return;
      }
      const count = refreshProblems(collection, root);
      void vscode.window.showInformationMessage(
        `Diagnostics: ${count} problem${count === 1 ? '' : 's'} from ${path.relative(root, found.file).replaceAll('\\', '/')}.`,
      );
      await vscode.commands.executeCommand('workbench.action.problems.focus');
    }),
  );
}
