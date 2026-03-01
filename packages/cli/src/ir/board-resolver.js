"use strict";
// ---------------------------------------------------------------------------
// Board constant resolver
//
// Parses a TypeScript board-definition file (e.g. code/board-arduino-uno/index.ts)
// using the TypeScript compiler API and extracts all compile-time scalar values
// from the exported `BoardDefinition` object into a flat dot-path map.
//
// The result is stored in `ProgramIR.boardConstants` and used by the C++
// emitter to fold `Board.definition.*` property accesses into inline literals
// – without maintaining a separate hard-coded copy of the manifest.
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBoardConstants = resolveBoardConstants;
const typescript_1 = __importDefault(require("typescript"));
/**
 * Parse a TypeScript board-definition source file and return a flat map of
 * all compile-time constant scalar values exported as a `BoardDefinition`.
 *
 * Properties whose values are arrays, spread elements, or other non-literal
 * expressions are silently skipped (no partial constant maps for board pins
 * etc. are needed by the emitter).
 *
 * @param defFilePath  Absolute path to the board definition `index.ts`.
 */
function resolveBoardConstants(defFilePath) {
    const result = new Map();
    // Build a minimal TypeScript program just to get a parsed AST with type
    // information for the target file.  We don't need emit or diagnostics.
    const program = typescript_1.default.createProgram([defFilePath], {
        noEmit: true,
        skipLibCheck: true,
        strict: false,
        target: typescript_1.default.ScriptTarget.ES2020,
    });
    // The source file may be keyed with either Windows or POSIX separators.
    const sourceFile = program.getSourceFile(defFilePath) ??
        program.getSourceFile(defFilePath.replace(/\\/g, "/"));
    if (!sourceFile)
        return result;
    // Find the first exported variable declaration whose initializer is an
    // object literal — that is the board definition manifest.
    typescript_1.default.forEachChild(sourceFile, (node) => {
        if (!typescript_1.default.isVariableStatement(node))
            return;
        const isExported = node.modifiers?.some((m) => m.kind === typescript_1.default.SyntaxKind.ExportKeyword);
        if (!isExported)
            return;
        for (const decl of node.declarationList.declarations) {
            const init = decl.initializer;
            if (!init || !typescript_1.default.isObjectLiteralExpression(init))
                continue;
            walkObjectLiteral(init, "", result);
            return; // stop after first match
        }
    });
    return result;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Recursively walk an `ObjectLiteralExpression`, adding scalar leaf values
 * to `out` keyed by their dot-separated path.
 *
 * @param obj     Current object literal to visit.
 * @param prefix  Dot-path accumulated so far (empty string at top level).
 * @param out     Accumulator map.
 */
function walkObjectLiteral(obj, prefix, out) {
    for (const prop of obj.properties) {
        // Only handle plain  `key: value`  assignments.
        // Shorthand, spread, methods, and getters are ignored.
        if (!typescript_1.default.isPropertyAssignment(prop))
            continue;
        const keyNode = prop.name;
        const key = typescript_1.default.isIdentifier(keyNode) || typescript_1.default.isStringLiteral(keyNode)
            ? keyNode.text
            : undefined;
        if (!key)
            continue;
        const fullPath = prefix ? `${prefix}.${key}` : key;
        const init = prop.initializer;
        const scalar = resolveScalar(init);
        if (scalar !== undefined) {
            out.set(fullPath, scalar);
        }
        else if (typescript_1.default.isObjectLiteralExpression(init)) {
            // Recurse into nested objects (e.g. `memory: { flash: 32_768, ... }`).
            walkObjectLiteral(init, fullPath, out);
        }
        // Arrays and complex expressions are silently ignored.
    }
}
/**
 * Try to evaluate a simple literal expression to a scalar JS value.
 * Returns `undefined` for anything that is not a plain, directly readable
 * literal (string, number, boolean, negative-number).
 */
function resolveScalar(expr) {
    // Strip `as const` / `as T` type assertions — recurse on the inner expression.
    if (typescript_1.default.isAsExpression(expr))
        return resolveScalar(expr.expression);
    // String literal
    if (typescript_1.default.isStringLiteral(expr))
        return expr.text;
    // Numeric literal — TypeScript preserves underscore separators in `.text`
    // (e.g.  32_768), so we strip them before converting.
    if (typescript_1.default.isNumericLiteral(expr)) {
        return Number(expr.text.replace(/_/g, ""));
    }
    // Boolean keywords
    if (expr.kind === typescript_1.default.SyntaxKind.TrueKeyword)
        return true;
    if (expr.kind === typescript_1.default.SyntaxKind.FalseKeyword)
        return false;
    // Negative numeric literals:  -32768  or  -1_024
    if (typescript_1.default.isPrefixUnaryExpression(expr) &&
        expr.operator === typescript_1.default.SyntaxKind.MinusToken &&
        typescript_1.default.isNumericLiteral(expr.operand)) {
        return -Number(expr.operand.text.replace(/_/g, ""));
    }
    return undefined;
}
//# sourceMappingURL=board-resolver.js.map