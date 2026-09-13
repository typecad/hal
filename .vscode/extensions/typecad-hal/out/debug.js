"use strict";
// ---------------------------------------------------------------------------
// debug.ts — Serial.print breakpoint debugging (the former TypeCAD Debug
// extension, now a module of the merged TypeCAD extension).
//
// Tracks breakpoints in TypeScript files and syncs them to
// .typecad-hal/breakpoints.json for the TypeCAD debug preprocessor.
// Also auto-generates .d.ts declaration files from C++ sources.
//
// The breakpoint file is read by the engine when invoked with `--debug`. The
// preprocessor injects Serial.println instrumentation at the recorded line
// numbers; run `typecad-hal build --debug` (or `typecad-hal index.ts --debug`)
// to enable it.
//
// IMPORTANT: The `file` field in each breakpoint entry is written as the
// basename only (e.g. "index.ts"). The engine's loader matches breakpoints
// by exact → basename → suffix, and basename matching is the only strategy
// that works identically on Windows (backslash) and POSIX (forward slash)
// without slash normalization. The trade-off is that two files with the same
// basename in one project share breakpoints — acceptable for typical
// single-program Zephyr projects.
//
// The module only acts in TypeCAD workspaces (a typecad-hal.config.ts or a
// .typecad-hal/ directory at the workspace root): the extension activates on
// `onLanguage:typescript` in ANY workspace, and syncing breakpoints in an
// unrelated project would plant a stray .typecad-hal/ folder there.
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
exports.registerDebug = registerDebug;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const terminal_1 = require("./terminal");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Relative to the workspace root. */
const BREAKPOINTS_DIR = '.typecad-hal';
const BREAKPOINTS_FILE = 'breakpoints.json';
const CONFIG_FILE = 'typecad-hal.config.ts';
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
let root;
/** Register the debug surface for the workspace rooted at `workspaceRoot`. */
function registerDebug(context, workspaceRoot) {
    root = workspaceRoot;
    const breakpointTracker = new BreakpointTracker();
    const toggleCmd = vscode.commands.registerCommand('typecad-debug.toggleBreakpoint', () => breakpointTracker.toggleBreakpoint());
    const clearAllCmd = vscode.commands.registerCommand('typecad-debug.clearAllBreakpoints', () => breakpointTracker.clearAllBreakpoints());
    const debugCmd = vscode.commands.registerCommand('typecad-debug.debugWithBreakpoints', () => breakpointTracker.debugWithBreakpoints());
    const syncCmd = vscode.commands.registerCommand('typecad-debug.syncBreakpoints', () => breakpointTracker.syncFromVSCode());
    // Auto-sync breakpoints when saving TypeScript files.
    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.fileName.endsWith('.ts') && !doc.fileName.includes('node_modules')) {
            breakpointTracker.syncFromVSCode(true);
        }
    });
    const declGenerator = new DeclarationGenerator();
    const genDeclCmd = vscode.commands.registerCommand('typecad-debug.generateDeclaration', () => declGenerator.generateForCurrentFile());
    // Auto-generate a .d.ts when a C++ file is saved and the sidecar is missing.
    const cppSaveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.fileName.endsWith('.cpp') && !doc.fileName.includes('node_modules')) {
            void declGenerator.checkAndGenerate(doc.fileName);
        }
    });
    context.subscriptions.push(toggleCmd, clearAllCmd, debugCmd, syncCmd, saveListener, breakpointTracker, genDeclCmd, cppSaveListener, declGenerator);
}
// ---------------------------------------------------------------------------
// Workspace gating
// ---------------------------------------------------------------------------
/**
 * Whether this workspace is a TypeCAD project (config file or generated
 * .typecad-hal/ directory at the root). Checked before any breakpoint sync
 * so a foreign workspace that merely has the extension active never gets a
 * stray .typecad-hal/ folder planted in it.
 */
function isTypecadWorkspace() {
    if (!root)
        return false;
    return (fs.existsSync(path.join(root, CONFIG_FILE))
        || fs.existsSync(path.join(root, BREAKPOINTS_DIR)));
}
/** Quiet, self-dismissing hint for explicit commands outside TypeCAD projects. */
function notAProjectHint() {
    void vscode.window.setStatusBarMessage('TypeCAD: not a TypeCAD project workspace', 4000);
}
// ---------------------------------------------------------------------------
// Breakpoint Tracker
// ---------------------------------------------------------------------------
class BreakpointTracker {
    constructor() {
        /** file basename → line → Breakpoint. */
        this.breakpoints = new Map();
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChange = this._onDidChange.event;
        this.loadFromFile();
        // VSCode breakpoint gutter changes (red dots, conditions, logpoints).
        vscode.debug.onDidChangeBreakpoints(() => {
            this.syncFromVSCode(true);
        });
        // Re-sync when switching editor so a stale in-memory map doesn't survive.
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.syncFromVSCode(true);
            }
        });
    }
    /**
     * Toggle a breakpoint at the current cursor position.
     */
    toggleBreakpoint() {
        if (!isTypecadWorkspace()) {
            notAProjectHint();
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const filePath = editor.document.uri.fsPath;
        const fileName = path.basename(filePath);
        const line = editor.selection.active.line + 1; // 1-indexed
        if (!this.breakpoints.has(fileName)) {
            this.breakpoints.set(fileName, new Map());
        }
        const fileBreakpoints = this.breakpoints.get(fileName);
        if (fileBreakpoints.has(line)) {
            fileBreakpoints.delete(line);
            vscode.window.showInformationMessage(`TypeCAD: Breakpoint removed at line ${line}`);
        }
        else {
            fileBreakpoints.set(line, { file: fileName, line });
            vscode.window.showInformationMessage(`TypeCAD: Breakpoint added at line ${line}`);
        }
        this.saveToFile();
        this._onDidChange.fire();
    }
    /**
     * Clear all breakpoints.
     */
    clearAllBreakpoints() {
        if (!isTypecadWorkspace()) {
            notAProjectHint();
            return;
        }
        this.breakpoints.clear();
        this.saveToFile();
        vscode.window.showInformationMessage('TypeCAD: All breakpoints cleared');
        this._onDidChange.fire();
    }
    /**
     * Save breakpoints, then run `typecad-hal build --debug` in the shared terminal.
     */
    async debugWithBreakpoints() {
        if (!isTypecadWorkspace()) {
            notAProjectHint();
            return;
        }
        this.saveToFile();
        (0, terminal_1.typecadTerminal)().sendText('npx typecad-hal build --debug');
    }
    /**
     * Sync breakpoints from VSCode's built-in breakpoint system.
     * Captures conditional breakpoints and logpoints.
     * REPLACES all breakpoints with the current VS Code state.
     * Silent no-op in workspaces that are not TypeCAD projects.
     */
    syncFromVSCode(quiet = false) {
        if (!isTypecadWorkspace())
            return;
        const vscodeBreakpoints = vscode.debug.breakpoints;
        this.breakpoints.clear();
        let count = 0;
        for (const bp of vscodeBreakpoints) {
            if (bp instanceof vscode.SourceBreakpoint) {
                // Key the in-memory map by basename so saveToFile and the toggle path
                // agree on a single canonical key. The loader matches by basename.
                const filePath = bp.location.uri.fsPath;
                const fileName = path.basename(filePath);
                const line = bp.location.range.start.line + 1; // 1-indexed
                if (!this.breakpoints.has(fileName)) {
                    this.breakpoints.set(fileName, new Map());
                }
                this.breakpoints.get(fileName).set(line, {
                    file: fileName,
                    line,
                    condition: bp.condition,
                    logMessage: bp.logMessage, // LogMessageBreakpoint carries this
                });
                count++;
            }
        }
        this.saveToFile();
        if (!quiet) {
            void vscode.window.setStatusBarMessage(`TypeCAD: Synced ${count} breakpoints`, 3000);
        }
    }
    /**
     * Load breakpoints from .typecad-hal/breakpoints.json
     */
    loadFromFile() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return;
        const filePath = path.join(workspaceFolders[0].uri.fsPath, BREAKPOINTS_DIR, BREAKPOINTS_FILE);
        if (!fs.existsSync(filePath))
            return;
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const map = JSON.parse(content);
            for (const bp of map.breakpoints ?? []) {
                if (!this.breakpoints.has(bp.file)) {
                    this.breakpoints.set(bp.file, new Map());
                }
                this.breakpoints.get(bp.file).set(bp.line, bp);
            }
        }
        catch (err) {
            console.error('TypeCAD: Failed to load breakpoints:', err);
        }
    }
    /**
     * Save breakpoints to .typecad-hal/breakpoints.json atomically.
     * Writes to a temp file then renames, so a watching transpiler never reads
     * a half-written file.
     */
    saveToFile() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return;
        const dirPath = path.join(workspaceFolders[0].uri.fsPath, BREAKPOINTS_DIR);
        const filePath = path.join(dirPath, BREAKPOINTS_FILE);
        const tmpPath = `${filePath}.tmp`;
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
        }
        catch (mkdirErr) {
            console.error('TypeCAD: Failed to create directory:', mkdirErr);
            void vscode.window.showErrorMessage(`TypeCAD: Failed to create ${BREAKPOINTS_DIR} directory: ${mkdirErr}`);
            return;
        }
        const map = { breakpoints: [] };
        for (const [, fileBreakpoints] of this.breakpoints) {
            for (const [, bp] of fileBreakpoints) {
                map.breakpoints.push(bp);
            }
        }
        // Stable order for clean diffs and reproducible output.
        map.breakpoints.sort((a, b) => {
            if (a.file !== b.file)
                return a.file.localeCompare(b.file);
            return a.line - b.line;
        });
        try {
            fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2));
            fs.renameSync(tmpPath, filePath);
        }
        catch (err) {
            // Best effort: clean up the temp file on failure.
            try {
                fs.unlinkSync(tmpPath);
            }
            catch { }
            console.error('TypeCAD: Failed to save breakpoints:', err);
            void vscode.window.showErrorMessage(`TypeCAD: Failed to save breakpoints: ${err}`);
        }
    }
    dispose() {
        this._onDidChange.dispose();
    }
}
// ---------------------------------------------------------------------------
// Declaration Generator
// ---------------------------------------------------------------------------
class DeclarationGenerator {
    /**
     * Generate a .d.ts sidecar for a C++ file if one is not already present.
     */
    async checkAndGenerate(cppPath) {
        const declPath = cppPath.replace(/\.cpp$/i, '.d.ts');
        if (fs.existsSync(declPath)) {
            return; // Already exists — never clobber.
        }
        const result = await this.generateDeclaration(cppPath, declPath);
        if (result) {
            void vscode.window.showInformationMessage(`TypeCAD: Generated ${path.basename(declPath)} from ${path.basename(cppPath)}. Review and adjust types if needed.`);
        }
    }
    /**
     * Generate a declaration for the currently active C++ file.
     */
    async generateForCurrentFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showErrorMessage('TypeCAD: No active editor');
            return;
        }
        const filePath = editor.document.uri.fsPath;
        if (!filePath.endsWith('.cpp')) {
            void vscode.window.showErrorMessage('TypeCAD: Active file must be a .cpp file');
            return;
        }
        const declPath = filePath.replace(/\.cpp$/i, '.d.ts');
        const result = await this.generateDeclaration(filePath, declPath);
        if (result) {
            void vscode.window.showInformationMessage(`TypeCAD: Generated ${path.basename(declPath)}`);
            const doc = await vscode.workspace.openTextDocument(result);
            await vscode.window.showTextDocument(doc);
        }
        else {
            void vscode.window.showWarningMessage('TypeCAD: No classes or constants found in C++ file');
        }
    }
    /**
     * Generate a .d.ts file from a C++ file via the typecad-hal CLI.
     * Uses the monorepo source directly when developing inside this repo,
     * falls back to `npx typecad-hal` for installed users.
     */
    async generateDeclaration(cppPath, declPath) {
        return new Promise((resolve) => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            // Local-CLI fallback for development inside this monorepo (the engine
            // lives in @typecad/cuttlefish since the package consolidation).
            const localCliPath = workspaceFolders
                ? path.join(workspaceFolders[0].uri.fsPath, 'packages/cuttlefish/src/cli.ts')
                : null;
            const cmd = localCliPath && fs.existsSync(localCliPath)
                ? `npx tsx "${localCliPath}" gen-decls "${cppPath}"`
                : `npx typecad-hal gen-decls "${cppPath}"`;
            (0, node_child_process_1.exec)(cmd, { cwd: workspaceFolders?.[0]?.uri.fsPath }, (error) => {
                if (error) {
                    console.error('TypeCAD: Failed to generate declaration:', error);
                    void vscode.window.showErrorMessage(`TypeCAD: Failed to generate declaration: ${error.message}`);
                    resolve(null);
                    return;
                }
                resolve(fs.existsSync(declPath) ? declPath : null);
            });
        });
    }
    dispose() { }
}
//# sourceMappingURL=debug.js.map