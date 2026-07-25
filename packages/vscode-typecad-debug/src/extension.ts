// ---------------------------------------------------------------------------
// vscode-typecad-debug — VSCode Extension
//
// Tracks breakpoints in TypeScript files and syncs them to
// .cuttlefish/breakpoints.json for the TypeCAD debug preprocessor.
// Also auto-generates .d.ts declaration files from C++ sources.
//
// The breakpoint file is read by @typecad/cuttlefish when invoked with
// `--debug`. The preprocessor injects Serial.println instrumentation at the
// recorded line numbers; run `cuttlefish build --debug` (or `cuttlefish
// index.ts --debug`) to enable it.
//
// IMPORTANT: the `file` field in each breakpoint entry is written as the
// basename only (e.g. "index.ts"). The cuttlefish loader matches breakpoints
// by exact → basename → suffix, and basename matching is the only strategy
// that works identically on Windows (backslash) and POSIX (forward slash)
// without slash normalization. The trade-off is that two files with the same
// basename in one project share breakpoints — acceptable for typical
// single-sketch Arduino projects.
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Breakpoint {
  /** Basename of the source file (e.g. "index.ts"). */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** Optional condition expression (e.g., "counter > 5"). */
  condition?: string;
  /** Optional log message with {variable} interpolation. */
  logMessage?: string;
}

interface BreakpointFile {
  /** Flat array — the format cuttlefish's loader checks first. */
  breakpoints: Breakpoint[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Relative to the workspace root. */
const BREAKPOINTS_DIR = '.cuttlefish';
const BREAKPOINTS_FILE = 'breakpoints.json';

// ---------------------------------------------------------------------------
// Extension Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  console.log('TypeCAD Debug extension activated');

  const breakpointTracker = new BreakpointTracker();

  const toggleCmd = vscode.commands.registerCommand(
    'typecad-debug.toggleBreakpoint',
    () => breakpointTracker.toggleBreakpoint(),
  );

  const clearAllCmd = vscode.commands.registerCommand(
    'typecad-debug.clearAllBreakpoints',
    () => breakpointTracker.clearAllBreakpoints(),
  );

  const debugCmd = vscode.commands.registerCommand(
    'typecad-debug.debugWithBreakpoints',
    () => breakpointTracker.debugWithBreakpoints(),
  );

  const syncCmd = vscode.commands.registerCommand(
    'typecad-debug.syncBreakpoints',
    () => breakpointTracker.syncFromVSCode(),
  );

  // Auto-sync breakpoints when saving TypeScript files.
  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.fileName.endsWith('.ts') && !doc.fileName.includes('node_modules')) {
      breakpointTracker.syncFromVSCode();
    }
  });

  const declGenerator = new DeclarationGenerator();

  const genDeclCmd = vscode.commands.registerCommand(
    'typecad-debug.generateDeclaration',
    () => declGenerator.generateForCurrentFile(),
  );

  // Auto-generate a .d.ts when a C++ file is saved and the sidecar is missing.
  const cppSaveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.fileName.endsWith('.cpp') && !doc.fileName.includes('node_modules')) {
      declGenerator.checkAndGenerate(doc.fileName);
    }
  });

  context.subscriptions.push(
    toggleCmd, clearAllCmd, debugCmd, syncCmd, saveListener, breakpointTracker,
    genDeclCmd, cppSaveListener, declGenerator,
  );
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Breakpoint Tracker
// ---------------------------------------------------------------------------

class BreakpointTracker implements vscode.Disposable {
  /** file fsPath → line → Breakpoint. Keys are full fsPaths for dedup. */
  private breakpoints: Map<string, Map<number, Breakpoint>> = new Map();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor() {
    this.loadFromFile();

    // VSCode breakpoint gutter changes (red dots, conditions, logpoints).
    vscode.debug.onDidChangeBreakpoints(() => {
      console.log('TypeCAD: Breakpoint change detected');
      this.syncFromVSCode();
    });

    // Re-sync when switching editor so a stale in-memory map doesn't survive.
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

    const filePath = editor.document.uri.fsPath;
    const fileName = path.basename(filePath);
    const line = editor.selection.active.line + 1; // 1-indexed

    if (!this.breakpoints.has(fileName)) {
      this.breakpoints.set(fileName, new Map());
    }

    const fileBreakpoints = this.breakpoints.get(fileName)!;
    if (fileBreakpoints.has(line)) {
      fileBreakpoints.delete(line);
      vscode.window.showInformationMessage(`TypeCAD: Breakpoint removed at line ${line}`);
    } else {
      fileBreakpoints.set(line, { file: fileName, line });
      vscode.window.showInformationMessage(`TypeCAD: Breakpoint added at line ${line}`);
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
    vscode.window.showInformationMessage('TypeCAD: All breakpoints cleared');
    this._onDidChange.fire();
  }

  /**
   * Save breakpoints, then run `cuttlefish build --debug` in a terminal.
   */
  async debugWithBreakpoints(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('TypeCAD: No active editor');
      return;
    }

    this.saveToFile();

    const terminal = vscode.window.createTerminal('TypeCAD Debug');
    terminal.show();
    terminal.sendText('npx cuttlefish build --debug');
  }

  /**
   * Sync breakpoints from VSCode's built-in breakpoint system.
   * Captures conditional breakpoints and logpoints.
   * REPLACES all breakpoints with the current VS Code state.
   */
  syncFromVSCode(): void {
    const vscodeBreakpoints = vscode.debug.breakpoints;
    console.log(`TypeCAD: Syncing ${vscodeBreakpoints.length} breakpoints from VS Code`);

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
    vscode.window.setStatusBarMessage(`TypeCAD: Synced ${count} breakpoints`, 3000);
    console.log(`TypeCAD: Synced ${count} breakpoints to file`);
  }

  /**
   * Load breakpoints from .cuttlefish/breakpoints.json
   */
  private loadFromFile(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const filePath = path.join(workspaceFolders[0].uri.fsPath, BREAKPOINTS_DIR, BREAKPOINTS_FILE);
    if (!fs.existsSync(filePath)) return;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const map = JSON.parse(content) as BreakpointFile;

      for (const bp of map.breakpoints ?? []) {
        if (!this.breakpoints.has(bp.file)) {
          this.breakpoints.set(bp.file, new Map());
        }
        this.breakpoints.get(bp.file)!.set(bp.line, bp);
      }
    } catch (err) {
      console.error('TypeCAD: Failed to load breakpoints:', err);
    }
  }

  /**
   * Save breakpoints to .cuttlefish/breakpoints.json atomically.
   * Writes to a temp file then renames, so a watching transpiler never reads
   * a half-written file.
   */
  private saveToFile(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.log('TypeCAD: No workspace folder, skipping save');
      return;
    }

    const dirPath = path.join(workspaceFolders[0].uri.fsPath, BREAKPOINTS_DIR);
    const filePath = path.join(dirPath, BREAKPOINTS_FILE);
    const tmpPath = `${filePath}.tmp`;

    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    } catch (mkdirErr) {
      console.error('TypeCAD: Failed to create directory:', mkdirErr);
      vscode.window.showErrorMessage(`TypeCAD: Failed to create ${BREAKPOINTS_DIR} directory: ${mkdirErr}`);
      return;
    }

    const map: BreakpointFile = { breakpoints: [] };
    for (const [, fileBreakpoints] of this.breakpoints) {
      for (const [, bp] of fileBreakpoints) {
        map.breakpoints.push(bp);
      }
    }

    // Stable order for clean diffs and reproducible output.
    map.breakpoints.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.line - b.line;
    });

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2));
      fs.renameSync(tmpPath, filePath);
      console.log(`TypeCAD: Saved ${map.breakpoints.length} breakpoints to ${filePath}`);
    } catch (err) {
      // Best effort: clean up the temp file on failure.
      try { fs.unlinkSync(tmpPath); } catch {}
      console.error('TypeCAD: Failed to save breakpoints:', err);
      vscode.window.showErrorMessage(`TypeCAD: Failed to save breakpoints: ${err}`);
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
   * Generate a .d.ts sidecar for a C++ file if one is not already present.
   */
  async checkAndGenerate(cppPath: string): Promise<void> {
    const declPath = cppPath.replace(/\.cpp$/i, '.d.ts');
    if (fs.existsSync(declPath)) {
      return; // Already exists — never clobber.
    }

    const result = await this.generateDeclaration(cppPath, declPath);
    if (result) {
      vscode.window.showInformationMessage(
        `TypeCAD: Generated ${path.basename(declPath)} from ${path.basename(cppPath)}. Review and adjust types if needed.`,
      );
    }
  }

  /**
   * Generate a declaration for the currently active C++ file.
   */
  async generateForCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('TypeCAD: No active editor');
      return;
    }

    const filePath = editor.document.uri.fsPath;
    if (!filePath.endsWith('.cpp')) {
      vscode.window.showErrorMessage('TypeCAD: Active file must be a .cpp file');
      return;
    }

    const declPath = filePath.replace(/\.cpp$/i, '.d.ts');
    const result = await this.generateDeclaration(filePath, declPath);

    if (result) {
      vscode.window.showInformationMessage(`TypeCAD: Generated ${path.basename(declPath)}`);
      const doc = await vscode.workspace.openTextDocument(result);
      await vscode.window.showTextDocument(doc);
    } else {
      vscode.window.showWarningMessage('TypeCAD: No classes or constants found in C++ file');
    }
  }

  /**
   * Generate a .d.ts file from a C++ file via the cuttlefish CLI.
   * Uses the monorepo source directly when developing inside this repo,
   * falls back to `npx cuttlefish` for installed users.
   */
  private async generateDeclaration(cppPath: string, declPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      // Local-CLI fallback for development inside the typecode monorepo.
      const localCliPath = workspaceFolders
        ? path.join(workspaceFolders[0].uri.fsPath, 'packages/cuttlefish/src/cli.ts')
        : null;

      const cmd = localCliPath && fs.existsSync(localCliPath)
        ? `npx tsx "${localCliPath}" gen-decls "${cppPath}"`
        : `npx cuttlefish gen-decls "${cppPath}"`;

      exec(cmd, { cwd: workspaceFolders?.[0]?.uri.fsPath }, (error) => {
        if (error) {
          console.error('TypeCAD: Failed to generate declaration:', error);
          vscode.window.showErrorMessage(`TypeCAD: Failed to generate declaration: ${error.message}`);
          resolve(null);
          return;
        }
        resolve(fs.existsSync(declPath) ? declPath : null);
      });
    });
  }

  dispose(): void {}
}
