// ---------------------------------------------------------------------------
// terminal.ts — the ONE shared terminal for every TypeCAD command.
//
// Intel's Flash & Monitor / Run on Hardware and debug's Debug with
// Breakpoints all shell out to `npx typecad-hal …`; they reuse a single
// "TypeCAD" terminal so successive commands share scrollback and environment
// instead of stacking terminals.
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

let terminal: vscode.Terminal | undefined;

export function typecadTerminal(): vscode.Terminal {
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal('TypeCAD');
  }
  terminal.show();
  return terminal;
}
