"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.typecadTerminal = typecadTerminal;
const vscode = __importStar(require("vscode"));
let terminal;
let terminalCwd;
function typecadTerminal(cwd) {
    // cwd is only settable at creation — recycle while the shell still sits in
    // the project we're driving.
    if (!terminal
        || terminal.exitStatus !== undefined
        || (cwd !== undefined && terminalCwd !== cwd)) {
        terminal = vscode.window.createTerminal({ name: 'typeCAD/hal', ...(cwd ? { cwd } : {}) });
        terminalCwd = cwd;
    }
    terminal.show();
    return terminal;
}
//# sourceMappingURL=terminal.js.map