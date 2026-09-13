"use strict";
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
exports.registerDeclarations = registerDeclarations;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
/** Register the declaration-generation surface for the workspace rooted at `workspaceRoot`. */
function registerDeclarations(context, _workspaceRoot) {
    const declGenerator = new DeclarationGenerator();
    const genDeclCmd = vscode.commands.registerCommand('typecad-debug.generateDeclaration', () => declGenerator.generateForCurrentFile());
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
class DeclarationGenerator {
    /**
     * Generate a .d.ts sidecar for a C++ file if one is not already present.
     */
    async checkAndGenerate(cppPath) {
        const declPath = cppPath.replace(/\.cpp$/i, '.d.ts');
        if (fs.existsSync(declPath)) {
            return; // Already exists — never clobber.
        }
        const result = await this.generateDeclaration(cppPath, declPath);
        if (result) {
            void vscode.window.showInformationMessage(`TypeCAD: Generated ${path.basename(declPath)} from ${path.basename(cppPath)}. Review and adjust types if needed.`);
        }
    }
    /**
     * Generate a declaration for the currently active C++ file.
     */
    async generateForCurrentFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showErrorMessage('TypeCAD: No active editor');
            return;
        }
        const filePath = editor.document.uri.fsPath;
        if (!filePath.endsWith('.cpp')) {
            void vscode.window.showErrorMessage('TypeCAD: Active file must be a .cpp file');
            return;
        }
        const declPath = filePath.replace(/\.cpp$/i, '.d.ts');
        const result = await this.generateDeclaration(filePath, declPath);
        if (result) {
            void vscode.window.showInformationMessage(`TypeCAD: Generated ${path.basename(declPath)}`);
            const doc = await vscode.workspace.openTextDocument(result);
            await vscode.window.showTextDocument(doc);
        }
        else {
            void vscode.window.showWarningMessage('TypeCAD: No classes or constants found in C++ file');
        }
    }
    /**
     * Generate a .d.ts file from a C++ file via the typecad-hal CLI.
     * Uses the monorepo source directly when developing inside this repo,
     * falls back to `npx typecad-hal` for installed users.
     */
    async generateDeclaration(cppPath, declPath) {
        return new Promise((resolve) => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            // Local-CLI fallback for development inside this monorepo (the engine
            // lives in @typecad/cuttlefish since the package consolidation).
            const localCliPath = workspaceFolders
                ? path.join(workspaceFolders[0].uri.fsPath, 'packages/cuttlefish/src/cli.ts')
                : null;
            const cmd = localCliPath && fs.existsSync(localCliPath)
                ? `npx tsx "${localCliPath}" gen-decls "${cppPath}"`
                : `npx typecad-hal gen-decls "${cppPath}"`;
            (0, node_child_process_1.exec)(cmd, { cwd: workspaceFolders?.[0]?.uri.fsPath }, (error) => {
                if (error) {
                    console.error('TypeCAD: Failed to generate declaration:', error);
                    void vscode.window.showErrorMessage(`TypeCAD: Failed to generate declaration: ${error.message}`);
                    resolve(null);
                    return;
                }
                resolve(fs.existsSync(declPath) ? declPath : null);
            });
        });
    }
    dispose() { }
}
//# sourceMappingURL=declarations.js.map