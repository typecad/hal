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
// Activation is `workspaceContains:**/typecad-hal.config.ts` (the normal
// path — a TypeCAD project is open); palette commands activate implicitly via
// their onCommand events, so no `onLanguage:typescript` is needed — that event
// made the extension (and its typeCAD/pcb sibling) wake up in every
// TypeScript workspace on earth. Without a workspace folder the extension
// does nothing.
//
// The root is content-based, never workspaceFolders[0]: combined typeCAD
// projects are multi-root (hw/ + fw/), so the folder whose chain carries
// typecad-hal.config.ts wins (see hal-root.ts), with the first folder as the
// fallback for nested-config layouts. Both consumers re-resolve when the
// workspace shape changes.
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { findHalRoot } from './hal-root';
import { registerIntel } from './intel';
import { registerDeclarations } from './declarations';
import { registerTrace } from './trace';
import { registerDiagnostics } from './diagnostics';

export function activate(context: vscode.ExtensionContext): void {
  const folderPaths = (): string[] =>
    (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  if (folderPaths().length === 0) return;

  const resolveRoot = (): string | undefined =>
    findHalRoot(folderPaths(), (p) => fs.existsSync(p)) ?? folderPaths()[0];

  registerIntel(context, resolveRoot);
  registerDeclarations(context, resolveRoot);
  registerTrace(context, resolveRoot);
  registerDiagnostics(context, resolveRoot);
}

export function deactivate(): void {}
