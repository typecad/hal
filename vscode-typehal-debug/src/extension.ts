// ---------------------------------------------------------------------------
// vscode-typehal-debug — VSCode Extension
//
// Tracks breakpoints in TypeScript files and syncs them to
// .typehal/breakpoints.json for the TypeHAL debug preprocessor.
// Also auto-generates .d.ts declaration files from C++ sources.
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';

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

const BREAKPOINTS_FILE = '.typehal/breakpoints.json';

// ---------------------------------------------------------------------------
// Extension Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  console.log('TypeHAL Debug extension activated');

  // Track breakpoints
  const breakpointTracker = new BreakpointTracker();

  // Register commands
  const toggleCmd = vscode.commands.registerCommand(
    'typehal-debug.toggleBreakpoint',
    () => breakpointTracker.toggleBreakpoint()
  );

  const clearAllCmd = vscode.commands.registerCommand(
    'typehal-debug.clearAllBreakpoints',
    () => breakpointTracker.clearAllBreakpoints()
  );

  const debugCmd = vscode.commands.registerCommand(
    'typehal-debug.debugWithBreakpoints',
    () => breakpointTracker.debugWithBreakpoints()
  );

  const syncCmd = vscode.commands.registerCommand(
    'typehal-debug.syncBreakpoints',
    () => breakpointTracker.syncFromVSCode()
  );

  // Auto-sync breakpoints when saving TypeScript files
  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.fileName.endsWith('.ts') && !doc.fileName.includes('node_modules')) {
      breakpointTracker.syncFromVSCode();
    }
  });

  // Declaration file generator
  const declGenerator = new DeclarationGenerator();

  // Register declaration generation command
  const genDeclCmd = vscode.commands.registerCommand(
    'typehal-debug.generateDeclaration',
    () => declGenerator.generateForCurrentFile()
  );

  // Watch for C++ file saves and auto-generate .d.ts if missing
  const cppSaveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.fileName.endsWith('.cpp') && !doc.fileName.includes('node_modules')) {
      declGenerator.checkAndGenerate(doc.fileName);
    }
  });

  context.subscriptions.push(
    toggleCmd, clearAllCmd, debugCmd, syncCmd, saveListener, breakpointTracker,
    genDeclCmd, cppSaveListener, declGenerator
  );
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
      console.log('TypeHAL: Breakpoint change detected');
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
      vscode.window.showInformationMessage(`TypeHAL: Breakpoint removed at line ${line}`);
    } else {
      fileBreakpoints.set(line, { file: fileName, line });
      vscode.window.showInformationMessage(`TypeHAL: Breakpoint added at line ${line}`);
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

    vscode.window.showInformationMessage('TypeHAL: All breakpoints cleared');
    this._onDidChange.fire();
  }

  /**
   * Debug the current file with breakpoints.
   */
  async debugWithBreakpoints(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('TypeHAL: No active editor');
      return;
    }

    // Save breakpoints first
    this.saveToFile();

    // Run the typehal build with debug flag
    const terminal = vscode.window.createTerminal('TypeHAL Debug');
    terminal.show();
    terminal.sendText('npx typehal build --debug');
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
    
    console.log(`TypeHAL: Syncing ${vscodeBreakpoints.length} breakpoints from VS Code`);

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
    
    vscode.window.setStatusBarMessage(`TypeHAL: Synced ${count} breakpoints`, 3000);
    console.log(`TypeHAL: Synced ${count} breakpoints to file`);
  }

  /**
   * Load breakpoints from .typehal/breakpoints.json
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
   * Save breakpoints to .typehal/breakpoints.json
   */
  private saveToFile(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.log('TypeHAL: No workspace folder, skipping save');
      return;
    }

    const dirPath = path.join(workspaceFolders[0].uri.fsPath, '.typehal');
    const filePath = path.join(dirPath, 'breakpoints.json');

    console.log('TypeHAL: Saving breakpoints to', filePath);

    // Ensure directory exists
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    } catch (mkdirErr) {
      console.error('TypeHAL: Failed to create directory:', mkdirErr);
      vscode.window.showErrorMessage(`TypeHAL: Failed to create .typehal directory: ${mkdirErr}`);
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
      console.log(`TypeHAL: Saved ${map.breakpoints.length} breakpoints to ${filePath}`);
    } catch (err) {
      console.error('TypeHAL: Failed to save breakpoints:', err);
      vscode.window.showErrorMessage(`TypeHAL: Failed to save breakpoints: ${err}`);
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

// ---------------------------------------------------------------------------
// Declaration Generator
// ---------------------------------------------------------------------------

class DeclarationGenerator implements vscode.Disposable {
  /**
   * Check if a .d.ts file exists for the given C++ file, and generate one if missing.
   */
  async checkAndGenerate(cppPath: string): Promise<void> {
    const declPath = cppPath.replace(/\.cpp$/i, '.d.ts');
    
    if (fs.existsSync(declPath)) {
      return; // Declaration file already exists
    }
    
    const result = await this.generateDeclaration(cppPath, declPath);
    if (result) {
      vscode.window.showInformationMessage(
        `TypeHAL: Generated ${path.basename(declPath)} from ${path.basename(cppPath)}. Review and adjust types if needed.`
      );
    }
  }

  /**
   * Generate declaration for the currently active C++ file.
   */
  async generateForCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('TypeHAL: No active editor');
      return;
    }

    const filePath = editor.document.uri.fsPath;
    
    if (!filePath.endsWith('.cpp')) {
      vscode.window.showErrorMessage('TypeHAL: Active file must be a .cpp file');
      return;
    }

    const declPath = filePath.replace(/\.cpp$/i, '.d.ts');
    const result = await this.generateDeclaration(filePath, declPath);
    
    if (result) {
      vscode.window.showInformationMessage(
        `TypeHAL: Generated ${path.basename(declPath)}`
      );
      // Open the generated file for review
      const doc = await vscode.workspace.openTextDocument(result);
      await vscode.window.showTextDocument(doc);
    } else {
      vscode.window.showWarningMessage(
        'TypeHAL: No classes or constants found in C++ file'
      );
    }
  }

  /**
   * Generate a .d.ts file from a C++ file using the typehal CLI.
   */
  private async generateDeclaration(cppPath: string, declPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      // Use tsx to run the CLI directly for development, fallback to npx typehal
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const localCliPath = workspaceFolders 
        ? path.join(workspaceFolders[0].uri.fsPath, 'packages/cli/src/cli.ts')
        : null;
      
      const cmd = localCliPath && fs.existsSync(localCliPath)
        ? `npx tsx "${localCliPath}" gen-decls "${cppPath}"`
        : `npx typehal gen-decls "${cppPath}"`;
      
      exec(cmd, { cwd: workspaceFolders?.[0]?.uri.fsPath }, (error, stdout, stderr) => {
        if (error) {
          console.error('TypeHAL: Failed to generate declaration:', error);
          vscode.window.showErrorMessage(`TypeHAL: Failed to generate declaration: ${error.message}`);
          resolve(null);
          return;
        }
        
        if (fs.existsSync(declPath)) {
          resolve(declPath);
        } else {
          resolve(null);
        }
      });
    });
  }

  dispose(): void {}
}

