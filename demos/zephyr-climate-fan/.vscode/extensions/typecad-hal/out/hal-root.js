"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HAL_CONFIG_FILE = void 0;
exports.findHalRoot = findHalRoot;
exports.isUnderRoot = isUnderRoot;
const node_path_1 = __importDefault(require("node:path"));
exports.HAL_CONFIG_FILE = 'typecad-hal.config.ts';
/**
 * First workspace folder whose own directory or an ancestor holds
 * typecad-hal.config.ts, in the order VS Code presents folders; null when no
 * folder's chain has one. `exists` is injected so tests can fake the
 * filesystem.
 */
function findHalRoot(folders, exists) {
    for (const folder of folders) {
        let dir = node_path_1.default.resolve(folder);
        for (;;) {
            if (exists(node_path_1.default.join(dir, exports.HAL_CONFIG_FILE)))
                return node_path_1.default.resolve(folder);
            const parent = node_path_1.default.dirname(dir);
            if (parent === dir)
                break;
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
function isUnderRoot(fsPath, root) {
    if (!root)
        return false;
    const norm = (p) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
    const file = norm(fsPath);
    const folder = norm(root);
    return file.startsWith(folder + '/');
}
//# sourceMappingURL=hal-root.js.map