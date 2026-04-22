"use strict";
// ---------------------------------------------------------------------------
// Shared toolchain types and utilities
//
// Compile error types, parsing utilities, and file collection helpers
// shared across toolchain implementations.
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLANG_ERROR = exports.ARDUINO_ERROR = exports.GCC_STYLE = void 0;
exports.parseCompileErrors = parseCompileErrors;
exports.collectCppFiles = collectCppFiles;
exports.toArchitectureFromFqbn = toArchitectureFromFqbn;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * GCC-style error regex (used by arduino-cli, platformio, gcc)
 */
exports.GCC_STYLE = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/i;
/**
 * Arduino-style error regex (sometimes missing column)
 */
exports.ARDUINO_ERROR = /^(.*?):(\d+):\d+:\s*(error|warning|note):\s*(.*)$/i;
/**
 * Clang-style error regex
 */
exports.CLANG_ERROR = /^(.*?):(\d+):(\d+):\s*(error|warning|note):\s*(.*)$/i;
/**
 * Parse compile errors from output (GCC, Arduino, and Clang formats)
 */
function parseCompileErrors(output, sketchDir) {
    const errors = [];
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line)
            continue;
        let match = line.match(exports.GCC_STYLE);
        if (!match) {
            match = line.match(exports.ARDUINO_ERROR);
            if (match) {
                // Arduino error format: file:line:column: severity: message
                // Sometimes column is missing, so we use 1 as default
                match = [match[0], match[1], match[2], "1", match[3], match[4]];
            }
        }
        if (!match) {
            match = line.match(exports.CLANG_ERROR);
        }
        if (!match) {
            continue;
        }
        const severityRaw = match[4].toLowerCase();
        const severity = severityRaw.includes("error") ? "error" : severityRaw === "warning" ? "warning" : "note";
        let filePath = match[1];
        // Normalize file paths
        if (sketchDir) {
            // Try to resolve relative paths against sketch directory
            if (!node_path_1.default.isAbsolute(filePath)) {
                const resolved = node_path_1.default.resolve(sketchDir, filePath);
                if (node_fs_1.default.existsSync(resolved)) {
                    filePath = resolved;
                }
            }
            // Handle sketch directory references
            if (filePath.includes(node_path_1.default.basename(sketchDir))) {
                filePath = node_path_1.default.resolve(sketchDir, node_path_1.default.basename(sketchDir) + ".ino");
            }
        }
        errors.push({
            filePath: node_path_1.default.resolve(filePath),
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            severity,
            message: match[5],
        });
    }
    return errors;
}
/**
 * Collect all .cpp files in a directory (non-recursive).
 * For recursive collection, use collectCppFilesRecursive.
 */
function collectCppFiles(rootDir) {
    const results = [];
    if (!node_fs_1.default.existsSync(rootDir)) {
        return results;
    }
    for (const entry of node_fs_1.default.readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".cpp")) {
            continue;
        }
        results.push(node_path_1.default.join(rootDir, entry.name));
    }
    results.sort((a, b) => a.localeCompare(b));
    return results;
}
/**
 * Extract architecture from FQBN string
 * FQBN format: vendor:arch:board[:config]
 * e.g., "arduino:avr:uno" -> "avr"
 */
function toArchitectureFromFqbn(fqbn) {
    if (!fqbn) {
        return undefined;
    }
    const parts = fqbn.split(":");
    // parts[0] = vendor, parts[1] = architecture, parts[2] = board
    return parts[1];
}
//# sourceMappingURL=toolchain-types.js.map