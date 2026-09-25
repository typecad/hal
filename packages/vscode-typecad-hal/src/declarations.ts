// ---------------------------------------------------------------------------
// declarations.ts — C++ → .d.ts declaration generation.
//
// The sole survivor of the former TypeCAD Debug extension module: the
// Serial.print breakpoint pipeline (gutter breakpoints →
// .typecad-hal/breakpoints.json → --debug instrumentation) was removed from
// the product; source-level debugging on probe-capable boards is the F5/GDB
// flow (launch.json + tasks written by the engine). The command keeps its
// historical `typecad-debug.*` id so existing keybindings still work.
//
// Auto-generates a .d.ts sidecar when a C++ file is saved and the sidecar is
// missing (never clobbers), plus an explicit command for the active file.
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the declaration-generation surface, rooted wherever `resolveRoot` points. */
export function registerDeclarations(context: vscode.ExtensionContext, resolveRoot: () => string | undefined): void {
  const declGenerator = new DeclarationGenerator(resolveRoot);

  const genDeclCmd = vscode.commands.registerCommand(
    'typecad-debug.generateDeclaration',
    () => declGenerator.generateForCurrentFile(),
  );

  // Auto-generate a .d.ts when a C++ file is saved and the sidecar is missing.
  const cppSaveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.fileName.endsWith('.cpp') && !doc.fileName.includes('node_modules')) {
      void declGenerator.checkAndGenerate(doc.fileName);
    }
  });

  context.subscriptions.push(genDeclCmd, cppSaveListener, declGenerator);
}

// ---------------------------------------------------------------------------
// Declaration Generator
// ---------------------------------------------------------------------------

class DeclarationGenerator implements vscode.Disposable {
  constructor(private readonly resolveRoot: () => string | undefined) {}

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
      void vscode.window.showInformationMessage(
        `typeCAD/hal: Generated ${path.basename(declPath)} from ${path.basename(cppPath)}. Review and adjust types if needed.`,
      );
    }
  }

  /**
   * Generate a declaration for the currently active C++ file.
   */
  async generateForCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showErrorMessage('typeCAD/hal: No active editor');
      return;
    }

    const filePath = editor.document.uri.fsPath;
    if (!filePath.endsWith('.cpp')) {
      void vscode.window.showErrorMessage('typeCAD/hal: Active file must be a .cpp file');
      return;
    }

    const declPath = filePath.replace(/\.cpp$/i, '.d.ts');
    const result = await this.generateDeclaration(filePath, declPath);

    if (result) {
      void vscode.window.showInformationMessage(`typeCAD/hal: Generated ${path.basename(declPath)}`);
      const doc = await vscode.workspace.openTextDocument(result);
      await vscode.window.showTextDocument(doc);
    } else {
      void vscode.window.showWarningMessage('typeCAD/hal: No classes or constants found in C++ file');
    }
  }

  /**
   * Generate a .d.ts file from a C++ file via the typecad-hal CLI.
   * Uses the monorepo source directly when developing inside this repo,
   * falls back to `npx typecad-hal` for installed users.
   */
  private async generateDeclaration(cppPath: string, declPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      // The resolved project root (multi-root aware) — the CLI and its
      // node_modules live there, not necessarily in workspaceFolders[0].
      const root = this.resolveRoot();
      const localCliPath = root
        ? path.join(root, 'packages/cuttlefish/src/cli.ts')
        : null;

      const cmd = localCliPath && fs.existsSync(localCliPath)
        ? `npx tsx "${localCliPath}" gen-decls "${cppPath}"`
        : `npx typecad-hal gen-decls "${cppPath}"`;

      exec(cmd, { cwd: root }, (error) => {
        if (error) {
          console.error('typeCAD/hal: Failed to generate declaration:', error);
          void vscode.window.showErrorMessage(`typeCAD/hal: Failed to generate declaration: ${error.message}`);
          resolve(null);
          return;
        }
        resolve(fs.existsSync(declPath) ? declPath : null);
      });
    });
  }

  dispose(): void {}
}
