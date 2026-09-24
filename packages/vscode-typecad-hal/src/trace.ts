// ---------------------------------------------------------------------------
// trace.ts — the Trace panel commands: capture, view, report, enable.
//
// Capture shells out through the shared typeCAD/hal terminal (the
// Flash & Monitor pattern) with the session's serial port; the panel is a
// webview that renders the capture with trace-core's canvas page and LIVE
// updates — the CLI rewrites trace.json after every closed heartbeat, so a
// file watcher is all the streaming the viewer needs. "Enable" inserts the
// zephyr.trace record into typecad-hal.config.ts (idempotent, opened for
// review) because a capture is silent against an untraced build.
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readCapture, buildTimelineData, viewerHtml, type TimelineData } from './trace-core';
import { typecadTerminal } from './terminal';
import { pickPort as pickSerialPort } from './intel';

const TRACE_FILE = 'trace.json';

/** The reused viewer panel (one at a time — a second open just refreshes). */
let panel: vscode.WebviewPanel | undefined;
let watcher: fs.FSWatcher | undefined;
let panelRoot: string | undefined;

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('typecad-hal.trace');
}

function tracePath(root: string): string {
  return path.join(root, TRACE_FILE);
}

function traceEnabled(root: string): boolean {
  try {
    const text = fs.readFileSync(path.join(root, 'typecad-hal.config.ts'), 'utf8');
    return /trace\s*:\s*\{\s*enabled\s*:\s*true/.test(text);
  } catch {
    return false;
  }
}

/** Insert the zephyr.trace record after the board (or framework) line.
 *  Returns false when it is already present or no anchor line exists. */
function insertTraceConfig(root: string): boolean {
  const configPath = path.join(root, 'typecad-hal.config.ts');
  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return false;
  }
  if (/trace\s*:\s*\{\s*enabled/.test(text)) return false;
  const lines = text.split('\n');
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(board|framework)\s*:/.test(lines[i])) anchor = i;
  }
  if (anchor < 0) return false;
  const indent = (/^\s*/.exec(lines[anchor]) ?? ['  '])[0];
  const block = [
    '',
    `${indent}// Runtime tracing — the heartbeat sampler behind the Trace commands`,
    `${indent}// (capture/view/report). Rebuild + flash after enabling.`,
    `${indent}zephyr: {`,
    `${indent}  trace: { enabled: true, intervalMs: 1000 },`,
    `${indent}},`,
  ];
  lines.splice(anchor + 1, 0, ...block);
  fs.writeFileSync(configPath, lines.join('\n'), 'utf8');
  return true;
}

/** (Re)open the viewer on <root>/trace.json; keep it live via fs.watch. */
function openViewer(root: string): void {
  const file = tracePath(root);
  const data = (): TimelineData | { error: string } => {
    try {
      const capture = readCapture(fs.readFileSync(file, 'utf8'));
      if (capture === undefined) throw new Error('not a trace@1 capture');
      return buildTimelineData(capture);
    } catch {
      return {
        error: `No capture at ${TRACE_FILE} yet — run TypeCAD: Trace — Capture from Board`
          + ' (the file appears after the first heartbeat).',
      };
    }
  };

  if (panel === undefined) {
    panel = vscode.window.createWebviewPanel(
      'typecadTraceView',
      'typeCAD/hal Trace',
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.onDidDispose(() => {
      panel = undefined;
      panelRoot = undefined;
      watcher?.close();
      watcher = undefined;
    });
  } else {
    panel.reveal();
  }
  if (panelRoot !== root) {
    watcher?.close();
    watcher = undefined;
    panelRoot = root;
  }
  panel.webview.html = viewerHtml(data());
  if (watcher === undefined) {
    try {
      watcher = fs.watch(path.dirname(file), (_event, name) => {
        if (name !== TRACE_FILE || panel === undefined) return;
        try {
          panel.webview.postMessage(data());
        } catch {
          // panel mid-dispose — the next open re-reads
        }
      });
    } catch {
      // Directory watch failed — the panel still shows the last full read.
    }
  }
}

async function captureTrace(): Promise<void> {
  const root = activeRoot();
  if (!root) {
    void vscode.window.showWarningMessage('TypeCAD: no typecad-hal project open.');
    return;
  }
  if (!traceEnabled(root)) {
    const choice = await vscode.window.showWarningMessage(
      'This build has no zephyr.trace record — the capture would see no [TR: heartbeat lines.',
      'Enable tracing',
    );
    if (choice === 'Enable tracing') {
      void vscode.commands.executeCommand('typecad-trace.enable');
    }
    return;
  }
  const port = await pickSerialPort();
  if (!port) return;
  const duration = config().get<number>('captureDurationSeconds', 15);
  if (config().get<boolean>('openViewerOnCapture', true)) openViewer(root);
  typecadTerminal(root).sendText(
    `npx typecad-hal trace capture --port ${port} --duration ${duration} --output ${TRACE_FILE}`,
  );
}

function showReport(): void {
  const root = activeRoot();
  if (!root) {
    void vscode.window.showWarningMessage('TypeCAD: no typecad-hal project open.');
    return;
  }
  typecadTerminal(root).sendText(`npx typecad-hal trace report --input ${TRACE_FILE}`);
}

async function enableTrace(): Promise<void> {
  const root = activeRoot();
  if (!root) {
    void vscode.window.showWarningMessage('TypeCAD: no typecad-hal project open.');
    return;
  }
  if (!fs.existsSync(path.join(root, 'typecad-hal.config.ts'))) {
    void vscode.window.showWarningMessage('TypeCAD: no typecad-hal.config.ts in the project root.');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(path.join(root, 'typecad-hal.config.ts'));
  if (traceEnabled(root)) {
    void vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage('TypeCAD: tracing is already enabled in this project.');
    return;
  }
  const ok = insertTraceConfig(root);
  if (!ok) {
    void vscode.window.showTextDocument(doc);
    void vscode.window.showWarningMessage(
      'TypeCAD: could not find a board/framework line to anchor the zephyr.trace block — add it manually: zephyr: { trace: { enabled: true, intervalMs: 1000 } },',
    );
    return;
  }
  void vscode.window.showTextDocument(doc);
  void vscode.window.showInformationMessage(
    'TypeCAD: zephyr.trace enabled — rebuild + flash (TypeCAD: Flash & Monitor), then Trace — Capture.',
  );
}

function activeRoot(): string | undefined {
  return currentRoot?.();
}

let currentRoot: (() => string | undefined) | undefined;

/** Register the Trace surface, rooted wherever resolveRoot points (the
 *  registerIntel/registerDeclarations convention). */
export function registerTrace(context: vscode.ExtensionContext, resolveRoot: () => string | undefined): void {
  currentRoot = resolveRoot;
  context.subscriptions.push(
    vscode.commands.registerCommand('typecad-trace.capture', () => void captureTrace()),
    vscode.commands.registerCommand('typecad-trace.view', () => {
      const root = activeRoot();
      if (root) openViewer(root);
      else void vscode.window.showWarningMessage('TypeCAD: no typecad-hal project open.');
    }),
    vscode.commands.registerCommand('typecad-trace.report', () => showReport()),
    vscode.commands.registerCommand('typecad-trace.enable', () => void enableTrace()),
  );
}
