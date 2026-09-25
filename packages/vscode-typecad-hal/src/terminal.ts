// ---------------------------------------------------------------------------
// terminal.ts — the ONE shared terminal for every TypeCAD/hal command.
//
// Intel's Flash & Monitor / Run on Hardware and debug's declaration
// generation all shell out to `npx typecad-hal …`; they reuse a single
// "typeCAD/hal" terminal (the pcb extension runs its builds in a sibling
// "typeCAD/pcb" one) so successive commands share scrollback and environment
// instead of stacking terminals. The terminal is pinned to the resolved
// project root — in multi-root workspaces the default terminal cwd would be
// workspaceFolders[0], where npx cannot see the project's typecad-hal.
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

let terminal: vscode.Terminal | undefined;
let terminalCwd: string | undefined;

export function typecadTerminal(cwd?: string): vscode.Terminal {
  // cwd is only settable at creation — recycle while the shell still sits in
  // the project we're driving.
  if (
    !terminal
    || terminal.exitStatus !== undefined
    || (cwd !== undefined && terminalCwd !== cwd)
  ) {
    terminal = vscode.window.createTerminal({ name: 'typeCAD/hal', ...(cwd ? { cwd } : {}) });
    terminalCwd = cwd;
  }
  terminal.show();
  return terminal;
}
