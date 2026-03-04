// ---------------------------------------------------------------------------
// vscode-typecode-debug — VSCode Extension
//
// Tracks breakpoints in TypeScript files and syncs them to
// .typecode/breakpoints.json for the TypeCode debug preprocessor.
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Breakpoint {
  file: string;
  line: number;
  /** Optional condition expression (e.g., "counter > 5") */
  condition?: string;
  /** Optional log message with {variable} interpolation */
  logMessage?: string;
}

interface BreakpointMap {
  breakpoints: Breakpoint[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BREAKPOINTS_FILE = '.typecode/breakpoints.json';

// ---------------------------------------------------------------------------
// Extension Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  console.log('TypeCode Debug extension activated');

  // Track breakpoints
  const breakpointTracker = new BreakpointTracker();

  // Register commands
  const toggleCmd = vscode.commands.registerCommand(
    'typecode-debug.toggleBreakpoint',
    () => breakpointTracker.toggleBreakpoint()
  );

  const clearAllCmd = vscode.commands.registerCommand(
    'typecode-debug.clearAllBreakpoints',
    () => breakpointTracker.clearAllBreakpoints()
  );

  const debugCmd = vscode.commands.registerCommand(
    'typecode-debug.debugWithBreakpoints',
    () => breakpointTracker.debugWithBreakpoints()
  );

  const syncCmd = vscode.commands.registerCommand(
    'typecode-debug.syncBreakpoints',
    () => breakpointTracker.syncFromVSCode()
  );

  // Auto-sync breakpoints when saving TypeScript files
  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.fileName.endsWith('.ts') && !doc.fileName.includes('node_modules')) {
      breakpointTracker.syncFromVSCode();
    }
  });

  context.subscriptions.push(toggleCmd, clearAllCmd, debugCmd, syncCmd, saveListener, breakpointTracker);
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Breakpoint Tracker
// ---------------------------------------------------------------------------

class BreakpointTracker implements vscode.Disposable {
  // Store rich breakpoints: file -> line -> Breakpoint
  private breakpoints: Map<string, Map<number, Breakpoint>> = new Map();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor() {
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
  toggleBreakpoint(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const fileName = editor.document.uri.fsPath;
    const line = editor.selection.active.line + 1; // 1-indexed

    if (!this.breakpoints.has(fileName)) {
      this.breakpoints.set(fileName, new Map());
    }

    const fileBreakpoints = this.breakpoints.get(fileName)!;
    if (fileBreakpoints.has(line)) {
      fileBreakpoints.delete(line);
      vscode.window.showInformationMessage(`TypeCode: Breakpoint removed at line ${line}`);
    } else {
      fileBreakpoints.set(line, { file: fileName, line });
      vscode.window.showInformationMessage(`TypeCode: Breakpoint added at line ${line}`);
    }

    this.saveToFile();
    this._onDidChange.fire();
  }

  /**
   * Clear all breakpoints.
   */
  clearAllBreakpoints(): void {
    this.breakpoints.clear();
    this.saveToFile();

    vscode.window.showInformationMessage('TypeCode: All breakpoints cleared');
    this._onDidChange.fire();
  }

  /**
   * Debug the current file with breakpoints.
   */
  async debugWithBreakpoints(): Promise<void> {
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
  getBreakpoints(): Map<string, Map<number, Breakpoint>> {
    return this.breakpoints;
  }

  /**
   * Sync breakpoints from VSCode's built-in breakpoint system.
   * Captures conditional breakpoints and logpoints.
   * This REPLACES all breakpoints with the current VS Code state.
   */
  syncFromVSCode(): void {
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
        this.breakpoints.get(fileName)!.set(line, {
          file: fileName,
          line,
          condition: bp.condition,
          logMessage: (bp as any).logMessage, // LogMessageBreakpoint has this property
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
  private loadFromFile(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const filePath = path.join(workspaceFolders[0].uri.fsPath, BREAKPOINTS_FILE);

    if (!fs.existsSync(filePath)) return;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const map = JSON.parse(content) as BreakpointMap;

      for (const bp of map.breakpoints) {
        if (!this.breakpoints.has(bp.file)) {
          this.breakpoints.set(bp.file, new Map());
        }
        this.breakpoints.get(bp.file)!.set(bp.line, bp);
      }

    } catch (err) {
      console.error('Failed to load breakpoints:', err);
    }
  }

  /**
   * Save breakpoints to .typecode/breakpoints.json
   */
  private saveToFile(): void {
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
    } catch (mkdirErr) {
      console.error('TypeCode: Failed to create directory:', mkdirErr);
      vscode.window.showErrorMessage(`TypeCode: Failed to create .typecode directory: ${mkdirErr}`);
      return;
    }

    const map: BreakpointMap = { breakpoints: [] };

    for (const [file, fileBreakpoints] of this.breakpoints) {
      for (const [line, bp] of fileBreakpoints) {
        map.breakpoints.push(bp);
      }
    }

    // Sort for consistent output
    map.breakpoints.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.line - b.line;
    });

    try {
      fs.writeFileSync(filePath, JSON.stringify(map, null, 2));
      console.log(`TypeCode: Saved ${map.breakpoints.length} breakpoints to ${filePath}`);
    } catch (err) {
      console.error('TypeCode: Failed to save breakpoints:', err);
      vscode.window.showErrorMessage(`TypeCode: Failed to save breakpoints: ${err}`);
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

