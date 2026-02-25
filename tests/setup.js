"use strict";
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
exports.transpile = transpile;
exports.normalizeCpp = normalizeCpp;
exports.containsLines = containsLines;
exports.extractFunction = extractFunction;
exports.hasInclude = hasInclude;
const build_ir_1 = require("../packages/cli/src/ir/build-ir");
const cpp_emitter_1 = require("../packages/cli/src/emit/cpp-emitter");
const polyfill_1 = require("../packages/cli/src/polyfill");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Ensure output directory exists
const testOutDir = ".build/tests";
if (!fs.existsSync(testOutDir)) {
    fs.mkdirSync(testOutDir, { recursive: true });
}
let testCounter = 0;
/**
 * Helper function to transpile TypeScript to C++ for testing
 * Uses unique filenames to avoid test isolation issues
 */
function transpile(tsCode, options = {}) {
    const { target = "generic", emitMode = "cpp", platformContext } = options;
    // Use unique filename based on caller info + counter to ensure isolation
    const uniqueId = `test_${process.pid}_${testCounter++}_${Date.now()}`;
    const fileName = `${uniqueId}.ts`;
    // For Arduino target, use a unique output directory to avoid filename collisions
    // since Arduino uses the directory name as the .ino filename
    const uniqueOutDir = target === "arduino"
        ? path.join(testOutDir, uniqueId)
        : testOutDir;
    if (target === "arduino" && !fs.existsSync(uniqueOutDir)) {
        fs.mkdirSync(uniqueOutDir, { recursive: true });
    }
    const programIR = (0, build_ir_1.buildProgramIR)(fileName, tsCode);
    const libdefs = new Map();
    const registry = (0, polyfill_1.createPolyfillRegistry)();
    const polyfills = registry.detectAndGenerate(programIR, {
        target,
        architecture: platformContext?.arduino?.fqbn,
        usedIdentifiers: new Set(),
    });
    const result = (0, cpp_emitter_1.emitCpp)(programIR, {
        outDir: uniqueOutDir,
        emitMode,
        target,
        libdefs,
        emitMaps: false,
        platformContext,
        polyfills,
    });
    let cpp = "";
    let header;
    if (result.sourcePath && fs.existsSync(result.sourcePath)) {
        cpp = fs.readFileSync(result.sourcePath, "utf-8");
        // Clean up
        fs.unlinkSync(result.sourcePath);
    }
    if (result.headerPath && fs.existsSync(result.headerPath)) {
        header = fs.readFileSync(result.headerPath, "utf-8");
        // Clean up
        fs.unlinkSync(result.headerPath);
    }
    return { cpp, header, diagnostics: result.diagnostics };
}
/**
 * Helper to strip whitespace for comparison while maintaining readability
 */
function normalizeCpp(code) {
    return code
        .replace(/\r\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Helper to check if C++ code contains expected lines (in order)
 */
function containsLines(cpp, lines) {
    const normalized = normalizeCpp(cpp);
    let lastIndex = -1;
    for (const line of lines) {
        const normalizedLine = normalizeCpp(line);
        const index = normalized.indexOf(normalizedLine);
        if (index === -1 || index <= lastIndex) {
            return false;
        }
        lastIndex = index;
    }
    return true;
}
/**
 * Helper to extract a function body from C++ code
 */
function extractFunction(cpp, functionName) {
    const regex = new RegExp(`${functionName}\\s*\\([^)]*\\)\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`, "s");
    const match = cpp.match(regex);
    return match ? match[1].trim() : null;
}
/**
 * Helper to check if an include is present
 */
function hasInclude(cpp, include) {
    const pattern = include.startsWith("<") || include.startsWith('"')
        ? `#include ${include}`
        : `#include <${include}>`;
    return cpp.includes(pattern);
}
