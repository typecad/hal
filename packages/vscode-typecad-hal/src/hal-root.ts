// ---------------------------------------------------------------------------
// Where does the extension root its firmware intelligence? Combined typeCAD
// projects are multi-root workspaces (hw/ with typecad.conf.ts + fw/ with
// typecad-hal.config.ts), so workspaceFolders[0] is never assumed: the root
// is the first workspace folder whose directory chain carries
// typecad-hal.config.ts. The walk mirrors the engine's own config lookup
// (loadTypecadConfig walks UP from its workspaceRoot), so a root above the
// config stays engine-correct while a sibling folder (hw/) would leave the
// engine blind to it.
// ---------------------------------------------------------------------------

import path from 'node:path';

export const HAL_CONFIG_FILE = 'typecad-hal.config.ts';

/**
 * First workspace folder whose own directory or an ancestor holds
 * typecad-hal.config.ts, in the order VS Code presents folders; null when no
 * folder's chain has one. `exists` is injected so tests can fake the
 * filesystem.
 */
export function findHalRoot(folders: string[], exists: (p: string) => boolean): string | null {
  for (const folder of folders) {
    let dir: string = path.resolve(folder);
    for (;;) {
      if (exists(path.join(dir, HAL_CONFIG_FILE))) return path.resolve(folder);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * True for files inside `root` — case-insensitive on the segments VS Code
 * paths share with Windows. Board hovers, fact chips, and code lenses stop at
 * the root so the typeCAD/pcb extension owns hw/ files unbothered.
 */
export function isUnderRoot(fsPath: string, root: string | undefined): boolean {
  if (!root) return false;
  const norm = (p: string): string => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  const file = norm(fsPath);
  const folder = norm(root);
  return file.startsWith(folder + '/');
}
