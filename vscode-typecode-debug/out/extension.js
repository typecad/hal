"use strict";
// ---------------------------------------------------------------------------
// vscode-typecode-debug — VSCode Extension
//
// Tracks breakpoints in TypeScript files and syncs them to
// .typecode/breakpoints.json for the TypeCode debug preprocessor.
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BREAKPOINTS_FILE = '.typecode/breakpoints.json';
// ---------------------------------------------------------------------------
// Extension Activation
// ---------------------------------------------------------------------------
function activate(context) {
    console.log('TypeCode Debug extension activated');
    // Track breakpoints
    const breakpointTracker = new BreakpointTracker();
    // Register commands
    const toggleCmd = vscode.commands.registerCommand('typecode-debug.toggleBreakpoint', () => breakpointTracker.toggleBreakpoint());
    const clearAllCmd = vscode.commands.registerCommand('typecode-debug.clearAllBreakpoints', () => breakpointTracker.clearAllBreakpoints());
    const debugCmd = vscode.commands.registerCommand('typecode-debug.debugWithBreakpoints', () => breakpointTracker.debugWithBreakpoints());
    const syncCmd = vscode.commands.registerCommand('typecode-debug.syncBreakpoints', () => breakpointTracker.syncFromVSCode());
    // Auto-sync breakpoints when saving TypeScript files
    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.fileName.endsWith('.ts') && !doc.fileName.includes('node_modules')) {
            breakpointTracker.syncFromVSCode();
        }
    });
    context.subscriptions.push(toggleCmd, clearAllCmd, debugCmd, syncCmd, saveListener, breakpointTracker);
}
function deactivate() { }
// ---------------------------------------------------------------------------
// Breakpoint Tracker
// ---------------------------------------------------------------------------
class BreakpointTracker {
    constructor() {
        // Store rich breakpoints: file -> line -> Breakpoint
        this.breakpoints = new Map();
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChange = this._onDidChange.event;
        // Load existing breakpoints from file
        this.loadFromFile();
        // Listen for VSCode breakpoint changes
        vscode.debug.onDidChangeBreakpoints(() => {
            console.log('TypeCode: Breakpoint change detected');
            this.syncFromVSCode();
        });
        // Also sync when breakpoints are added/removed in the editor
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.syncFromVSCode();
            }
        });
    }
    /**
     * Toggle a breakpoint at the current cursor position.
     */
    toggleBreakpoint() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const fileName = editor.document.uri.fsPath;
        const line = editor.selection.active.line + 1; // 1-indexed
        if (!this.breakpoints.has(fileName)) {
            this.breakpoints.set(fileName, new Map());
        }
        const fileBreakpoints = this.breakpoints.get(fileName);
        if (fileBreakpoints.has(line)) {
            fileBreakpoints.delete(line);
            vscode.window.showInformationMessage(`TypeCode: Breakpoint removed at line ${line}`);
        }
        else {
            fileBreakpoints.set(line, { file: fileName, line });
            vscode.window.showInformationMessage(`TypeCode: Breakpoint added at line ${line}`);
        }
        this.saveToFile();
        this._onDidChange.fire();
    }
    /**
     * Clear all breakpoints.
     */
    clearAllBreakpoints() {
        this.breakpoints.clear();
        this.saveToFile();
        vscode.window.showInformationMessage('TypeCode: All breakpoints cleared');
        this._onDidChange.fire();
    }
    /**
     * Debug the current file with breakpoints.
     */
    async debugWithBreakpoints() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('TypeCode: No active editor');
            return;
        }
        // Save breakpoints first
        this.saveToFile();
        // Run the typecode build with debug flag
        const terminal = vscode.window.createTerminal('TypeCode Debug');
        terminal.show();
        terminal.sendText('npx typecode build --debug');
    }
    /**
     * Get all breakpoints as a map.
     */
    getBreakpoints() {
        return this.breakpoints;
    }
    /**
     * Sync breakpoints from VSCode's built-in breakpoint system.
     * Captures conditional breakpoints and logpoints.
     * This REPLACES all breakpoints with the current VS Code state.
     */
    syncFromVSCode() {
        const vscodeBreakpoints = vscode.debug.breakpoints;
        console.log(`TypeCode: Syncing ${vscodeBreakpoints.length} breakpoints from VS Code`);
        // Clear existing breakpoints - we'll rebuild from VS Code state
        this.breakpoints.clear();
        let count = 0;
        for (const bp of vscodeBreakpoints) {
            if (bp instanceof vscode.SourceBreakpoint) {
                const fileName = bp.location.uri.fsPath;
                const line = bp.location.range.start.line + 1; // 1-indexed
                if (!this.breakpoints.has(fileName)) {
                    this.breakpoints.set(fileName, new Map());
                }
                // Store with condition and logMessage
                this.breakpoints.get(fileName).set(line, {
                    file: fileName,
                    line,
                    condition: bp.condition,
                    logMessage: bp.logMessage, // LogMessageBreakpoint has this property
                });
                count++;
            }
        }
        this.saveToFile();
        vscode.window.setStatusBarMessage(`TypeCode: Synced ${count} breakpoints`, 3000);
        console.log(`TypeCode: Synced ${count} breakpoints to file`);
    }
    /**
     * Load breakpoints from .typecode/breakpoints.json
     */
    loadFromFile() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return;
        const filePath = path.join(workspaceFolders[0].uri.fsPath, BREAKPOINTS_FILE);
        if (!fs.existsSync(filePath))
            return;
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const map = JSON.parse(content);
            for (const bp of map.breakpoints) {
                if (!this.breakpoints.has(bp.file)) {
                    this.breakpoints.set(bp.file, new Map());
                }
                this.breakpoints.get(bp.file).set(bp.line, bp);
            }
        }
        catch (err) {
            console.error('Failed to load breakpoints:', err);
        }
    }
    /**
     * Save breakpoints to .typecode/breakpoints.json
     */
    saveToFile() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            console.log('TypeCode: No workspace folder, skipping save');
            return;
        }
        const dirPath = path.join(workspaceFolders[0].uri.fsPath, '.typecode');
        const filePath = path.join(dirPath, 'breakpoints.json');
        console.log('TypeCode: Saving breakpoints to', filePath);
        // Ensure directory exists
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
        }
        catch (mkdirErr) {
            console.error('TypeCode: Failed to create directory:', mkdirErr);
            vscode.window.showErrorMessage(`TypeCode: Failed to create .typecode directory: ${mkdirErr}`);
            return;
        }
        const map = { breakpoints: [] };
        for (const [file, fileBreakpoints] of this.breakpoints) {
            for (const [line, bp] of fileBreakpoints) {
                map.breakpoints.push(bp);
            }
        }
        // Sort for consistent output
        map.breakpoints.sort((a, b) => {
            if (a.file !== b.file)
                return a.file.localeCompare(b.file);
            return a.line - b.line;
        });
        try {
            fs.writeFileSync(filePath, JSON.stringify(map, null, 2));
            console.log(`TypeCode: Saved ${map.breakpoints.length} breakpoints to ${filePath}`);
        }
        catch (err) {
            console.error('TypeCode: Failed to save breakpoints:', err);
            vscode.window.showErrorMessage(`TypeCode: Failed to save breakpoints: ${err}`);
        }
    }
    dispose() {
        this._onDidChange.dispose();
    }
}
//# sourceMappingURL=extension.js.map