// ---------------------------------------------------------------------------
// vscode-typecad-hal — the typeCAD/hal VS Code extension.
//
// Formerly three separately-vendored extensions, merged into one product:
//
//   .ui language — grammar, snippets, file icons, markdown ```ui fences
//                  (declarative contributes in package.json, zero runtime).
//   intel        — board-aware diagnostics, hovers, quick-fixes, fact chips,
//                  Flash & Monitor / Run on Hardware (src/intel.ts).
//   declarations — C++→.d.ts declaration generation (src/declarations.ts).
//                  The former Serial.print breakpoint pipeline was removed;
//                  source-level debugging is the F5/GDB flow on probe-capable
//                  boards (launch.json + tasks written by the engine).
//
// Command ids keep their historical `typecad-intel.*` / `typecad-debug.*`
// prefixes verbatim so existing keybindings and muscle memory survive.
//
// Activation is shared: `workspaceContains:**/typecad-hal.config.ts` (the
// normal path — a TypeCAD project is open) plus `onLanguage:typescript` (so
// the palette works the moment a TS file is focused). Without a workspace
// folder the extension does nothing.
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import { registerIntel } from './intel';
import { registerDeclarations } from './declarations';

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const root = folder.uri.fsPath;

  registerIntel(context, root);
  registerDeclarations(context, root);
}

export function deactivate(): void {}
