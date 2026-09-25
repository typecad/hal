"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTrace = registerTrace;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const trace_core_1 = require("./trace-core");
const terminal_1 = require("./terminal");
const intel_1 = require("./intel");
const hal_root_1 = require("./hal-root");
const TRACE_FILE = 'trace.json';
/** The reused viewer panel (one at a time — a second open just refreshes). */
let panel;
let watcher;
let panelRoot;
function config() {
    return vscode.workspace.getConfiguration('typecad-hal.trace');
}
function tracePath(root) {
    return path.join(root, TRACE_FILE);
}
/** The project's config file: the resolved root OR ANY ANCESTOR of it —
 *  the same walk findHalRoot uses to pick the root (a fw/ folder under a
 *  combined typeCAD project keeps its config one level up, and the engine's
 *  own loader walks up, so the extension must too). */
function configPathFor(root) {
    let dir = path.resolve(root);
    for (;;) {
        const p = path.join(dir, hal_root_1.HAL_CONFIG_FILE);
        if (fs.existsSync(p))
            return p;
        const parent = path.dirname(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
}
function traceEnabled(root) {
    const configPath = configPathFor(root);
    if (!configPath)
        return false;
    try {
        const text = fs.readFileSync(configPath, 'utf8');
        return /trace\s*:\s*\{\s*enabled\s*:\s*true/.test(text);
    }
    catch {
        return false;
    }
}
/** Insert the zephyr.trace record: nested inside an existing zephyr record
 *  when there is one (a second top-level zephyr key would be a hard
 *  TS1117 error — most projects already configure probe/runner there),
 *  else anchored after the board/framework line. An explicit
 *  `enabled: false` flips to true — enabling is the command's whole point. */
function insertTraceConfig(root) {
    const configPath = configPathFor(root);
    if (!configPath)
        return 'no-config';
    let text;
    try {
        text = fs.readFileSync(configPath, 'utf8');
    }
    catch {
        return 'no-config';
    }
    if (/trace\s*:\s*\{\s*enabled/.test(text)) {
        if (!/trace\s*:\s*\{\s*enabled\s*:\s*true/.test(text)) {
            text = text.replace(/(trace\s*:\s*\{\s*enabled\s*:\s*)false/, '$1true');
            try {
                fs.writeFileSync(configPath, text, 'utf8');
                return 'inserted';
            }
            catch {
                return 'no-config';
            }
        }
        return 'present';
    }
    const lines = text.split('\n');
    const zephyrIdx = lines.findIndex((l) => /^\s*zephyr\s*:\s*\{/.test(l));
    if (zephyrIdx >= 0) {
        const line = lines[zephyrIdx];
        const afterBrace = line.slice(line.indexOf('{') + 1);
        if (afterBrace.includes('}')) {
            // Single-line record (zephyr: { probe: 'stlink' }) — lead with the
            // trace property so the splice stays inside the braces.
            lines[zephyrIdx] = line.replace('{', '{ trace: { enabled: true, intervalMs: 1000 },');
        }
        else {
            const indent = `${(/^[ \t]*/.exec(line) ?? [''])[0]}  `;
            lines.splice(zephyrIdx + 1, 0, `${indent}trace: { enabled: true, intervalMs: 1000 },`);
        }
        try {
            fs.writeFileSync(configPath, lines.join('\n'), 'utf8');
            return 'inserted';
        }
        catch {
            return 'no-config';
        }
    }
    let anchor = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*(board|framework)\s*:/.test(lines[i]))
            anchor = i;
    }
    if (anchor < 0)
        return 'no-anchor';
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
    }
    catch {
        return 'no-config';
    }
}
/** (Re)open the viewer on <root>/trace.json; keep it live via fs.watch. */
function openViewer(root) {
    const file = tracePath(root);
    const data = () => {
        try {
            const capture = (0, trace_core_1.readCapture)(fs.readFileSync(file, 'utf8'));
            if (capture === undefined)
                throw new Error('not a trace@1 capture');
            return (0, trace_core_1.buildTimelineData)(capture);
        }
        catch {
            return {
                error: `No capture at ${TRACE_FILE} yet — run typeCAD/hal: Trace — Capture from Board`
                    + ' (the file appears after the first heartbeat).',
            };
        }
    };
    if (panel === undefined) {
        panel = vscode.window.createWebviewPanel('typecadTraceView', 'typeCAD/hal Trace', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
        panel.onDidDispose(() => {
            panel = undefined;
            panelRoot = undefined;
            watcher?.close();
            watcher = undefined;
        });
    }
    else {
        panel.reveal();
    }
    if (panelRoot !== root) {
        watcher?.close();
        watcher = undefined;
        panelRoot = root;
    }
    panel.webview.html = (0, trace_core_1.viewerHtml)(data());
    if (watcher === undefined) {
        try {
            watcher = fs.watch(path.dirname(file), (_event, name) => {
                if (name !== TRACE_FILE || panel === undefined)
                    return;
                try {
                    panel.webview.postMessage(data());
                }
                catch {
                    // panel mid-dispose — the next open re-reads
                }
            });
        }
        catch {
            // Directory watch failed — the panel still shows the last full read.
        }
    }
}
async function captureTrace() {
    const root = activeRoot();
    if (!root) {
        void vscode.window.showWarningMessage('typeCAD/hal: no typecad-hal project open.');
        return;
    }
    if (!traceEnabled(root)) {
        const choice = await vscode.window.showWarningMessage('This build has no zephyr.trace record — the capture would see no [TR: heartbeat lines.', 'Enable tracing');
        if (choice === 'Enable tracing') {
            void vscode.commands.executeCommand('typecad-trace.enable');
        }
        return;
    }
    const port = await (0, intel_1.pickPort)();
    if (!port)
        return;
    const duration = config().get('captureDurationSeconds', 15);
    if (config().get('openViewerOnCapture', true))
        openViewer(root);
    (0, terminal_1.typecadTerminal)(root).sendText(`npx typecad-hal trace capture --port ${port} --duration ${duration} --output ${TRACE_FILE}`);
}
function showReport() {
    const root = activeRoot();
    if (!root) {
        void vscode.window.showWarningMessage('typeCAD/hal: no typecad-hal project open.');
        return;
    }
    (0, terminal_1.typecadTerminal)(root).sendText(`npx typecad-hal trace report --input ${TRACE_FILE}`);
}
async function enableTrace() {
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
        void vscode.window.showWarningMessage('typeCAD/hal: could not find a board/framework line to anchor the zephyr.trace block — add it manually: zephyr: { trace: { enabled: true, intervalMs: 1000 } },');
        return;
    }
    void vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage('typeCAD/hal: zephyr.trace enabled — rebuild + flash (typeCAD/hal: Flash & Monitor), then Trace — Capture.');
}
function activeRoot() {
    return currentRoot?.();
}
let currentRoot;
/** Register the Trace surface, rooted wherever resolveRoot points (the
 *  registerIntel/registerDeclarations convention). */
function registerTrace(context, resolveRoot) {
    currentRoot = resolveRoot;
    context.subscriptions.push(vscode.commands.registerCommand('typecad-trace.capture', () => void captureTrace()), vscode.commands.registerCommand('typecad-trace.view', () => {
        const root = activeRoot();
        if (root)
            openViewer(root);
        else
            void vscode.window.showWarningMessage('typeCAD/hal: no typecad-hal project open.');
    }), vscode.commands.registerCommand('typecad-trace.report', () => showReport()), vscode.commands.registerCommand('typecad-trace.enable', () => void enableTrace()));
}
//# sourceMappingURL=trace.js.map