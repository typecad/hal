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
import { HAL_CONFIG_FILE } from './hal-root';

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

/** The project's config file: the resolved root OR ANY ANCESTOR of it —
 *  the same walk findHalRoot uses to pick the root (a fw/ folder under a
 *  combined typeCAD project keeps its config one level up, and the engine's
 *  own loader walks up, so the extension must too). */
function configPathFor(root: string): string | undefined {
  let dir = path.resolve(root);
  for (;;) {
    const p = path.join(dir, HAL_CONFIG_FILE);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function traceEnabled(root: string): boolean {
  const configPath = configPathFor(root);
  if (!configPath) return false;
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    return /trace\s*:\s*\{\s*enabled\s*:\s*true/.test(text);
  } catch {
    return false;
  }
}

type InsertResult = 'inserted' | 'present' | 'no-config' | 'no-anchor';

/** Insert the zephyr.trace record: nested inside an existing zephyr record
 *  when there is one (a second top-level zephyr key would be a hard
 *  TS1117 error — most projects already configure probe/runner there),
 *  else anchored after the board/framework line. An explicit
 *  `enabled: false` flips to true — enabling is the command's whole point. */
function insertTraceConfig(root: string): InsertResult {
  const configPath = configPathFor(root);
  if (!configPath) return 'no-config';
  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return 'no-config';
  }
  if (/trace\s*:\s*\{\s*enabled/.test(text)) {
    if (!/trace\s*:\s*\{\s*enabled\s*:\s*true/.test(text)) {
      text = text.replace(/(trace\s*:\s*\{\s*enabled\s*:\s*)false/, '$1true');
      try {
        fs.writeFileSync(configPath, text, 'utf8');
        return 'inserted';
      } catch {
        return 'no-config';
      }
    }
    return 'present';
  }
  const lines = text.split('\n');
  const zephyrIdx = lines.findIndex((l) => /^\s*zephyr\s*:\s*\{/.test(l));
  if (zephyrIdx >= 0) {
    const line = lines[zephyrIdx]!;
    const afterBrace = line.slice(line.indexOf('{') + 1);
    if (afterBrace.includes('}')) {
      // Single-line record (zephyr: { probe: 'stlink' }) — lead with the
      // trace property so the splice stays inside the braces.
      lines[zephyrIdx] = line.replace('{', '{ trace: { enabled: true, intervalMs: 1000 },');
    } else {
      const indent = `${(/^[ \t]*/.exec(line) ?? [''])[0]}  `;
      lines.splice(zephyrIdx + 1, 0, `${indent}trace: { enabled: true, intervalMs: 1000 },`);
    }
    try {
      fs.writeFileSync(configPath, lines.join('\n'), 'utf8');
      return 'inserted';
    } catch {
      return 'no-config';
    }
  }
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(board|framework)\s*:/.test(lines[i])) anchor = i;
  }
  if (anchor < 0) return 'no-anchor';
  const indent = (/^[ \t]*/.exec(lines[anchor]) ?? ['  '])[0];
  const block = [
    '',
    `${indent}// Runtime tracing — the heartbeat sampler behind the Trace commands`,
    `${indent}// (capture/view/report). Rebuild + flash after enabling.`,
    `${indent}zephyr: {`,
    `${indent}  trace: { enabled: true, intervalMs: 1000 },`,
    `${indent}},`,
  ];
  lines.splice(anchor + 1, 0, ...block);
  try {
    fs.writeFileSync(configPath, lines.join('\n'), 'utf8');
    return 'inserted';
  } catch {
    return 'no-config';
  }
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
        error: `No capture at ${TRACE_FILE} yet — run typeCAD/hal: Trace — Capture from Board`
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
    void vscode.window.showWarningMessage('typeCAD/hal: no typecad-hal project open.');
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
    void vscode.window.showWarningMessage('typeCAD/hal: no typecad-hal project open.');
    return;
  }
  typecadTerminal(root).sendText(`npx typecad-hal trace report --input ${TRACE_FILE}`);
}

async function enableTrace(): Promise<void> {
  const root = activeRoot();
  if (!root) {
    void vscode.window.showWarningMessage('typeCAD/hal: no typecad-hal project open.');
    return;
  }
  const configPath = configPathFor(root);
  if (!configPath) {
    void vscode.window.showWarningMessage('typeCAD/hal: no typecad-hal.config.ts in the project root (or its ancestors).');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(configPath);
  if (traceEnabled(root)) {
    void vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage('typeCAD/hal: tracing is already enabled in this project.');
    return;
  }
  const result = insertTraceConfig(root);
  if (result === 'present') {
    void vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage('typeCAD/hal: tracing is already enabled in this project.');
    return;
  }
  if (result !== 'inserted') {
    void vscode.window.showTextDocument(doc);
    void vscode.window.showWarningMessage(
      'typeCAD/hal: could not find a board/framework line to anchor the zephyr.trace block — add it manually: zephyr: { trace: { enabled: true, intervalMs: 1000 } },',
    );
    return;
  }
  void vscode.window.showTextDocument(doc);
  void vscode.window.showInformationMessage(
    'typeCAD/hal: zephyr.trace enabled — rebuild + flash (typeCAD/hal: Flash & Monitor), then Trace — Capture.',
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
      else void vscode.window.showWarningMessage('typeCAD/hal: no typecad-hal project open.');
    }),
    vscode.commands.registerCommand('typecad-trace.report', () => showReport()),
    vscode.commands.registerCommand('typecad-trace.enable', () => void enableTrace()),
  );
}
