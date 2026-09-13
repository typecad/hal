"use strict";
// ---------------------------------------------------------------------------
// intel.ts — board-aware language intelligence (the former TypeCAD Intel
// extension, now a module of the merged TypeCAD extension, staged from
// packages/cuttlefish/assets/editor-extensions/typecad).
//
// The module is deliberately THIN. It resolves the PROJECT's own
// @typecad/cuttlefish copy — the same engine that builds the project, so
// editor diagnostics can never drift from build diagnostics — and calls its
// ./language-server surface (analyzeForEditor): a no-emit pass of the same
// graph walk, IR build, and validation suite `typecad-hal query` runs.
// Results land in the Problems panel; the status bar carries board + counts.
//
// Analysis triggers on save (the engine reads files from disk, so unsaved
// buffers are invisible to it — the `typecad-hal: watch build` task remains
// the streaming alternative) and whenever the config or the generated board
// module moves. Runs are serialized: the engine mutates process-global
// strategy state, so two concurrent passes would race.
//
// Everything degrades gracefully: no engine in node_modules → status hint;
// no config/entry → status hint; engine throw → status shows the message.
// A failure here must never take the extension host down with it.
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
exports.registerIntel = registerIntel;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_module_1 = require("node:module");
const vscode = __importStar(require("vscode"));
const board_facts_1 = require("./board-facts");
const terminal_1 = require("./terminal");
const DEBOUNCE_MS = 400;
let root;
let status;
let collection;
let enginePromise;
let chain = Promise.resolve();
let timer;
/** Facts from the generated board module — the hover source of truth. */
let boardFacts;
/** The sensor part catalog from the project's hal copy (lazy, best-effort). */
let sensorCatalog;
/** The last analysis's program facts — pin claims + headline numbers. */
let lastAnalysis;
/** Quick-fix payloads keyed by the published diagnostic they belong to. */
const fixes = new Map();
/** The after-line fact chips' decoration type (theme-styled, per-line text). */
let chipDecoration;
/** The serial port chosen this session — re-validated against attached ports on every use (see pickPort). */
let chosenPort;
/** The last analysis's board label, for status-line rebuilds. */
let lastBoardName;
// TypeScript compiles `import(expr)` in CommonJS output down to require(),
// which cannot load the engine's ESM dist on the extension host's Node.
// Routing through Function keeps a real, native dynamic import in the
// emitted JavaScript.
const nativeImport = new Function('specifier', 'return import(specifier);');
/** Register the intel surface for the workspace rooted at `workspaceRoot`. */
function registerIntel(context, workspaceRoot) {
    root = workspaceRoot;
    status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.command = 'typecad-intel.reanalyze';
    status.text = '$(circuit-board) typeCAD/hal';
    status.tooltip = 'typeCAD/hal — click to re-analyze the project';
    status.show();
    collection = vscode.languages.createDiagnosticCollection('typecad-intel');
    chipDecoration = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
            margin: '0 0 0 1.5em',
        },
    });
    context.subscriptions.push(status, collection, chipDecoration, vscode.commands.registerCommand('typecad-intel.reanalyze', () => run()), 
    // Runs by VS Code AFTER a quick-fix's edit is applied — the optimistic
    // clear below is why the squiggle disappears immediately even though the
    // engine re-derives from disk only on the next save.
    vscode.commands.registerCommand('typecad-intel.fixApplied', (uri, identity) => {
        const current = collection.get(uri);
        if (!current)
            return;
        const kept = current.filter((d) => !(d.range.start.line === identity.line
            && String(d.code ?? '') === String(identity.code ?? '')
            && d.message === identity.message));
        if (kept.length !== current.length)
            collection.set(uri, kept);
        refreshStatusFromCollection();
    }), vscode.commands.registerCommand('typecad-intel.flashMonitor', (uri) => runFlashMonitor(uri)), vscode.commands.registerCommand('typecad-intel.runTests', (uri) => runHardwareTests(uri)), 
    // Explicit port (re)selection — the cached choice otherwise holds until it
    // disappears from the attached-port list or the window reloads. Escaping
    // the picker keeps the current port.
    vscode.commands.registerCommand('typecad-intel.selectPort', () => void pickPort(true)), vscode.languages.registerHoverProvider([{ language: 'typescript' }, { language: 'javascript' }], { provideHover }), vscode.languages.registerCodeActionsProvider([{ language: 'typescript' }, { language: 'javascript' }], { provideCodeActions }), vscode.languages.registerCodeLensProvider([{ language: 'typescript' }, { language: 'javascript' }, { language: 'typecad-ui' }], { provideCodeLenses, resolveCodeLens }), vscode.window.onDidChangeActiveTextEditor(() => updateDecorations()), vscode.workspace.onDidChangeTextDocument(() => scheduleDecorations()), vscode.workspace.onDidSaveTextDocument((doc) => {
        const lang = doc.languageId;
        if (lang === 'typescript' || lang === 'javascript' || doc.fileName.endsWith('.ui'))
            schedule();
    }), watch('**/typecad-hal.config.ts'), watch('**/typecad-hal.facts.json'), watch('**/.typecad-hal/board.json'), watch('**/.typecad-hal/board.ts', () => {
        boardFacts = loadBoardFacts();
        updateDecorations();
    }));
    boardFacts = loadBoardFacts();
    updateDecorations();
    void loadSensorCatalog();
    schedule(250);
}
function watch(glob, onChangeExtra) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, glob));
    const changed = () => {
        onChangeExtra?.();
        schedule();
    };
    watcher.onDidChange(changed);
    watcher.onDidCreate(changed);
    watcher.onDidDelete(changed);
    return watcher;
}
function schedule(delay = DEBOUNCE_MS) {
    if (timer !== undefined)
        clearTimeout(timer);
    timer = setTimeout(() => {
        timer = undefined;
        run();
    }, delay);
}
/** Serialize analyses; performAnalysis never rejects, so the chain can't jam. */
function run() {
    chain = chain.then(performAnalysis);
}
async function performAnalysis() {
    if (!root)
        return;
    let engine;
    try {
        engine = await loadEngine();
    }
    catch (err) {
        status.text = '$(alert) typeCAD/hal';
        status.tooltip = `typeCAD/hal: ${err.message}\nClick to retry after installing.`;
        return;
    }
    let result;
    try {
        result = await engine.analyzeForEditor({ workspaceRoot: root });
    }
    catch (err) {
        // No config/entry, unreadable entry, engine-level failure — surface the
        // message in the status bar and keep the panel clean rather than stale.
        collection.clear();
        status.text = '$(alert) typeCAD/hal';
        status.tooltip = firstLine(err.message);
        return;
    }
    lastEntryFile = result.entryFile;
    const byUri = new Map();
    let errors = 0;
    let warnings = 0;
    fixes.clear();
    lastAnalysis = {
        pinUsage: result.pinUsage ?? [],
        summary: result.summary ?? { staticBytes: 0, stackDepth: 0, asyncTasks: 0, isrHandlers: 0, usesTimers: false },
    };
    for (const d of result.diagnostics ?? []) {
        if (d.severity === 'error')
            errors++;
        else if (d.severity === 'warning')
            warnings++;
        const entry = toVscodeDiagnostic(d, result.entryFile);
        if (!entry)
            continue;
        if (d.fix)
            fixes.set(entry[1], d.fix);
        const key = entry[0].toString();
        const list = byUri.get(key);
        if (list)
            list.push(entry[1]);
        else
            byUri.set(key, [entry[1]]);
    }
    collection.set([...byUri.entries()].map(([key, list]) => [vscode.Uri.parse(key), list]));
    const board = result.board ?? 'no board';
    lastBoardName = result.board;
    status.text = `$(circuit-board) ${board} · ${errors}E ${warnings}W`;
    status.tooltip = `typeCAD/hal — analyzed ${path.basename(result.entryFile)}`
        + `${result.framework ? ` (${result.framework})` : ''}: ${errors} error(s), ${warnings} warning(s).`
        + statusSummaryLine(lastAnalysis.summary)
        + '\nClick to re-analyze.';
}
/** The status-bar tooltip's headline numbers (memory estimate + tasks). */
function statusSummaryLine(s) {
    if (!s || (s.staticBytes === 0 && s.asyncTasks === 0 && s.isrHandlers === 0 && !s.usesTimers))
        return '';
    const parts = [`~${s.staticBytes} B static`, `stack depth ${s.stackDepth}`];
    if (s.asyncTasks > 0)
        parts.push(`${s.asyncTasks} async task${s.asyncTasks === 1 ? '' : 's'}`);
    if (s.isrHandlers > 0)
        parts.push(`${s.isrHandlers} ISR`);
    parts.push(`timers ${s.usesTimers ? 'on' : 'off'}`);
    return `\n${parts.join(' · ')}`;
}
/** Rebuild the status counts from the live collection (after an optimistic
 *  diagnostic removal — cheaper than a full re-analysis). */
function refreshStatusFromCollection() {
    let errors = 0;
    let warnings = 0;
    for (const [, diags] of collection) {
        for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error)
                errors++;
            else if (d.severity === vscode.DiagnosticSeverity.Warning)
                warnings++;
        }
    }
    status.text = `$(circuit-board) ${lastBoardName ?? 'typeCAD/hal'} · ${errors}E ${warnings}W`;
}
/** Resolve + load the project's own engine, caching success (not failure). */
async function loadEngine() {
    if (!enginePromise) {
        enginePromise = (async () => {
            const entry = resolveEngineEntry(root);
            if (!entry) {
                throw new Error('@typecad/cuttlefish not found in this workspace — run npm install, then re-analyze.');
            }
            return nativeImport(pathToFileUrl(entry));
        })();
        // A failed resolve/import must not pin the failure forever.
        enginePromise.catch(() => {
            enginePromise = undefined;
        });
    }
    return enginePromise;
}
function resolveEngineEntry(projectRoot) {
    try {
        const req = (0, node_module_1.createRequire)(path.join(projectRoot, 'package.json'));
        return req.resolve('@typecad/cuttlefish/language-server');
    }
    catch {
        // fall through to the direct path
    }
    const direct = path.join(projectRoot, 'node_modules', '@typecad', 'cuttlefish', 'dist', 'language-server.js');
    return fs.existsSync(direct) ? direct : undefined;
}
function toVscodeDiagnostic(d, entryFile) {
    const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error
        : d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;
    const message = d.hint ? `${d.message}\n💡 ${d.hint}` : d.message;
    const range = rangeOf(d);
    const resolved = resolveDiagnosticFile(d.filePath, entryFile);
    if (resolved.uri) {
        return [resolved.uri, new vscode.Diagnostic(range, message, severity)];
    }
    // The named file can't be located — file the diagnostic on the entry with
    // its intended location in the message rather than dropping it.
    return [
        vscode.Uri.file(entryFile),
        new vscode.Diagnostic(range, `[${d.filePath}] ${message}`, severity),
    ];
}
function rangeOf(d) {
    // Engine lines/columns are 1-based; VS Code positions are 0-based.
    const line = Math.max(0, (d.line ?? 1) - 1);
    const col = Math.max(0, (d.column ?? 1) - 1);
    return new vscode.Range(line, col, line, col);
}
function resolveDiagnosticFile(filePath, entryFile) {
    if (!filePath)
        return { uri: vscode.Uri.file(entryFile) };
    if (path.isAbsolute(filePath) && fs.existsSync(filePath))
        return { uri: vscode.Uri.file(filePath) };
    const resolved = path.resolve(root, filePath);
    if (fs.existsSync(resolved))
        return { uri: vscode.Uri.file(resolved) };
    // Basename against the entry's directory (engines sometimes report names).
    const beside = path.resolve(path.dirname(entryFile), path.basename(filePath));
    if (fs.existsSync(beside))
        return { uri: vscode.Uri.file(beside) };
    return {};
}
function firstLine(text) {
    const line = text.split(/\r?\n/)[0] ?? text;
    return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
// -- hover: variables bound to board facts ------------------------------------
//
// tsserver already shows the generated board module's JSDoc when hovering a
// pin/bus export (PA0, I2C0). This provider covers the user's OWN bindings,
// which plain TypeScript tooling cannot know about: `const adc = new ADC(PA0)`
// (an ADC on PA0), `const s = PA0` (a pin alias), `const therm =
// I2C0.device(0x48)` (a device on a board bus). Same-file declarations only;
// returning undefined lets tsserver's hover stand unchanged.
function provideHover(document, position) {
    if (!boardFacts)
        return undefined;
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_$][\w$]*/);
    if (!wordRange)
        return undefined;
    const identifier = document.getText(wordRange);
    if (!identifier)
        return undefined;
    // A word inside string text or a comment is not an identifier — only the
    // sensor tokens (SENSOR('bme688') — inside quotes by design) may hover
    // from a non-code position.
    const inCode = (0, board_facts_1.isCodePosition)(document.getText(), document.offsetAt(position));
    if (!inCode && !sensorCatalog?.[identifier])
        return undefined;
    const info = (0, board_facts_1.resolveIdentifierHover)(document.getText(), boardFacts, identifier, {
        ...(lastAnalysis ? { programPinUsage: lastAnalysis.pinUsage } : {}),
        ...(sensorCatalog ? { sensors: sensorCatalog } : {}),
    });
    if (!info)
        return undefined;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${escapeMarkdown(info.title)}**`);
    if (info.detail) {
        for (const line of info.detail.split('\n')) {
            if (line.trim())
                md.appendMarkdown(`\n\n${escapeMarkdown(line)}`);
        }
    }
    return new vscode.Hover(md, wordRange);
}
// -- quick-fixes: engine-computed pin swaps -----------------------------------
//
// The engine's pin-capability diagnostics carry a computed fix (the first
// pin on this board that supports the operation). The action swaps the
// offending pin identifier at its CONSTRUCTION sites — pin-argument
// positions only, never blanket replaces: the same pad may legitimately
// serve plain GPIO elsewhere in the file.
function provideCodeActions(document, range) {
    const actions = [];
    const diags = collection.get(document.uri) ?? [];
    for (const diag of diags) {
        if (!diag.range.contains(range.start) && !range.contains(diag.range.start))
            continue;
        const fix = fixes.get(diag);
        if (!fix)
            continue;
        const edits = [...pinSwapEdits(document, fix), ...positionedEdits(document, fix)];
        if (edits.length === 0)
            continue;
        const action = new vscode.CodeAction(fix.title
            ?? (fix.swap ? `TypeCAD: Use ${fix.swap.to} instead of ${fix.swap.from}` : 'TypeCAD: Apply suggested fix'), vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.set(document.uri, edits);
        action.diagnostics = [diag];
        action.isPreferred = true;
        // VS Code applies the edit, then runs the marker command — which clears
        // this diagnostic immediately (the disk-based analysis only catches up
        // on the next save).
        action.command = {
            command: 'typecad-intel.fixApplied',
            title: 'TypeCAD fix applied',
            arguments: [document.uri, { line: diag.range.start.line, code: diag.code, message: diag.message }],
        };
        actions.push(action);
    }
    return actions;
}
/**
 * Engine-computed substitutions at 1-based positions, applied only where
 * the document still says `fromText` — analysis is save-triggered, so the
 * fix self-skips drifted pieces instead of mangling the line.
 */
function positionedEdits(document, fix) {
    const out = [];
    for (const e of fix.edits ?? []) {
        if (e.line < 1 || e.line > document.lineCount)
            continue;
        const line = document.lineAt(e.line - 1);
        const col = Math.min(Math.max(e.column - 1, 0), line.range.end.character);
        const editRange = new vscode.Range(e.line - 1, col, e.line - 1, col + e.fromText.length);
        if (document.getText(editRange) !== e.fromText)
            continue;
        out.push(vscode.TextEdit.replace(editRange, e.toText));
    }
    return out;
}
/** Replace the swap's `from` where it appears as a pin argument of a `new X(…)` call. */
function pinSwapEdits(document, fix) {
    if (!fix.swap)
        return [];
    const text = document.getText();
    const escaped = fix.swap.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(new\\s+[A-Za-z_$][\\w$]*\\s*\\([^)\\n]*?)\\b${escaped}\\b`, 'g');
    const edits = [];
    for (const m of text.matchAll(re)) {
        const start = m.index + m[1].length;
        edits.push(vscode.TextEdit.replace(new vscode.Range(document.positionAt(start), document.positionAt(start + fix.swap.from.length)), fix.swap.to));
    }
    return edits;
}
// -- inline decorations: after-line fact chips ---------------------------------
//
// What the construction line's pin can do that the code does not say:
// `const adc = new ADC(PA0)` renders "⌁ PWM pwm2 ch1 · ADC adc1 ch0 ·
// aliases: BUTTON" after the line. Pure scan over the LIVE document text
// (unsaved edits included), refreshed on keystroke-debounce and whenever the
// board module regenerates.
let decorationTimer;
function scheduleDecorations() {
    if (decorationTimer !== undefined)
        clearTimeout(decorationTimer);
    decorationTimer = setTimeout(() => {
        decorationTimer = undefined;
        updateDecorations();
    }, 300);
}
function updateDecorations() {
    for (const editor of vscode.window.visibleTextEditors) {
        const lang = editor.document.languageId;
        if (lang !== 'typescript' && lang !== 'javascript')
            continue;
        if (!boardFacts) {
            editor.setDecorations(chipDecoration, []);
            continue;
        }
        const specs = (0, board_facts_1.scanDecorations)(editor.document.getText(), boardFacts);
        const options = specs.flatMap((s) => {
            const line = editor.document.lineAt(Math.min(s.line, editor.document.lineCount - 1));
            return [{
                    range: new vscode.Range(line.range.end, line.range.end),
                    renderOptions: { after: { contentText: ` ${s.text}` } },
                }];
        });
        editor.setDecorations(chipDecoration, options);
    }
}
// -- CodeLens: Flash & Monitor on the entry, Run on Hardware on test files ----
function provideCodeLenses(document) {
    const lenses = [];
    const top = new vscode.Range(0, 0, 0, 0);
    if (lastEntryFile && sameFile(document.uri.fsPath, lastEntryFile)) {
        lenses.push(new vscode.CodeLens(top, { title: '▶ Flash & Monitor', command: 'typecad-intel.flashMonitor', arguments: [document.uri] }));
    }
    if (isTestFile(document.uri.fsPath)) {
        lenses.push(new vscode.CodeLens(top, { title: '⚡ Run on Hardware', command: 'typecad-intel.runTests', arguments: [document.uri] }));
    }
    return lenses;
}
function resolveCodeLens(lens) {
    return lens;
}
/** The analyzed entry, when the last engine pass resolved one. */
let lastEntryFile;
function isTestFile(fsPath) {
    const norm = fsPath.replaceAll('\\', '/');
    return /(^|\/)tests?\//.test(norm) || /\.test\.ts$/.test(norm);
}
function sameFile(a, b) {
    return a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();
}
/**
 * The session's serial-port choice: quick pick (then manual entry), reused
 * across commands. A cached port is re-validated against the attached ports
 * on every use — one that no longer exists (the board moved, or the OS
 * assigned a different COM number) re-opens the picker instead of flashing
 * into a ghost port. The `typecad-intel.selectPort` command forces the
 * picker open at any time.
 */
async function pickPort(force = false) {
    let ports = [];
    let listed = true;
    try {
        const engine = await loadEngine();
        ports = await engine.listPorts();
    }
    catch {
        listed = false; // no engine/serialport — trust a cached choice, else manual entry
    }
    if (!force && chosenPort) {
        // Without a port list there is nothing to validate against.
        if (!listed || ports.length === 0)
            return chosenPort;
        if (ports.some((p) => p.path === chosenPort))
            return chosenPort;
        // Stale: the chosen port is gone from the machine — fall through to the
        // picker so the board's new port can be selected.
    }
    if (ports.length > 0) {
        const pick = await vscode.window.showQuickPick(ports.map((p) => ({
            label: p.path,
            description: p.manufacturer ? `${p.manufacturer} · ${p.vid.toUpperCase()}:${p.pid.toUpperCase()}` : `${p.vid.toUpperCase()}:${p.pid.toUpperCase()}`,
            value: p.path,
        })), { placeHolder: chosenPort ? `Select the board’s serial port (was ${chosenPort})` : 'Select the board’s serial port' });
        if (pick)
            chosenPort = pick.value;
        return chosenPort;
    }
    const typed = await vscode.window.showInputBox({
        prompt: 'Serial port (e.g. COM4, /dev/ttyACM0)',
        placeHolder: 'COM4',
    });
    if (typed)
        chosenPort = typed.trim();
    return chosenPort;
}
async function runFlashMonitor(uri) {
    const entry = uri?.fsPath ?? lastEntryFile ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!entry || !root) {
        void vscode.window.showWarningMessage('TypeCAD: no entry file — run an analysis first (TypeCAD: Re-analyze Project).');
        return;
    }
    const port = await pickPort();
    if (!port)
        return;
    (0, terminal_1.typecadTerminal)().sendText(`npx typecad-hal build --compile --upload --monitor --port ${port}`);
}
async function runHardwareTests(uri) {
    if (!root)
        return;
    const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!file)
        return;
    const port = await pickPort();
    if (!port)
        return;
    const rel = path.relative(root, file).replaceAll('\\', '/');
    (0, terminal_1.typecadTerminal)().sendText(`npx typecad-hal test "${rel}" --port ${port}`);
}
/**
 * Locate and parse the workspace's generated board module + manifest — the
 * same ≤8-dir walk-up the engine's findGeneratedBoard uses. Missing/unreadable
 * → undefined (hovers simply fall back to tsserver).
 */
function loadBoardFacts() {
    if (!root)
        return undefined;
    let dir = root;
    for (let depth = 0; depth < 8 && dir; depth++) {
        const boardTs = path.join(dir, '.typecad-hal', 'board.ts');
        try {
            if (fs.existsSync(boardTs)) {
                const boardJson = path.join(dir, '.typecad-hal', 'board.json');
                const jsonText = fs.existsSync(boardJson) ? fs.readFileSync(boardJson, 'utf8') : undefined;
                return (0, board_facts_1.parseBoardModule)(fs.readFileSync(boardTs, 'utf8'), jsonText);
            }
        }
        catch {
            return undefined;
        }
        const parent = path.dirname(dir);
        dir = parent !== dir ? parent : undefined;
    }
    return undefined;
}
/**
 * Load the sensor part catalog from the project's own @typecad/hal copy
 * (SENSOR_PART_INFO off the './core' subpath) — fire-and-forget at
 * activation; hovers simply skip sensor facts until (unless) it lands.
 */
async function loadSensorCatalog() {
    if (!root)
        return;
    try {
        const req = (0, node_module_1.createRequire)(path.join(root, 'package.json'));
        const entry = req.resolve('@typecad/hal/core');
        const url = 'file:///' + path.resolve(entry).split(path.sep).join('/').replace(/^\/+/, '');
        const mod = (await nativeImport(url));
        if (mod.SENSOR_PART_INFO)
            sensorCatalog = mod.SENSOR_PART_INFO;
    }
    catch {
        // no hal copy installed yet — sensor hovers stay off
    }
}
function escapeMarkdown(text) {
    return text.replace(/[*`_\\]/g, '\\$&');
}
function pathToFileUrl(p) {
    const resolved = path.resolve(p).replaceAll('\\', '/');
    return `file:///${resolved.replace(/^\/+/, '')}`;
}
//# sourceMappingURL=intel.js.map