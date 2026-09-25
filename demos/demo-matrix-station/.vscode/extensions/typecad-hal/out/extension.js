"use strict";
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
exports.activate = activate;
exports.deactivate = deactivate;
const fs = __importStar(require("node:fs"));
const vscode = __importStar(require("vscode"));
const hal_root_1 = require("./hal-root");
const intel_1 = require("./intel");
const declarations_1 = require("./declarations");
const trace_1 = require("./trace");
const diagnostics_1 = require("./diagnostics");
function activate(context) {
    const folderPaths = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    if (folderPaths().length === 0)
        return;
    const resolveRoot = () => (0, hal_root_1.findHalRoot)(folderPaths(), (p) => fs.existsSync(p)) ?? folderPaths()[0];
    (0, intel_1.registerIntel)(context, resolveRoot);
    (0, declarations_1.registerDeclarations)(context, resolveRoot);
    (0, trace_1.registerTrace)(context, resolveRoot);
    (0, diagnostics_1.registerDiagnostics)(context, resolveRoot);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map