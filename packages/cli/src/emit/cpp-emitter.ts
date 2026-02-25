import path from "node:path";
import fs from "node:fs";
import { ProgramIR, ExpressionIR, StatementIR } from "../ir/model";
import { Diagnostic, EmitMode, GeneratedOutputs, PlatformContext, SourceMapEntry, TargetProfile } from "../types";
import { ensureDir, writeText } from "../utils/fs";
import { resolveImport } from "../libdef/registry";
import { LibraryDefinition } from "../types";
import { makeGeneratedMap, writeSourceMap } from "../mapping/source-map";
import { resolveArduinoProfile } from "../platform/arduino-profile";
import { RuntimePolyfillIR } from "../polyfill/types";
import { emitPolyfillBoilerplate } from "../polyfill/emitter";
import { ResolvedNpmPackage } from "../transpile";
import { renderArduinoBuiltin, tryRenderTypecodeCallStatement, extractPropertyChain, renderBoardDefinitionAccess } from "./typecode-map";
import type { BoardConstants } from "../ir/board-resolver";

// ---------------------------------------------------------------------------
// Emit-time context
// ---------------------------------------------------------------------------
// Set at the start of each emitCpp call and consulted by renderExpression.
// Using a module-level variable avoids threading boardConstants through the
// entire renderStatement / renderExpression call chain.
let _emitBoardConstants: BoardConstants | undefined;

// Accumulates enum class names across all files compiled in one transpilation
// run so that renderExpression can use `::` instead of `.` for enum member
// access (e.g. I2CSpeed.STANDARD → I2CSpeed::STANDARD) even when the enum
// type is defined in a different source file (imported from @typecode/core).
const _emitEnumNames: Set<string> = new Set();

// Enum names whose members have values outside the 16-bit signed int range
// (i.e. > 32767 or < -32768).  On AVR, `int` is 16-bit, so these enums need
// an explicit `long` underlying type and their static_cast must use `long`.
const _largeEnumNames: Set<string> = new Set();

/**
 * Pre-populate the module-level enum registries from *all* program IRs before
 * any `emitCpp` call. Call this once in `transpile.ts` after building +
 * tree-shaking every file so that property-access rendering and struct field
 * type inference work correctly regardless of processing order.
 */
export function registerAllEnumNames(
  enums: Iterable<{ name: string; members: { name: string; value?: number }[] }>
): void {
  for (const e of enums) {
    _emitEnumNames.add(e.name);
    if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      _largeEnumNames.add(e.name);
    }
  }
}

// Enum class member names that conflict with Arduino / ESP32 framework macros.
// When a property-access on a known enum type produces one of these names it
// is prefixed with `_` to match the renamed enum class member (e.g. the
// emitted `enum class PinMode { _INPUT, _OUTPUT, … }` uses underscore prefixes).
const arduinoEnumMemberRenames: ReadonlySet<string> = new Set([
  "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP",
  "RISING", "FALLING", "CHANGE",
  "INPUT_PULLDOWN", "OUTPUT_OPEN_DRAIN", "ANALOG",
  // Arduino.h analog reference macros (DEFAULT, INTERNAL, EXTERNAL)
  "DEFAULT", "INTERNAL", "EXTERNAL",
  // CMSIS / device-header macros (SAMD21 defines RTC as a hardware-register address macro)
  "RTC",
]);

/**
 * Checks if a module specifier resolves to a typecode SDK path.
 * Typecode SDK files (code/core/*, code/board-*, @typecode/* packages) are 
 * type-level only and should produce no C++ output or #include directives.
 */
function isTypecodeSDKImport(moduleSpecifier: string, fromFile: string): boolean {
  // Check for @typecode/* npm package imports
  if (moduleSpecifier.startsWith("@typecode/")) {
    return true;
  }
  
  // Check for relative imports to code/core or code/board-* paths
  if (!moduleSpecifier.startsWith(".")) {
    return false;
  }
  const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const normalized = candidate.replace(/\\/g, "/");
      if (/\/code\/core\//.test(normalized) || /\/code\/board-/.test(normalized)) {
        return true;
      }
    }
  }
  return false;
}

interface EmitterOptions {
  outDir: string;
  emitMode: EmitMode;
  target: TargetProfile;
  libdefs: Map<string, LibraryDefinition>;
  emitMaps: boolean;
  platformContext?: PlatformContext;
  polyfills?: RuntimePolyfillIR[];
  /** Info about the npm package being transpiled (if this file is from an npm package) */
  npmPackage?: ResolvedNpmPackage;
  /** Map of all npm packages being transpiled (source path -> package info) */
  npmPackages?: Map<string, ResolvedNpmPackage>;
  /** Whether this is the entry file (main .ino for Arduino) */
  isEntryFile?: boolean;
}



function normalizeRawExpression(value: string, target: TargetProfile = "generic"): string {
  let normalized = value
    .replace(/===/g, "==")
    .replace(/!==/g, "!=");

  // Convert TypeScript-style enum member access (EnumType.MEMBER_NAME) to C++ scoped
  // enum access (EnumType::MEMBER_NAME).  The pattern matches an identifier followed by
  // a dot followed by an ALL_CAPS name (2+ uppercase letters at the start), which is the
  // naming convention for enum class members.  Pin aliases like D0, D1 (single uppercase
  // letter + digits) are intentionally excluded because they don't start with 2+ uppercase
  // letters.
  normalized = normalized.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Z]{2,}[A-Z0-9_]*)\b/g,
    "$1::$2"
  );

  if (target === "arduino") {
    normalized = normalized.replace(/\bPinMode::(HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP)\b/g, "PinMode::_$1");
    normalized = normalized.replace(/\bPinMode::(_?[A-Z_]+)\b/g, "static_cast<int>(PinMode::$1)");
    normalized = normalized.replace(/(->|\.)capabilities\.interrupt\b/g, "$1capabilities");
    normalized = normalized.replace(/\bstd::(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/g, "$1");
    normalized = normalized.replace(/\bDate\.now\(\)/g, "millis()");
    normalized = normalized.replace(/\bundefined\b/g, "0");
    normalized = normalized.replace(/\bnull\b/g, "0");
  }

  return normalized;
}

function normalizeComment(comment: string): string[] {
  return comment
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function emitCommentLines(
  comments: string[] | undefined,
  indent: string,
  appendLine: (line: string) => void,
): void {
  for (const comment of comments ?? []) {
    for (const line of normalizeComment(comment)) {
      appendLine(`${indent}${line}`);
    }
  }
}

function renderExpression(expr: ExpressionIR, exprTransformer?: (expr: string) => string, target: TargetProfile = "generic"): string {
  switch (expr.kind) {
    case "number":
      return `${expr.value}`;
    case "string":
      return `"${expr.value.replace(/"/g, '\\"')}"`;
    case "boolean":
      return expr.value ? "true" : "false";
    case "identifier":
      if (target === "arduino" && (expr.value === "null" || expr.value === "undefined")) {
        return "0";
      }
      return expr.value;
    case "raw":
      // Apply transformation to raw expressions (for fixing pointer field access)
      if (exprTransformer) {
        return normalizeRawExpression(exprTransformer(expr.value), target);
      }
      return normalizeRawExpression(expr.value, target);
    case "await":
      return renderExpression(expr.value, exprTransformer, target);
    case "ternary":
      return `(${renderExpression(expr.condition, exprTransformer, target)} ? ${renderExpression(expr.whenTrue, exprTransformer, target)} : ${renderExpression(expr.whenFalse, exprTransformer, target)})`;
    case "array":
      const elements = expr.elements.map((e) => renderExpression(e, exprTransformer, target)).join(", ");
      return `{ ${elements} }`;
    case "object":
      const fields = expr.fields.map((f) => `${renderExpression(f.value, exprTransformer, target)}`).join(", ");
      return `{ ${fields} }`;
    case "instanceof":
      // C++ doesn't have native instanceof - use dynamic_cast with RTTI
      // Note: This assumes the object is a pointer (from 'new'). For non-pointer objects,
      // the behavior may differ. Full type tracking would be needed for correct handling.
      return `(dynamic_cast<const ${expr.className}*>(${renderExpression(expr.object, exprTransformer, target)}) != nullptr)`;
    case "spread_array":
      // Spread arrays need to be handled in variable declaration context
      // For expression context, emit a comment warning
      return `/* spread_array: see variable declaration */`;
    case "binary": {
      const leftRendered = renderExpression(expr.left, exprTransformer, target);
      const rightRendered = renderExpression(expr.right, exprTransformer, target);
      // In Arduino/C++ you cannot use + to concatenate two string literals (const char*).
      // Wrap a bare string-literal left operand with String() so the Arduino String
      // class's operator+ takes over and produces a String result.
      if (target === "arduino" && expr.operator === "+" && expr.left.kind === "string") {
        return `String(${leftRendered}) + ${rightRendered}`;
      }
      return `${leftRendered} ${expr.operator} ${rightRendered}`;
    }
    case "unary":
      return `${expr.operator}${renderExpression(expr.operand, exprTransformer, target)}`;
    case "property-access": {
      const chain = extractPropertyChain(expr);
      if (chain) {
        const boardDef = renderBoardDefinitionAccess(chain, target, _emitBoardConstants);
        if (boardDef !== undefined) return boardDef;
      }
      const objStr = renderExpression(expr.object, exprTransformer, target);
      // Use C++ scope-resolution operator (::) for enum class member access.
      // Detect enum types via the accumulated _emitEnumNames set (populated by emitCpp
      // from each file's program.enums as files are processed).
      if (expr.object.kind === "identifier" && _emitEnumNames.has(expr.object.value)) {
        // Prefix enum members that were renamed with _ to avoid Arduino macro conflicts.
        const enumMember = (target === "arduino" && arduinoEnumMemberRenames.has(expr.property))
          ? `_${expr.property}`
          : expr.property;
        const enumAccess = `${objStr}::${enumMember}`;
        // Wrap in static_cast<> for Arduino target: enum class does not implicitly
        // convert to int.  Use `long` for enums whose values exceed AVR's 16-bit int.
        if (target === "arduino") {
          const castType = _largeEnumNames.has(expr.object.value) ? "long" : "int";
          return `static_cast<${castType}>(${enumAccess})`;
        }
        return enumAccess;
      }
      return `${objStr}.${expr.property}`;
    }
    case "typecode-call": {
      const renderA = (e: ExpressionIR) => renderExpression(e, exprTransformer, target);
      const translated = renderArduinoBuiltin(expr.receiver, expr.receiverKind, expr.method, expr.args, renderA, _emitBoardConstants);
      if (translated !== undefined) return translated;
      // Fallback: render as plain method call
      return `${expr.receiver}.${expr.method}(${expr.args.map(renderA).join(", ")})`;
    }
    default:
      return "/* unsupported_expr */";
  }
}

function mapFunctionName(originalName: string, target: TargetProfile): string {
  if (target === "arduino" && (originalName === "void" || originalName === "__arduino_setup__")) {
    return "setup";
  }
  if (originalName === "__arduino_setup__") {
    return "setup";
  }
  return originalName;
}

function normalizeCppTypeForTarget(typeName: string, target: TargetProfile): string {
  if (typeName === "auto") {
    return "int";
  }

  if (target === "arduino" && typeName === "std::string") {
    return "const char*";
  }

  if (target === "arduino") {
    const fnTypeMatch = typeName.match(/^std::function<\s*([^()<>]+)\((.*)\)\s*>$/);
    if (fnTypeMatch) {
      const returnType = fnTypeMatch[1].trim();
      const params = fnTypeMatch[2].trim();
      return `${returnType} (*)(${params})`;
    }
  }

  return typeName;
}

function renderTypedName(cppType: string, name: string, target: TargetProfile, isConst = false): string {
  const normalizedType = normalizeCppTypeForTarget(cppType, target);
  const fnPtrMatch = normalizedType.match(/^(.+?)\s*\(\*\)\((.*)\)$/);
  if (fnPtrMatch) {
    const returnType = fnPtrMatch[1].trim();
    const params = fnPtrMatch[2].trim();
    const constPrefix = isConst ? "const " : "";
    return `${constPrefix}${returnType} (*${name})(${params})`;
  }
  const constPrefix = isConst ? "const " : "";
  return `${constPrefix}${normalizedType} ${name}`;
}

function mapReturnType(functionName: string, returnType: string, target: TargetProfile): string {
  if (target === "arduino" && (functionName === "setup" || functionName === "loop")) {
    return "void";
  }

  if (functionName === "setup" || functionName === "loop") {
    return "void";
  }

  return normalizeCppTypeForTarget(returnType, target);
}

function collectDeclaredTypes(program: ProgramIR): string[] {
  const types: string[] = [];

  for (const typeAlias of program.typeAliases) {
    types.push(typeAlias.cppType);
  }

  for (const fn of program.functions) {
    types.push(fn.returnType);
    for (const parameter of fn.parameters) {
      types.push(parameter.cppType);
    }
  }

  for (const statement of program.topLevelStatements) {
    if (statement.kind === "var_decl") {
      types.push(statement.cppType);
    }
  }

  for (const classDef of program.classes) {
    for (const field of classDef.fields) {
      types.push(field.cppType);
    }
    for (const method of classDef.methods) {
      types.push(method.returnType);
      for (const parameter of method.parameters) {
        types.push(parameter.cppType);
      }
    }
    if (classDef.constructor) {
      for (const parameter of classDef.constructor.parameters) {
        types.push(parameter.cppType);
      }
    }
  }

  return types;
}

function inferObjectFieldType(
  value: ExpressionIR,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
  knownObjectTypes?: Map<string, string>,
  knownObjectFieldTypes?: Map<string, Map<string, string>>,
): string {
  if (value.kind === "number") {
    return Number.isInteger(value.value) ? "int" : "float";
  }

  if (value.kind === "boolean") {
    return "bool";
  }

  if (value.kind === "string") {
    return "const char*";
  }

  if (value.kind === "identifier") {
    if (knownObjectTypes && knownObjectTypes.has(value.value)) {
      return knownObjectTypes.get(value.value)!;
    }
    if (value.value === "Pins") {
      return "_Pins_t";
    }
    // Check if this identifier is a known pointer variable
    if (pointerVarTypes && pointerVarTypes.has(value.value)) {
      return pointerVarTypes.get(value.value)!;
    }
    return "int";
  }

  // For enum member access (e.g. I2CSpeed.STANDARD), return `long` if the
  // enum has values outside AVR's 16-bit int range, otherwise `int`.
  if (value.kind === "property-access" && value.object.kind === "identifier") {
    return _largeEnumNames.has(value.object.value) ? "long" : "int";
  }

  if (value.kind === "raw") {
    const memberAccessMatch = value.value.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (memberAccessMatch && knownObjectFieldTypes) {
      const objectName = memberAccessMatch[1];
      const fieldName = memberAccessMatch[2];
      const fields = knownObjectFieldTypes.get(objectName);
      if (fields?.has(fieldName)) {
        return fields.get(fieldName)!;
      }
      if (objectName === "Pins") {
        if (fieldName === "D2") {
          return "AVRInterruptPin*";
        }
        if (fieldName === "D3") {
          return "AVRPWMInterruptPin*";
        }
        if (["D3", "D5", "D6", "D9", "D10", "D11"].includes(fieldName)) {
          return "AVRPWMPin*";
        }
        if (/^A\d+$/.test(fieldName)) {
          return "AVRAnalogPin*";
        }
        if (/^D\d+$/.test(fieldName) || fieldName === "LED") {
          return "AVRDigitalPin*";
        }
      }
    }

    const newMatch = value.value.match(/^new\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (newMatch) {
      return `${newMatch[1]}*`;
    }

    const callMatch = value.value.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (callMatch && knownFunctionReturnTypes) {
      const inferred = knownFunctionReturnTypes.get(callMatch[1]);
      if (inferred) {
        return inferred;
      }
    }
  }

  if (value.kind === "array") {
    const elementKinds = value.elements.map((element) => element.kind);
    let elementType = "int";
    if (elementKinds.includes("string")) {
      elementType = "const char*";
    } else if (value.elements.some((element) => element.kind === "number" && !Number.isInteger((element as Extract<ExpressionIR, { kind: "number" }>).value))) {
      elementType = "float";
    } else if (elementKinds.includes("boolean") && !elementKinds.includes("number")) {
      elementType = "bool";
    }

    return `std::vector<${elementType}>`;
  }

  return "int";
}

function hasArrayInObjectLiteral(program: ProgramIR): boolean {
  const hasArray = (expr: ExpressionIR): boolean => {
    if (expr.kind === "array") {
      return true;
    }

    if (expr.kind === "object") {
      return expr.fields.some((field) => hasArray(field.value));
    }

    if (expr.kind === "ternary") {
      return hasArray(expr.condition) || hasArray(expr.whenTrue) || hasArray(expr.whenFalse);
    }

    return false;
  };

  const hasArrayInStatement = (statement: StatementIR): boolean => {
    if (statement.kind === "var_decl" && statement.initializer) {
      return hasArray(statement.initializer);
    }
    if (statement.kind === "assign") {
      return hasArray(statement.value);
    }
    if (statement.kind === "return" && statement.value) {
      return hasArray(statement.value);
    }
    if (statement.kind === "call") {
      return statement.args.some((arg) => hasArray(arg));
    }
    return false;
  };

  if (program.topLevelStatements.some((statement) => hasArrayInStatement(statement))) {
    return true;
  }

  for (const fn of program.functions) {
    if (fn.statements.some((statement) => hasArrayInStatement(statement))) {
      return true;
    }
  }

  for (const classDef of program.classes) {
    if (classDef.fields.some((field) => field.initializer ? hasArray(field.initializer) : false)) {
      return true;
    }
    for (const method of classDef.methods) {
      if (method.statements.some((statement) => hasArrayInStatement(statement))) {
        return true;
      }
    }
    if (classDef.constructor && classDef.constructor.statements.some((statement) => hasArrayInStatement(statement))) {
      return true;
    }
  }

  return false;
}

function hasThrowStatements(program: ProgramIR): boolean {
  const statementHasThrow = (statement: StatementIR): boolean => {
    if (statement.kind === "throw") {
      return true;
    }

    if (statement.kind === "while" || statement.kind === "do_while") {
      return statement.body.some(statementHasThrow);
    }

    if (statement.kind === "for" || statement.kind === "for_of" || statement.kind === "for_in") {
      return statement.body.some(statementHasThrow);
    }

    if (statement.kind === "if") {
      return statement.thenBranch.some(statementHasThrow) || (statement.elseBranch?.some(statementHasThrow) ?? false);
    }

    if (statement.kind === "switch") {
      return statement.cases.some((caseClause) => caseClause.body.some(statementHasThrow));
    }

    if (statement.kind === "try") {
      return statement.tryBlock.some(statementHasThrow) || (statement.catchBlock?.some(statementHasThrow) ?? false);
    }

    return false;
  };

  if (program.topLevelStatements.some(statementHasThrow)) {
    return true;
  }

  for (const fn of program.functions) {
    if (fn.statements.some(statementHasThrow)) {
      return true;
    }
  }

  for (const classDef of program.classes) {
    if (classDef.methods.some((method) => method.statements.some(statementHasThrow))) {
      return true;
    }
    if (classDef.constructor && classDef.constructor.statements.some(statementHasThrow)) {
      return true;
    }
  }

  return false;
}

function hasStdMathCalls(program: ProgramIR): boolean {
  const mathPattern = /\bstd::(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/;

  const expressionHasMath = (expr: ExpressionIR): boolean => {
    if (expr.kind === "raw") {
      return mathPattern.test(expr.value);
    }
    if (expr.kind === "await") {
      return expressionHasMath(expr.value);
    }
    if (expr.kind === "ternary") {
      return expressionHasMath(expr.condition) || expressionHasMath(expr.whenTrue) || expressionHasMath(expr.whenFalse);
    }
    if (expr.kind === "array") {
      return expr.elements.some(expressionHasMath);
    }
    if (expr.kind === "object") {
      return expr.fields.some((field) => expressionHasMath(field.value));
    }
    if (expr.kind === "instanceof") {
      return expressionHasMath(expr.object);
    }
    if (expr.kind === "spread_array") {
      return expressionHasMath(expr.spreadExpr) || expr.additionalElements.some(expressionHasMath);
    }
    return false;
  };

  const statementHasMath = (statement: StatementIR): boolean => {
    if (statement.kind === "call") {
      return statement.args.some(expressionHasMath);
    }
    if (statement.kind === "var_decl") {
      return statement.initializer ? expressionHasMath(statement.initializer) : false;
    }
    if (statement.kind === "assign") {
      return expressionHasMath(statement.value);
    }
    if (statement.kind === "return") {
      return statement.value ? expressionHasMath(statement.value) : false;
    }
    if (statement.kind === "while" || statement.kind === "do_while") {
      return expressionHasMath(statement.condition) || statement.body.some(statementHasMath);
    }
    if (statement.kind === "if") {
      return expressionHasMath(statement.condition) || statement.thenBranch.some(statementHasMath) || (statement.elseBranch?.some(statementHasMath) ?? false);
    }
    if (statement.kind === "for") {
      return (statement.initializer ? statementHasMath(statement.initializer) : false)
        || (statement.condition ? expressionHasMath(statement.condition) : false)
        || (statement.increment ? statementHasMath(statement.increment) : false)
        || statement.body.some(statementHasMath);
    }
    if (statement.kind === "for_of") {
      return statementHasMath(statement.variable) || expressionHasMath(statement.iterable) || statement.body.some(statementHasMath);
    }
    if (statement.kind === "for_in") {
      return statementHasMath(statement.variable) || expressionHasMath(statement.object) || statement.body.some(statementHasMath);
    }
    if (statement.kind === "switch") {
      return expressionHasMath(statement.expression) || statement.cases.some((caseClause) =>
        (caseClause.value ? expressionHasMath(caseClause.value) : false) || caseClause.body.some(statementHasMath)
      );
    }
    if (statement.kind === "try") {
      return statement.tryBlock.some(statementHasMath) || (statement.catchBlock?.some(statementHasMath) ?? false);
    }
    if (statement.kind === "throw") {
      return expressionHasMath(statement.value);
    }
    return false;
  };

  if (program.topLevelStatements.some(statementHasMath)) {
    return true;
  }
  if (program.functions.some((fn) => fn.statements.some(statementHasMath))) {
    return true;
  }
  for (const classDef of program.classes) {
    if (classDef.methods.some((method) => method.statements.some(statementHasMath))) {
      return true;
    }
    if (classDef.constructor && classDef.constructor.statements.some(statementHasMath)) {
      return true;
    }
  }
  return false;
}

function applySymbolMap(callee: string, symbolMap: Record<string, string>): string {
  const firstDot = callee.indexOf(".");
  if (firstDot === -1) {
    return symbolMap[callee] ?? callee;
  }

  const root = callee.slice(0, firstDot);
  const rest = callee.slice(firstDot);
  return `${symbolMap[root] ?? root}${rest}`;
}

function renderBoilerplate(program: ProgramIR): string {
  const chunks: string[] = [];

  if (program.boilerplates.has("async_stub")) {
    chunks.push("struct TsAsyncTask { bool done = true; };\n");
  }

  return chunks.join("\n");
}

// ---------------------------------------------------------------------------
// Async state-machine helpers
// ---------------------------------------------------------------------------

function toPascalCaseLocal(str: string): string {
  return str
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Generates a cooperative state-machine class for an async function.
 *
 * Handles two patterns:
 *   1. Cyclic: single `while(true)` body containing `await delay()` calls.
 *   2. Linear: sequential statements with `await delay()` calls.
 *
 * Each `await delay(ms)` call becomes a timed wait state that polls `millis()`.
 */
function generateAsyncTaskClass(
  fnName: string,
  fnStatements: StatementIR[],
  target: TargetProfile,
  knownFunctionReturnTypes: Map<string, string>,
): { classDef: string; instanceDecl: string } {
  const className = toPascalCaseLocal(fnName) + "Task";
  const instanceName = `${fnName}Task`;

  // Detect whether the body is a single while-loop (cyclic) or linear statements
  let bodyStatements: StatementIR[];
  let isCyclic = false;

  if (fnStatements.length === 1 && fnStatements[0].kind === "while") {
    isCyclic = true;
    bodyStatements = (fnStatements[0] as any).body as StatementIR[];
  } else {
    bodyStatements = fnStatements;
  }

  // Split body into segments at each awaited call
  interface Segment {
    preStatements: StatementIR[];
    awaitedCallee?: string;
    awaitedArgs: ExpressionIR[];
  }

  const segments: Segment[] = [];
  let currentPre: StatementIR[] = [];

  for (const stmt of bodyStatements) {
    if (stmt.kind === "call" && (stmt as any).isAwaited) {
      segments.push({ preStatements: currentPre, awaitedCallee: stmt.callee, awaitedArgs: stmt.args });
      currentPre = [];
    } else {
      currentPre.push(stmt);
    }
  }
  // Terminal segment (trailing statements after the last await, or the whole body if no awaits)
  segments.push({ preStatements: currentPre, awaitedArgs: [] });

  const awaitCount = segments.filter((s) => s.awaitedCallee !== undefined).length;
  const stateCount = awaitCount + 1; // STATE_0 … STATE_{awaitCount}; cyclic loops back, linear adds STATE_DONE

  const stateNames: string[] = [];
  for (let i = 0; i < stateCount; i++) stateNames.push(`STATE_${i}`);
  if (!isCyclic) stateNames.push("STATE_DONE");

  // Helper: render a non-await statement as a single C++ line
  const renderStmt = (stmt: StatementIR): string =>
    renderStatement(stmt, false, target, undefined, undefined, knownFunctionReturnTypes);

  const caseLines: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const stateName = `STATE_${i}`;
    const isTerminal = seg.awaitedCallee === undefined;
    const body: string[] = [];

    if (i === 0) {
      // STATE_0: execute immediately, no millis check
      for (const stmt of seg.preStatements) body.push(`        ${renderStmt(stmt)}`);
      if (!isTerminal) {
        const ms = seg.awaitedArgs[0] ? renderExpression(seg.awaitedArgs[0], undefined, target) : "0";
        body.push(`        _waitUntil = millis() + ${ms};`);
        body.push(`        _state = STATE_${i + 1};`);
      } else {
        body.push(`        _state = ${isCyclic ? "STATE_0" : "STATE_DONE"};`);
      }
    } else {
      // STATE_i (i >= 1): poll millis, then execute segment
      body.push(`        if (millis() >= _waitUntil) {`);
      for (const stmt of seg.preStatements) body.push(`          ${renderStmt(stmt)}`);
      if (!isTerminal) {
        const ms = seg.awaitedArgs[0] ? renderExpression(seg.awaitedArgs[0], undefined, target) : "0";
        body.push(`          _waitUntil = millis() + ${ms};`);
        body.push(`          _state = STATE_${i + 1};`);
      } else {
        body.push(`          _state = ${isCyclic ? "STATE_0" : "STATE_DONE"};`);
      }
      body.push(`        }`);
    }

    caseLines.push(`      case ${stateName}:`, ...body, `        break;`);
  }

  if (!isCyclic) caseLines.push(`      case STATE_DONE:`, `        break;`);

  const stateEnumList = stateNames.join(", ");
  const isCompleteExpr = isCyclic ? "false" : "_state == STATE_DONE";

  const classDef = [
    `// Async state machine for ${fnName}`,
    `class ${className} {`,
    `public:`,
    `  enum State { ${stateEnumList} };`,
    `  ${className}() : _state(STATE_0), _waitUntil(0) {}`,
    `  void run() {`,
    `    switch (_state) {`,
    ...caseLines,
    `    }`,
    `  }`,
    `  bool isComplete() const { return ${isCompleteExpr}; }`,
    `  void reset() { _state = STATE_0; _waitUntil = 0; }`,
    `private:`,
    `  State _state;`,
    `  unsigned long _waitUntil;`,
    `};`,
  ].join("\n");

  return { classDef, instanceDecl: `${className} ${instanceName};` };
}
/**
 * Check if an expression requires runtime execution (cannot be evaluated at global scope in C++)
 */
function isRuntimeExpression(expr: ExpressionIR): boolean {
  switch (expr.kind) {
    case "number":
    case "string":
    case "boolean":
      // Literals are compile-time constants
      return false;
    
    case "identifier":
      // Simple identifiers might be compile-time constants, but could also be
      // runtime values. We'll be conservative and allow them at global scope
      // since they might reference constants.
      return false;
    
    case "array":
      // Arrays are okay at global scope if all elements are compile-time
      return expr.elements.some((e) => isRuntimeExpression(e));
    
    case "object":
      // Object literals with runtime values need runtime execution
      // Also, object literals with identifier fields need runtime execution
      // because they may reference runtime-created variables (like pointers from 'new')
      return expr.fields.some((f) => isRuntimeExpression(f.value) || f.value.kind === "identifier");
    
    case "raw":
      // Raw expressions might contain method calls - check for common patterns
      // Look for function/method call patterns: identifier(...) or ...(...)
      const rawValue = expr.value;
      // Check for call patterns: ends with ) and contains ( not at start
      if (rawValue.includes("(") && rawValue.includes(")")) {
        // Has function call syntax - likely runtime
        return true;
      }
      // Check for 'new' keyword
      if (rawValue.startsWith("new ") || rawValue.includes(" new ")) {
        return true;
      }
      return false;
    
    case "await":
      // Await expressions are definitely runtime
      return true;
    
    case "ternary":
      // Ternary expressions are runtime if any part is runtime
      return (
        isRuntimeExpression(expr.condition) ||
        isRuntimeExpression(expr.whenTrue) ||
        isRuntimeExpression(expr.whenFalse)
      );
    
    case "instanceof":
      // instanceof requires RTTI and runtime evaluation
      return true;
    
    case "spread_array":
      // Spread operations are runtime
      return true;
    
    default:
      // Unknown expression types - be conservative
      return true;
  }
}

/**
 * Check if a statement requires runtime execution
 */
function statementRequiresRuntime(statement: StatementIR): boolean {
  if (statement.kind === "var_decl") {
    // Variable declaration requires runtime if its initializer does
    return statement.initializer ? isRuntimeExpression(statement.initializer) : false;
  }
  // All other statement types (calls, assignments, etc.) are runtime
  return true;
}

function hasConsoleCalls(program: ProgramIR): boolean {
  const checkStatements = (statements: StatementIR[]): boolean => {
    for (const stmt of statements) {
      if (stmt.kind === "call" && isConsoleCall(stmt.callee)) {
        return true;
      }
      // Check nested statements in control flow
      if ("body" in stmt && Array.isArray(stmt.body)) {
        if (checkStatements(stmt.body)) return true;
      }
      if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) {
        if (checkStatements(stmt.thenBranch)) return true;
      }
      if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) {
        if (checkStatements(stmt.elseBranch)) return true;
      }
      if ("cases" in stmt && Array.isArray(stmt.cases)) {
        for (const c of stmt.cases) {
          if (checkStatements(c.body)) return true;
        }
      }
      if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) {
        if (checkStatements(stmt.tryBlock)) return true;
      }
      if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) {
        if (checkStatements(stmt.catchBlock)) return true;
      }
    }
    return false;
  };

  // Check all functions
  for (const fn of program.functions) {
    if (checkStatements(fn.statements)) return true;
  }
  // Check top-level statements
  if (checkStatements(program.topLevelStatements)) return true;
  // Check class methods
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (checkStatements(method.statements)) return true;
    }
    if (cls.constructor && checkStatements(cls.constructor.statements)) return true;
  }
  return false;
}

function normalizeInclude(include: string): string {
  if (include.startsWith("<") || include.startsWith("\"")) {
    return include;
  }
  return `<${include}>`;
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function renderParameters(
  parameters: Array<{ name: string; cppType: string; defaultValue?: any }>,
  target: TargetProfile = "generic",
): string {
  if (parameters.length === 0) {
    return "";
  }

  return parameters
    .map((parameter) => {
      let result = renderTypedName(parameter.cppType, parameter.name, target);
      if (parameter.defaultValue) {
        result += ` = ${renderExpression(parameter.defaultValue, undefined, target)}`;
      }
      return result;
    })
    .join(", ");
}

/**
 * Check if a callee is a console method call (e.g., "console.log", "console.error")
 */
function isConsoleCall(callee: string): boolean {
  return callee.startsWith("console.");
}

/**
 * Get the console method name from a callee (e.g., "log" from "console.log")
 */
function getConsoleMethod(callee: string): string {
  return callee.slice("console.".length);
}

/**
 * Transform console.log/error/warn calls based on target platform
 * Generic C++: std::cout, std::cerr
 * Arduino: Serial.println with prefix for error/warn
 */
function transformConsoleCall(
  callee: string,
  args: ExpressionIR[],
  target: TargetProfile,
  forHeader: boolean
): string {
  const method = getConsoleMethod(callee);
  const renderedArgs = args.map((arg) => renderExpression(arg, undefined, target)).join(", ");
  
  if (target === "arduino") {
    // Arduino: use Serial
    switch (method) {
      case "log":
        return forHeader 
          ? `Serial.println(${renderedArgs})`
          : `Serial.println(${renderedArgs});`;
      case "error":
        return forHeader
          ? `Serial.print("[ERROR] "); Serial.println(${renderedArgs})`
          : `Serial.print("[ERROR] "); Serial.println(${renderedArgs});`;
      case "warn":
        return forHeader
          ? `Serial.print("[WARN] "); Serial.println(${renderedArgs})`
          : `Serial.print("[WARN] "); Serial.println(${renderedArgs});`;
      case "info":
        return forHeader
          ? `Serial.print("[INFO] "); Serial.println(${renderedArgs})`
          : `Serial.print("[INFO] "); Serial.println(${renderedArgs});`;
      case "debug":
        return forHeader
          ? `Serial.print("[DEBUG] "); Serial.println(${renderedArgs})`
          : `Serial.print("[DEBUG] "); Serial.println(${renderedArgs});`;
      default:
        // Unknown console method - pass through
        return forHeader 
          ? `Serial.println(${renderedArgs})`
          : `Serial.println(${renderedArgs});`;
    }
  } else {
    // Generic C++: use std::cout / std::cerr
    switch (method) {
      case "log":
      case "info":
      case "debug":
        return forHeader
          ? `std::cout << ${renderedArgs} << std::endl`
          : `std::cout << ${renderedArgs} << std::endl;`;
      case "error":
        return forHeader
          ? `std::cerr << "[ERROR] " << ${renderedArgs} << std::endl`
          : `std::cerr << "[ERROR] " << ${renderedArgs} << std::endl;`;
      case "warn":
        return forHeader
          ? `std::cerr << "[WARN] " << ${renderedArgs} << std::endl`
          : `std::cerr << "[WARN] " << ${renderedArgs} << std::endl;`;
      default:
        return forHeader
          ? `std::cout << ${renderedArgs} << std::endl`
          : `std::cout << ${renderedArgs} << std::endl;`;
    }
  }
}

/**
 * Collect pointer variable types from program statements
 * Variables initialized with 'new ClassName()' get type 'ClassName*'
 */
function collectPointerVarTypes(statements: StatementIR[]): Map<string, string> {
  const pointerVarTypes = new Map<string, string>();
  
  for (const statement of statements) {
    if (statement.kind === "var_decl" && statement.initializer) {
      const init = statement.initializer;
      // Check for raw expression containing 'new'
      if (init.kind === "raw" && init.value.startsWith("new ")) {
        // Extract class name from 'new ClassName(...)'
        const match = init.value.match(/^new\s+(\w+)/);
        if (match) {
          pointerVarTypes.set(statement.name, `${match[1]}*`);
        }
      }
    }
  }
  
  return pointerVarTypes;
}

function renderStatement(
  statement: StatementIR,
  forHeader: boolean = false,
  target: TargetProfile = "generic",
  pointerVarTypes?: Map<string, string>,
  calleeTransformer?: (callee: string) => string,
  knownFunctionReturnTypes?: Map<string, string>,
): string {
  if (statement.kind === "call") {
    // Handle console.* calls specially
    if (isConsoleCall(statement.callee)) {
      return transformConsoleCall(statement.callee, statement.args, target, forHeader);
    }
    // Handle typecode SDK calls (pin/serial/i2c/spi)
    if (target === "arduino") {
      const renderA = (e: ExpressionIR) => renderExpression(e, undefined, target);
      const translated = tryRenderTypecodeCallStatement(statement.callee, statement.args, target, renderA, _emitBoardConstants);
      if (translated !== undefined) {
        return forHeader ? translated : `${translated};`;
      }
    }
    let callee = statement.callee;
    if (callee.startsWith("this.")) {
      callee = `this->${callee.slice("this.".length)}`;
    }
    if (calleeTransformer) {
      callee = calleeTransformer(callee);
    }
    callee = normalizeRawExpression(callee, target);
    const renderedArgs = statement.args.map((arg) => renderExpression(arg, undefined, target)).join(", ");
    return forHeader ? `${callee}(${renderedArgs})` : `${callee}(${renderedArgs});`;
  }

  if (statement.kind === "assign") {
    return forHeader 
      ? `${statement.target} ${statement.operator} ${renderExpression(statement.value, undefined, target)}`
      : `${statement.target} ${statement.operator} ${renderExpression(statement.value, undefined, target)};`;
  }

  if (statement.kind === "update") {
    return statement.prefix
      ? `${statement.operator}${statement.target}${forHeader ? "" : ";"}`
      : `${statement.target}${statement.operator}${forHeader ? "" : ";"}`;
  }

  if (statement.kind === "return") {
    return statement.value ? `return ${renderExpression(statement.value, undefined, target)};` : "return;";
  }

  if (statement.kind === "while") {
    return `while (${renderExpression(statement.condition, undefined, target)})`;
  }

  if (statement.kind === "if") {
    return `if (${renderExpression(statement.condition, undefined, target)})`;
  }

  if (statement.kind === "for") {
    const init = statement.initializer ? renderStatement(statement.initializer, true) : "";
    const cond = statement.condition ? renderExpression(statement.condition, undefined, target) : "";
    const incr = statement.increment ? renderStatement(statement.increment, true) : "";
    return `for (${init}; ${cond}; ${incr})`;
  }

  if (statement.kind === "for_of") {
    const varDecl = statement.variable;
    if (varDecl.kind === "var_decl") {
      return `for (${renderTypedName(varDecl.cppType, varDecl.name, target, varDecl.storage === "const")} : ${renderExpression(statement.iterable, undefined, target)})`;
    }
    return `for (auto item : ${renderExpression(statement.iterable, undefined, target)})`;
  }

  if (statement.kind === "for_in") {
    // for...in iterates over object keys
    // In C++, we need to use a map iterator or similar pattern
    // For Arduino/embedded, emit a comment and a simplified iteration pattern
    const varDecl = statement.variable;
    if (varDecl.kind === "var_decl") {
      // Use a key iteration pattern - the object should be a map-like structure
      return `for (${renderTypedName(varDecl.cppType, varDecl.name, target, varDecl.storage === "const")} : ${renderExpression(statement.object, undefined, target)})`;
    }
    return `for (auto key : ${renderExpression(statement.object, undefined, target)})`;
  }

  if (statement.kind === "break") {
    return "break;";
  }

  if (statement.kind === "continue") {
    return "continue;";
  }

  if (statement.kind === "do_while") {
    return `do`;
  }

  if (statement.kind === "switch") {
    return `switch (${renderExpression(statement.expression, undefined, target)})`;
  }

  if (statement.kind === "try") {
    return "try";
  }

  if (statement.kind === "throw") {
    if (target === "arduino") {
      return "for (;;) {}";
    }
    return `throw ${renderExpression(statement.value, undefined, target)};`;
  }

  if (statement.kind !== "var_decl") {
    return "/* unsupported_statement */";
  }

  const declaredType = normalizeCppTypeForTarget(statement.cppType, target);
  const declaration = renderTypedName(statement.cppType, statement.name, target, statement.storage === "const");
  if (statement.initializer) {
    // Handle array initializers
    if (statement.initializer.kind === "array") {
      const elements = statement.initializer.elements.map((e) => renderExpression(e, calleeTransformer, target)).join(", ");
      if (declaredType.startsWith("std::vector<")) {
        return forHeader
          ? `${declaration} = { ${elements} }`
          : `${declaration} = { ${elements} };`;
      }
      // Use "int" for "auto" element type since C arrays need explicit types
      const arrayType = statement.initializer.elementType === "auto" ? "int" : statement.initializer.elementType;
      return forHeader 
        ? `${arrayType} ${statement.name}[] = { ${elements} }`
        : `${arrayType} ${statement.name}[] = { ${elements} };`;
    }
    // Handle object initializers with inline struct definition
    if (statement.initializer.kind === "object") {
      const structName = `_${statement.name}_t`;
      const fieldDefs = statement.initializer.fields
        .map((f) => `${inferObjectFieldType(f.value, pointerVarTypes, knownFunctionReturnTypes)} ${f.name};`)
        .join(" ");
      const initValues = statement.initializer.fields
        .map((f) => {
          if (target === "arduino" && f.value.kind === "object") {
            return "0";
          }
          return `${renderExpression(f.value, calleeTransformer, target)}`;
        })
        .join(", ");
      return forHeader
        ? `struct ${structName} { ${fieldDefs} } ${statement.name} = { ${initValues} }`
        : `struct ${structName} { ${fieldDefs} } ${statement.name} = { ${initValues} };`;
    }
    // Handle spread array initializers
    if (statement.initializer.kind === "spread_array") {
      // For spread arrays, we need to copy the source array and append additional elements
      // Since C++ doesn't have native spread, we create a larger array with all elements
      const arrayType = statement.initializer.elementType === "auto" ? "int" : statement.initializer.elementType;
      const spreadName = renderExpression(statement.initializer.spreadExpr, calleeTransformer, target);
      const additionalElements = statement.initializer.additionalElements.map(e => renderExpression(e, calleeTransformer, target)).join(", ");
      // Emit a comment indicating the spread behavior - for full support would need runtime helper
      return forHeader
        ? `${arrayType} ${statement.name}[] = { /* spread from ${spreadName} */ ${additionalElements} }`
        : `${arrayType} ${statement.name}[] = { /* spread from ${spreadName} */ ${additionalElements} };`;
    }
    return forHeader 
      ? `${declaration} = ${renderExpression(statement.initializer, calleeTransformer, target)}`
      : `${declaration} = ${renderExpression(statement.initializer, calleeTransformer, target)};`;
  }

  return forHeader ? declaration : `${declaration};`;
}

/**
 * Resolves an import to a local header file if it's from a transpiled npm package
 */
function resolveTranspiledModuleInclude(
  moduleSpecifier: string,
  npmPackages: Map<string, ResolvedNpmPackage> | undefined,
  fromFilePath: string
): { include: string; isTranspiled: boolean } {
  if (!npmPackages || npmPackages.size === 0) {
    return { include: "", isTranspiled: false };
  }

  if (moduleSpecifier.startsWith(".")) {
    const normalizedSpecifier = moduleSpecifier.endsWith(".js")
      ? `${moduleSpecifier.slice(0, -3)}.ts`
      : moduleSpecifier.endsWith(".mjs")
        ? `${moduleSpecifier.slice(0, -4)}.ts`
        : moduleSpecifier;

    const basePath = path.resolve(path.dirname(fromFilePath), normalizedSpecifier);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      path.join(basePath, "index.ts"),
      path.join(basePath, "index.tsx"),
    ].map((candidate) => path.resolve(candidate));

    for (const candidate of candidates) {
      const pkg = npmPackages.get(candidate);
      if (!pkg) {
        continue;
      }
      const currentPkg = npmPackages.get(path.resolve(fromFilePath));
      let headerName = `${pkg.moduleKey}.h`;
      if (currentPkg) {
        const currentDir = path.posix.dirname(currentPkg.moduleKey.replace(/\\/g, "/"));
        const targetPath = `${pkg.moduleKey.replace(/\\/g, "/")}.h`;
        let relativeHeader = path.posix.relative(currentDir, targetPath);
        if (!relativeHeader.startsWith(".")) {
          relativeHeader = `./${relativeHeader}`;
        }
        headerName = relativeHeader;
      }
      return { include: `"${headerName}"`, isTranspiled: true };
    }

    return { include: "", isTranspiled: false };
  }
  
  // Parse the module specifier to get package name and subpath
  const parts = moduleSpecifier.split("/");
  let packageName: string;
  let subpath: string;
  
  if (moduleSpecifier.startsWith("@")) {
    packageName = parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
    subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
  } else {
    packageName = parts[0];
    subpath = parts.length > 1 ? parts.slice(1).join("/") : "";
  }
  
  // Look for a matching npm package in our transpiled modules
  // The npmPackages map is keyed by source path, so we need to iterate
  for (const [sourcePath, pkg] of npmPackages) {
    // Match by package name (e.g., "@typecode/core" or "typecode-implementation")
    if (pkg.packageName === packageName) {
      // Use the moduleKey from the package info, which is already computed
      const headerName = `${pkg.moduleKey}.h`;
      return { include: `"${headerName}"`, isTranspiled: true };
    }
  }
  
  return { include: "", isTranspiled: false };
}

export function emitCpp(program: ProgramIR, options: EmitterOptions): GeneratedOutputs {
  // Make board constants available to the nested renderExpression function.
  _emitBoardConstants = program.boardConstants;
  // Accumulate enum class names so property-access rendering can use :: for enums.
  for (const e of program.enums) {
    _emitEnumNames.add(e.name);
    if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      _largeEnumNames.add(e.name);
    }
  }

  ensureDir(options.outDir);

  // For npm package files, use the moduleKey as the base name
  // For entry files, use the original filename
  const originalBaseName = path.basename(program.fileName).replace(/\.[^.]+$/, "");
  const outDirBaseName = path.basename(path.resolve(options.outDir));
  const baseName = options.npmPackage?.moduleKey
    || (options.target === "arduino" && !options.npmPackage && (options.isEntryFile ?? true) ? outDirBaseName : originalBaseName);
  
  // Determine emit mode and extensions
  // For npm packages, always emit .h/.cpp (not .ino)
  const isNpmPackage = !!options.npmPackage;
  const isEntryFile = options.isEntryFile !== false;
  const effectiveEmitMode: EmitMode = (options.target === "arduino" && !isNpmPackage) ? "cpp" : options.emitMode;
  const sourceExtension = (options.target === "arduino" && !isNpmPackage && isEntryFile) ? "ino" : "cpp";
  const headerPath = path.join(options.outDir, `${baseName}.h`);
  const sourcePath = path.join(options.outDir, `${baseName}.${sourceExtension}`);

  const includes: string[] = [];
  const symbolMap: Record<string, string> = {};
  let profileDiagnostics: Diagnostic[] = [];
  let shimLines: string[] = [];
  const emittedPolyfills = options.polyfills && options.polyfills.length > 0
    ? emitPolyfillBoilerplate(options.polyfills)
    : undefined;
  const hasAsyncRuntime = (options.polyfills ?? []).some((polyfill) => polyfill.id === "async_arduino");
  // True only when the Promise/MicrotaskQueue runtime was emitted (requires C++ stdlib).
  // On AVR this is false; ts2cpp_pump_microtasks() must NOT be called.
  const hasPromiseRuntime = (options.polyfills ?? []).some(
    (polyfill) => polyfill.id === "async_arduino" && (polyfill as any).hasPromiseRuntime === true
  );

  if (options.target === "arduino" && !isNpmPackage) {
    const arduinoProfile = resolveArduinoProfile(program, options.platformContext);
    includes.push(...arduinoProfile.forcedIncludes);
    Object.assign(symbolMap, arduinoProfile.symbolAliases);
    shimLines = [...arduinoProfile.shimLines];
    profileDiagnostics = [...arduinoProfile.diagnostics];
  }

  for (const imported of program.imports) {
    // Skip imports from typecode SDK modules — the symbols they export
    // (pin names like A0, D13, LED) are already provided by <Arduino.h>.
    if (isTypecodeSDKImport(imported.moduleSpecifier, program.fileName)) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      continue;
    }

    // First check if this import is from a transpiled npm package
    const transpiledInclude = resolveTranspiledModuleInclude(
      imported.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );
    
    if (transpiledInclude.isTranspiled) {
      includes.push(transpiledInclude.include);
      // Keep original symbol names for transpiled modules
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
    } else {
      // Fall back to libdef resolution
      const resolved = resolveImport(imported, options.libdefs, options.target, options.platformContext, program.fileName);
      includes.push(normalizeInclude(resolved.include));
      Object.assign(symbolMap, resolved.symbolMap);
    }
  }

  // Collect re-export includes for the header file
  const headerIncludes: string[] = [];
  for (const reExport of program.reExports) {
    // First try npm package resolution
    const transpiledInclude = resolveTranspiledModuleInclude(
      reExport.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );
    
    if (transpiledInclude.isTranspiled) {
      headerIncludes.push(transpiledInclude.include);
      continue;
    }
    
    // Handle relative re-exports within npm packages
    // e.g., export * from "./pins.js" in a package index file
    if (reExport.moduleSpecifier.startsWith(".")) {
      // Extract the module name from the relative path
      // Handle paths like "./pins.js", "./subdir/module.js"
      let modulePath = reExport.moduleSpecifier;
      // Remove .js/.mjs extensions
      modulePath = modulePath.replace(/\.js$/, "").replace(/\.mjs$/, "");
      // Get the last segment as the base name
      const segments = modulePath.split("/");
      const baseName = segments[segments.length - 1] || segments[segments.length - 2];
      const headerName = `${baseName}.h`;
      headerIncludes.push(`"${headerName}"`);
    }
  }

  // Set of original async function names — used to suppress their direct emission
  // and to filter them out of top-level setup() calls.
  const asyncFunctionOriginalNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => fn.originalName)
  );
  const asyncFunctionMappedNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => mapFunctionName(fn.originalName, options.target))
  );

  const mappedFunctions = program.functions.map((fn) => ({
    name: mapFunctionName(fn.originalName, options.target),
    returnType: mapReturnType(mapFunctionName(fn.originalName, options.target), fn.returnType, options.target),
    sourceSpan: fn.sourceSpan,
    leadingComments: fn.leadingComments,
    trailingComments: fn.trailingComments,
    parameters: fn.parameters,
    isAsync: fn.isAsync,
    statements: fn.statements.map((stmt) => {
      if (stmt.kind === "call") {
        return {
          ...stmt,
          callee: applySymbolMap(stmt.callee, symbolMap),
        };
      }

      return stmt;
    }),
  }));

  const knownFunctionReturnTypes = new Map<string, string>();
  for (const fn of mappedFunctions) {
    knownFunctionReturnTypes.set(fn.name, fn.returnType);
  }
  for (const fn of program.functions) {
    knownFunctionReturnTypes.set(fn.originalName, mapReturnType(mapFunctionName(fn.originalName, options.target), fn.returnType, options.target));
  }

  // Pre-build state machine class strings for every async function.
  // These are emitted into the source file after the polyfill runtime definitions.
  const asyncTaskClasses: { classDef: string; instanceDecl: string; taskVarName: string }[] = [];
  if (hasAsyncRuntime) {
    for (const fn of program.functions) {
      if (fn.isAsync) {
        const task = generateAsyncTaskClass(
          fn.originalName,
          fn.statements,
          options.target ?? "generic",
          knownFunctionReturnTypes,
        );
        asyncTaskClasses.push({ ...task, taskVarName: `${fn.originalName}Task` });
      }
    }
  }

  const headerLines: string[] = ["#pragma once", ""];
  const sourceLines: string[] = [];
  const sourceMapEntries: SourceMapEntry[] = [];
  const headerMapEntries: SourceMapEntry[] = [];

  function appendSourceLine(line: string, entry?: { tsSpan: ProgramIR["functions"][number]["sourceSpan"]; nodeKind: string; symbolName?: string }): void {
    sourceLines.push(line);
    if (!entry) {
      return;
    }

    const generatedLine = sourceLines.length;
    sourceMapEntries.push({
      generatedStartLine: generatedLine,
      generatedStartColumn: 1,
      generatedEndLine: generatedLine,
      generatedEndColumn: Math.max(1, line.length + 1),
      tsSpan: entry.tsSpan,
      nodeKind: entry.nodeKind,
      symbolName: entry.symbolName,
    });
  }

  function appendHeaderLine(line: string, entry?: { tsSpan: ProgramIR["functions"][number]["sourceSpan"]; nodeKind: string; symbolName?: string }): void {
    headerLines.push(line);
    if (!entry) {
      return;
    }

    const generatedLine = headerLines.length;
    headerMapEntries.push({
      generatedStartLine: generatedLine,
      generatedStartColumn: 1,
      generatedEndLine: generatedLine,
      generatedEndColumn: Math.max(1, line.length + 1),
      tsSpan: entry.tsSpan,
      nodeKind: entry.nodeKind,
      symbolName: entry.symbolName,
    });
  }

  function appendRenderedStatement(statement: StatementIR, indent: string, pointerVarTypes?: Map<string, string>): void {
    emitCommentLines(statement.leadingComments, indent, (line) => appendSourceLine(line));

    if (statement.kind === "while") {
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target, pointerVarTypes, undefined, knownFunctionReturnTypes)}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "if") {
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target, undefined, undefined, knownFunctionReturnTypes)}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const nested of statement.thenBranch) {
        appendRenderedStatement(nested, `${indent}  `);
      }
      appendSourceLine(`${indent}}`);
      
      if (statement.elseBranch && statement.elseBranch.length > 0) {
        appendSourceLine(`${indent}else {`);
        for (const nested of statement.elseBranch) {
          appendRenderedStatement(nested, `${indent}  `);
        }
        appendSourceLine(`${indent}}`);
      }
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "for") {
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target, undefined, undefined, knownFunctionReturnTypes)}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "for_of") {
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target, undefined, undefined, knownFunctionReturnTypes)}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "for_in") {
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target, undefined, undefined, knownFunctionReturnTypes)}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "do_while") {
      appendSourceLine(`${indent}do`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `);
      }
      appendSourceLine(`${indent}} while (${renderExpression(statement.condition, undefined, options.target)});`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "switch") {
      appendSourceLine(`${indent}switch (${renderExpression(statement.expression, undefined, options.target)})`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const caseClause of statement.cases) {
        emitCommentLines(caseClause.leadingComments, `${indent}  `, (line) => appendSourceLine(line));
        if (caseClause.value !== undefined) {
          appendSourceLine(`${indent}  case ${renderExpression(caseClause.value, undefined, options.target)}:`);
        } else {
          appendSourceLine(`${indent}  default:`);
        }
        for (const nested of caseClause.body) {
          appendRenderedStatement(nested, `${indent}    `);
        }
        emitCommentLines(caseClause.trailingComments, `${indent}  `, (line) => appendSourceLine(line));
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "try") {
      appendSourceLine(`${indent}try`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const nested of statement.tryBlock) {
        appendRenderedStatement(nested, `${indent}  `);
      }
      appendSourceLine(`${indent}}`);
      
      if (statement.catchBlock) {
        const catchParam = statement.catchParam ?? "e";
        appendSourceLine(`${indent}catch (const std::exception& ${catchParam})`);
        appendSourceLine(`${indent}{`);
        for (const nested of statement.catchBlock) {
          appendRenderedStatement(nested, `${indent}  `);
        }
        appendSourceLine(`${indent}}`);
      }
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "throw") {
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target, undefined, undefined, knownFunctionReturnTypes)}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    appendSourceLine(`${indent}${renderStatement(statement, false, options.target, pointerVarTypes, fixPointerFieldAccess, knownFunctionReturnTypes)}`, {
      tsSpan: statement.sourceSpan,
      nodeKind: statement.kind,
    });
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
  }

  if (effectiveEmitMode === "split") {
    appendSourceLine(`#include \"${baseName}.h\"`);
  }

  if (effectiveEmitMode === "split" && program.classes.length > 0) {
    for (const classDef of program.classes) {
      appendHeaderLine(`class ${classDef.name};`);
    }
    appendHeaderLine("");
  }

  // Add iostream for generic C++ when console calls are used
  if (options.target !== "arduino" && hasConsoleCalls(program)) {
    includes.push("<iostream>");
  }

  const declaredTypes = collectDeclaredTypes(program);
  const usesVectorTypes = declaredTypes.some((typeName) => typeName.includes("std::vector<")) || hasArrayInObjectLiteral(program);
  // For Arduino AVR, std::string is not available - skip the include
  if (declaredTypes.some((typeName) => typeName.includes("std::string")) && options.target !== "arduino") {
    includes.push("<string>");
  }
  if (options.target !== "arduino" && declaredTypes.some((typeName) => typeName.includes("std::vector<"))) {
    includes.push("<vector>");
  }
  if (options.target !== "arduino" && hasArrayInObjectLiteral(program)) {
    includes.push("<vector>");
  }
  if (declaredTypes
    .map((typeName) => normalizeCppTypeForTarget(typeName, options.target))
    .some((typeName) => typeName.includes("std::function<"))) {
    includes.push("<functional>");
  }
  if (hasThrowStatements(program) && options.target !== "arduino") {
    includes.push("<stdexcept>");
  }
  if (hasStdMathCalls(program)) {
    includes.push(options.target === "arduino" ? "<math.h>" : "<cmath>");
  }
  if (emittedPolyfills) {
    includes.push(...emittedPolyfills.includes.map((include) => normalizeInclude(include)));
  }

  for (const include of dedupe(includes)) {
    appendSourceLine(`#include ${include}`);
  }

  appendSourceLine("");

  const boilerplate = renderBoilerplate(program);
  if (boilerplate) {
    appendSourceLine(boilerplate.trimEnd());
    appendSourceLine("");
  }

  if (emittedPolyfills) {
    if (emittedPolyfills.declarations.length > 0) {
      for (const declaration of emittedPolyfills.declarations) {
        appendSourceLine(declaration);
      }
      appendSourceLine("");
    }

    if (emittedPolyfills.definitions.length > 0) {
      for (const definition of emittedPolyfills.definitions) {
        appendSourceLine(definition.trimEnd());
        appendSourceLine("");
      }
    }
  }

  // Emit async state-machine class + instance declarations (one per async function).
  // These must appear after the polyfill runtime (MicrotaskQueue, Promise) and
  // before setup()/loop() so that loop() can call taskVar.run().
  if (asyncTaskClasses.length > 0) {
    for (const { classDef, instanceDecl } of asyncTaskClasses) {
      for (const line of classDef.split("\n")) {
        appendSourceLine(line);
      }
      appendSourceLine("");
      appendSourceLine(instanceDecl);
      appendSourceLine("");
    }
  }

  if (options.target !== "arduino" && hasConsoleCalls(program) && usesVectorTypes) {
    appendSourceLine("template <typename T>");
    appendSourceLine("std::ostream& operator<<(std::ostream& os, const std::vector<T>& values)");
    appendSourceLine("{");
    appendSourceLine("  os << \"[\";");
    appendSourceLine("  for (size_t i = 0; i < values.size(); ++i)");
    appendSourceLine("  {");
    appendSourceLine("    if (i > 0)");
    appendSourceLine("    {");
    appendSourceLine("      os << \", \";");
    appendSourceLine("    }");
    appendSourceLine("    os << values[i];");
    appendSourceLine("  }");
    appendSourceLine("  os << \"]\";");
    appendSourceLine("  return os;");
    appendSourceLine("}");
    appendSourceLine("");
  }

  if (shimLines.length > 0) {
    for (const line of shimLines) {
      appendSourceLine(line);
    }
    appendSourceLine("");
  }

  // Arduino reserved names that conflict with macros/globals predefined by the framework.
  // Names predefined by the Arduino / ESP32 framework as macros, static consts, or globals.
  // Emitting C++ declarations with these names would cause redeclaration / macro-expansion errors.
  const arduinoReservedNames = new Set([
    // Standard Arduino digital/analog pin-mode macros (all platforms)
    "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "RISING", "FALLING", "CHANGE",
    // ESP32-specific pin-mode macros (esp32-hal-gpio.h)
    "INPUT_PULLDOWN", "OUTPUT_OPEN_DRAIN", "ANALOG",
    // Bus pin aliases (all platforms)
    "SDA", "SCL", "SS", "MOSI", "MISO", "SCK",
    // UART pin aliases — predefined as static const uint8_t on most platforms
    "TX", "RX", "TX2", "RX2",
    // DAC channel aliases — predefined as static const uint8_t on ESP32
    "DAC1", "DAC2",
    // ADC channel aliases — predefined on all Arduino platforms
    "A0", "A1", "A2", "A3", "A4", "A5",
    // Predefined HardwareSerial globals
    "Serial", "Serial2",
    // Arduino.h analog reference macros (defined in hardware/arduino/avr/cores/arduino/Arduino.h)
    "DEFAULT", "INTERNAL", "EXTERNAL",
    // CMSIS / device-header macros — SAMD21 defines RTC as a hardware-register pointer macro;
    // emitting a variable or enum member named RTC causes expansion errors on that target.
    "RTC",
  ]);

  // Build set of compile-time (non-runtime) declared top-level variable names.
  // Used below when emitting struct initializers to zero-initialize forward-referenced
  // or suppressed runtime variables (like pin constants D0, D1, TX2 etc.).
  const compiletimeVarNames = new Set<string>(
    program.topLevelStatements
      .filter((stmt) => stmt.kind === "var_decl" && !statementRequiresRuntime(stmt))
      .map((stmt) => (stmt as { name: string }).name)
  );

  // Separate compile-time declarations from runtime statements
  // Compile-time declarations (literals, simple identifiers, static arrays) can go at global scope
  // Runtime statements (method calls, new expressions, etc.) must go in setup()/main()
  const topLevelDeclarations = program.topLevelStatements.filter(
    (item) => !statementRequiresRuntime(item)
  );
  // Filter out Arduino reserved names for Arduino target
  const filteredTopLevelDeclarations = options.target === "arduino"
    ? topLevelDeclarations.filter((item) => {
        if (item.kind === "var_decl") {
          return !arduinoReservedNames.has(item.name);
        }
        return true;
      })
    : topLevelDeclarations;
  const topLevelExecutables = program.topLevelStatements.filter(
    (item) => statementRequiresRuntime(item)
  );
  // Also suppress runtime var_decl statements whose names clash with
  // Arduino framework predefined symbols (e.g. A0, Serial).
  const filteredTopLevelExecutables_presuppress = options.target === "arduino"
    ? topLevelExecutables.filter((item) => {
        if (item.kind === "var_decl") {
          return !arduinoReservedNames.has(item.name);
        }
        return true;
      })
    : topLevelExecutables;

  const entrypointFunctionName = options.target === "arduino" ? "setup" : "main";
  const entrypointCallNames = new Set<string>([entrypointFunctionName]);
  for (const fn of program.functions) {
    if (mapFunctionName(fn.originalName, options.target) === entrypointFunctionName) {
      entrypointCallNames.add(fn.originalName);
      entrypointCallNames.add(applySymbolMap(fn.originalName, symbolMap));
    }
  }

  const filteredTopLevelExecutables = filteredTopLevelExecutables_presuppress.filter((statement) => {
    if (statement.kind !== "call") {
      return true;
    }

    const mappedCallee = applySymbolMap(statement.callee, symbolMap);
    // Filter out calls to entrypoint functions (setup/main) and async functions.
    // Async function calls are replaced by cooperative task instances driven in loop().
    if (!entrypointCallNames.has(statement.callee) && !entrypointCallNames.has(mappedCallee)) {
      return !asyncFunctionOriginalNames.has(statement.callee) && !asyncFunctionMappedNames.has(statement.callee);
    }
    return false;
  });

  const emittedTopLevelStatements = isEntryFile
    ? filteredTopLevelDeclarations
    : [
        ...filteredTopLevelDeclarations,
        ...filteredTopLevelExecutables.filter((statement) => statement.kind === "var_decl"),
      ];

  const knownTopLevelObjectTypes = new Map<string, string>();
  const knownTopLevelObjectFields = new Map<string, Map<string, string>>();

  // Collect pointer variable types from all executable statements
  const allExecutableStatements: StatementIR[] = [...filteredTopLevelExecutables];
  for (const fn of mappedFunctions) {
    allExecutableStatements.push(...fn.statements);
  }
  const globalPointerVarTypes = collectPointerVarTypes(allExecutableStatements);

  // Collect struct field types that are pointers - needed for correct -> access
  const pointerStructFields = new Set<string>();
  for (const stmt of allExecutableStatements) {
    if (stmt.kind === "var_decl" && stmt.initializer?.kind === "object") {
      const structName = stmt.name;
      for (const field of stmt.initializer.fields) {
        const fieldType = inferObjectFieldType(field.value, globalPointerVarTypes, knownFunctionReturnTypes);
        if (fieldType.endsWith("*")) {
          pointerStructFields.add(`${structName}.${field.name}`);
        }
      }
    }
  }

  /**
   * Transform method calls on pointer struct fields from '.' to '->'
   * e.g., "Board.A0.read()" -> "Board.A0->read()" when A0 is a pointer field
   */
  function fixPointerFieldAccess(callee: string): string {
    for (const pointerField of pointerStructFields) {
      // Match patterns like "Board.A0.method" and transform to "Board.A0->method"
      const pattern = new RegExp(`(^|[^>])${pointerField.replace(".", "\\.")}\\.`, "g");
      callee = callee.replace(pattern, `$1${pointerField}->`);
    }
    return callee;
  }

  // For Arduino: merge top-level executables into setup() function
  // For generic C++: wrap top-level executables in main() function
  if (isEntryFile && filteredTopLevelExecutables.length > 0) {
    if (options.target === "arduino") {
      // Find setup function and prepend top-level executables
      const setupFn = mappedFunctions.find(fn => fn.name === "setup");
      if (setupFn) {
        setupFn.statements = [...filteredTopLevelExecutables, ...setupFn.statements];
      } else {
        // Create setup function with top-level executables
        mappedFunctions.unshift({
          name: "setup",
          returnType: "void",
          sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          leadingComments: ["// Auto-generated setup() for top-level statements"],
          trailingComments: undefined,
          parameters: [],
          isAsync: false,
          statements: filteredTopLevelExecutables,
        });
      }
    } else {
      // Generic C++: wrap in main() function
      const existingMain = mappedFunctions.find(fn => fn.name === "main");
      if (existingMain) {
        // Prepend top-level executables to existing main()
        existingMain.statements = [...filteredTopLevelExecutables, ...existingMain.statements];
      } else {
        // Create main() function with top-level executables
        mappedFunctions.push({
          name: "main",
          returnType: "int",
          sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          leadingComments: ["// Auto-generated main() for top-level statements"],
          trailingComments: undefined,
          parameters: [],
          isAsync: false,
          statements: [...filteredTopLevelExecutables, { kind: "return", sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number", value: 0 } }],
        });
      }
    }
  }

  // Arduino requires a loop() function even if empty
  // Only generate for entry files, not for npm package modules
  if (isEntryFile && options.target === "arduino" && !mappedFunctions.some((fn) => fn.name === "loop")) {
    mappedFunctions.push({
      name: "loop",
      returnType: "void",
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: hasAsyncRuntime ? ["// Auto-generated loop() for async microtask pumping"] : undefined,
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      statements: [],
    });
  }

  // Only generate main() for entry files, not for npm package modules
  if (isEntryFile && hasAsyncRuntime && options.target !== "arduino" && !mappedFunctions.some((fn) => fn.name === "main")) {
    mappedFunctions.push({
      name: "main",
      returnType: "int",
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: ["// Auto-generated main() for async microtask pumping"],
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      statements: [{ kind: "return", sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number", value: 0 } }],
    });
  }

  // Enum class names that are already declared as C typedefs in the new Arduino API
  // (arduino:samd, arduino:mbed_*, arduino:nrf52, etc. include api/Common.h which
  // declares `PinMode` and `PinStatus` as C-style enum typedefs).  Redefining them
  // as `enum class` causes a "using typedef-name after 'enum'" compiler error.
  // Guard them so they are only emitted when the new API is NOT present.
  const arduinoNewApiReservedEnums = new Set(["PinMode", "InterruptMode"]);

  // Emit enums
  for (const enumDef of program.enums) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(enumDef.leadingComments, "", (line) => appendLine(line));
    const enumKeyword = enumDef.isConst ? "enum class" : "enum class";
    // On AVR, `int` is 16-bit (max 32767). Add an explicit `long` underlying
    // type for enums that contain values outside the 16-bit signed int range.
    const needsLongUnderlying = options.target === "arduino" &&
      enumDef.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768));
    const underlyingType = needsLongUnderlying ? " : long" : "";
    // For Arduino targets: guard enum classes that conflict with the new Arduino API typedef
    // declarations (ARDUINO_API_VERSION is defined by api/ArduinoAPI.h on SAMD, nRF52, etc.).
    const needsApiGuard = options.target === "arduino" && arduinoNewApiReservedEnums.has(enumDef.name);
    if (needsApiGuard) {
      appendLine(`#if !defined(ARDUINO_API_VERSION)`);
    }
    appendLine(`${enumKeyword} ${enumDef.name}${underlyingType} {`);
    for (let i = 0; i < enumDef.members.length; i++) {
      const member = enumDef.members[i];
      const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
      const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
      // Prefix reserved names with underscore for Arduino compatibility
      const memberName = (options.target === "arduino" && arduinoReservedNames.has(member.name)) 
        ? `_${member.name}` 
        : member.name;
      appendLine(`  ${memberName}${valueSuffix}${commaSuffix}`);
    }
    appendLine("};");
    if (needsApiGuard) {
      appendLine(`#endif // !defined(ARDUINO_API_VERSION)`);
    }
    emitCommentLines(enumDef.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit type aliases
  for (const typeAlias of program.typeAliases) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(typeAlias.leadingComments, "", (line) => appendLine(line));
    // Skip type aliases with 'auto' as it's not valid in C++ type aliases
    // Also skip for Arduino if the type uses std::string (not available on AVR)
    const cppType = normalizeCppTypeForTarget(typeAlias.cppType, options.target);
    if (cppType === "auto") {
      continue; // Skip invalid 'auto' type aliases
    }
    if (options.target === "arduino" && cppType.includes("std::string")) {
      continue; // Skip std::string type aliases for Arduino
    }
    appendLine(`using ${typeAlias.name} = ${cppType};`);
    emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit classes
  for (const classDef of program.classes) {
    emitCommentLines(classDef.leadingComments, "", (line) => appendSourceLine(line));
    const inheritanceClause = classDef.extendsClass ? ` : public ${classDef.extendsClass}` : "";
    appendSourceLine(`class ${classDef.name}${inheritanceClause} {`);
    
    // Group fields by visibility
    const publicFields = classDef.fields.filter(f => f.visibility === "public");
    const privateFields = classDef.fields.filter(f => f.visibility === "private");
    const protectedFields = classDef.fields.filter(f => f.visibility === "protected");
    
    const publicMethods = classDef.methods.filter(m => m.visibility === "public");
    const privateMethods = classDef.methods.filter(m => m.visibility === "private");
    const protectedMethods = classDef.methods.filter(m => m.visibility === "protected");
    
    // Emit public section
    if (publicFields.length > 0 || publicMethods.length > 0 || classDef.constructor) {
      appendSourceLine("public:");
      
      // Constructor
      if (classDef.constructor) {
        // For Arduino, replace std::string with const char* in constructor params
        const arduinoParams = options.target === "arduino"
          ? classDef.constructor.parameters.map(p => ({
              ...p,
              cppType: normalizeCppTypeForTarget(p.cppType, options.target)
            }))
          : classDef.constructor.parameters;
        const ctorParams = renderParameters(arduinoParams, options.target);
        let ctorInitializer = "";
        let ctorStatements = classDef.constructor.statements;
        const firstCtorStatement = ctorStatements[0];
        if (classDef.extendsClass && firstCtorStatement && firstCtorStatement.kind === "call" && firstCtorStatement.callee === "super") {
          const baseArgs = firstCtorStatement.args.map((arg) => renderExpression(arg, fixPointerFieldAccess, options.target)).join(", ");
          ctorInitializer = ` : ${classDef.extendsClass}(${baseArgs})`;
          ctorStatements = ctorStatements.slice(1);
        }

        appendSourceLine(`  ${classDef.name}(${ctorParams})${ctorInitializer} {`);
        for (const stmt of ctorStatements) {
          appendRenderedStatement(stmt, "    ");
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      
      // Public fields
      for (const field of publicFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, options.target)}` : "";
        // Replace 'auto' with 'int' for class members (auto is not valid for class members in C++)
        // Also replace std::string with const char* for Arduino (no std::string on AVR)
        const fieldType = options.target === "arduino" && field.name === "_interruptHandler" && normalizeCppTypeForTarget(field.cppType, options.target) === "int"
          ? "void (*)(void)"
          : field.cppType;
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, options.target)}${initSuffix};`);
      }
      if (publicFields.length > 0) {
        appendSourceLine("");
      }
      
      // Public methods
      for (const method of publicMethods) {
        const methodParams = renderParameters(method.parameters, options.target);
        const staticPrefix = method.isStatic ? "static " : "";
        // Replace 'auto' return type with 'int' for C++ (auto return requires trailing return type or deduction)
        const returnType = normalizeCppTypeForTarget(method.returnType, options.target);
        appendSourceLine(`  ${staticPrefix}${returnType} ${method.name}(${methodParams}) {`);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ");
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }
    
    // Emit private section
    if (privateFields.length > 0 || privateMethods.length > 0) {
      appendSourceLine("private:");
      for (const field of privateFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, options.target)}` : "";
        // Replace 'auto' with 'int' for class members (auto is not valid for class members in C++)
        // Also replace std::string with const char* for Arduino (no std::string on AVR)
        const fieldType = options.target === "arduino" && field.name === "_interruptHandler" && normalizeCppTypeForTarget(field.cppType, options.target) === "int"
          ? "void (*)(void)"
          : field.cppType;
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, options.target)}${initSuffix};`);
      }
      if (privateFields.length > 0) {
        appendSourceLine("");
      }
      for (const method of privateMethods) {
        const methodParams = renderParameters(method.parameters, options.target);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(`  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType, options.target)} ${method.name}(${methodParams}) {`);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ");
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }
    
    // Emit protected section
    if (protectedFields.length > 0 || protectedMethods.length > 0) {
      appendSourceLine("protected:");
      for (const field of protectedFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, options.target)}` : "";
        const fieldType = options.target === "arduino" && field.name === "_interruptHandler" && normalizeCppTypeForTarget(field.cppType, options.target) === "int"
          ? "void (*)(void)"
          : field.cppType;
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, options.target)}${initSuffix};`);
      }
      if (protectedFields.length > 0) {
        appendSourceLine("");
      }
      for (const method of protectedMethods) {
        const methodParams = renderParameters(method.parameters, options.target);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(`  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType, options.target)} ${method.name}(${methodParams}) {`);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ");
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }
    
    appendSourceLine("};");
    emitCommentLines(classDef.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  for (const statement of emittedTopLevelStatements) {
    if (
      effectiveEmitMode === "split" &&
      statement.kind === "var_decl" &&
      statement.initializer?.kind === "object"
    ) {
      const structName = `_${statement.name}_t`;
      const fieldTypeEntries = statement.initializer.fields.map((field) => {
        const inferred = inferObjectFieldType(
          field.value,
          globalPointerVarTypes,
          knownFunctionReturnTypes,
          knownTopLevelObjectTypes,
          knownTopLevelObjectFields,
        );
        return [field.name, inferred] as const;
      });
      const fieldDefs = fieldTypeEntries
        .map(([fieldName, inferredType]) => {
          // Rename struct fields that match Arduino reserved macro/global names to avoid
          // preprocessor expansion inside struct definitions (e.g. TX2 → (gpio_num_t)25).
          const safeFieldName =
            options.target === "arduino" && arduinoReservedNames.has(fieldName)
              ? `_${fieldName}`
              : fieldName;
          return `${inferredType} ${safeFieldName};`;
        })
        .join(" ");
      const initValues = statement.initializer.fields
        .map((field) => {
          if (options.target === "arduino" && field.value.kind === "object") {
            return "0";
          }
          // For Arduino target: zero-initialize identifier references to non-compile-time
          // variables. These are either runtime-evaluated (declared later in the merged
          // .ino, so not yet in scope) or suppressed by arduinoReservedNames.
          // compile-time constants like YES/NO/true/false are kept as-is.
          if (options.target === "arduino" && field.value.kind === "identifier") {
            const identName = field.value.value;
            if (!compiletimeVarNames.has(identName)) {
              return "0";
            }
          }
          return renderExpression(field.value, fixPointerFieldAccess, options.target);
        })
        .join(", ");

      knownTopLevelObjectTypes.set(statement.name, structName);
      knownTopLevelObjectFields.set(statement.name, new Map(fieldTypeEntries));

      emitCommentLines(statement.leadingComments, "", (line) => appendHeaderLine(line));
      appendHeaderLine(`struct ${structName} { ${fieldDefs} };`);
      appendHeaderLine(`extern ${structName} ${statement.name};`);
      emitCommentLines(statement.trailingComments, "", (line) => appendHeaderLine(line));

      emitCommentLines(statement.leadingComments, "", (line) => appendSourceLine(line));
      appendSourceLine(`${structName} ${statement.name} = { ${initValues} };`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      emitCommentLines(statement.trailingComments, "", (line) => appendSourceLine(line));
      continue;
    }

    appendRenderedStatement(statement, "");
  }
  if (emittedTopLevelStatements.length > 0) {
    appendSourceLine("");
  }

  for (const fn of mappedFunctions) {
    const parameterList = renderParameters(fn.parameters, options.target);
    if (effectiveEmitMode === "split") {
      emitCommentLines(fn.leadingComments, "", (line) => appendHeaderLine(line));
      appendHeaderLine(`${normalizeCppTypeForTarget(fn.returnType, options.target)} ${fn.name}(${parameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
      emitCommentLines(fn.trailingComments, "", (line) => appendHeaderLine(line));
    }

    emitCommentLines(fn.leadingComments, "", (line) => appendSourceLine(line));
    appendSourceLine(`${normalizeCppTypeForTarget(fn.returnType, options.target)} ${fn.name}(${parameterList})`, {
      tsSpan: fn.sourceSpan,
      nodeKind: "function_definition",
      symbolName: fn.name,
    });
    appendSourceLine("{");
    if (hasPromiseRuntime && ((options.target === "arduino" && fn.name === "loop") || (options.target !== "arduino" && fn.name === "main"))) {
      appendSourceLine("  ts2cpp_pump_microtasks();");
    }
    // Async tasks are driven by their state machine in loop(); don't emit the blocking body.
    if (fn.isAsync && hasAsyncRuntime) {
      appendSourceLine(`  // driven as cooperative task in loop()`);
    } else {
      for (const statement of fn.statements) {
        appendRenderedStatement(statement, "  ", globalPointerVarTypes);
      }
    }
    if (hasAsyncRuntime && options.target === "arduino" && fn.name === "loop") {
      // Drive all async state machines
      for (const { taskVarName } of asyncTaskClasses) {
        appendSourceLine(`  ${taskVarName}.run();`);
      }
      // Pump microtasks only when the Promise runtime is available
      if (hasPromiseRuntime) {
        appendSourceLine("  ts2cpp_pump_microtasks();");
      }
    }
    appendSourceLine("}");
    emitCommentLines(fn.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  let outputHeaderPath: string | undefined;
  let outputHeaderMapPath: string | undefined;
  if (effectiveEmitMode === "split") {
    // Add re-export includes to the header
    const finalHeaderLines = [...headerLines];
    const headerIncludeLines = dedupe([
      ...includes,
      ...headerIncludes,
    ]);
    if (headerIncludeLines.length > 0) {
      // Insert includes after #pragma once
      const includeLines = headerIncludeLines.map((inc) => `#include ${inc}`);
      finalHeaderLines.splice(1, 0, ...includeLines, "");
    }
    writeText(headerPath, finalHeaderLines.join("\n").trimEnd() + "\n");
    outputHeaderPath = headerPath;
    if (options.emitMaps) {
      outputHeaderMapPath = writeSourceMap(makeGeneratedMap(headerPath, program.fileName, headerMapEntries));
    }
  }

  writeText(sourcePath, sourceLines.join("\n").trimEnd() + "\n");
  const outputSourceMapPath = options.emitMaps
    ? writeSourceMap(makeGeneratedMap(sourcePath, program.fileName, sourceMapEntries))
    : undefined;

  const diagnostics: Diagnostic[] = [...program.diagnostics, ...profileDiagnostics];
  if (options.target === "arduino" && options.emitMode === "split") {
    diagnostics.push({
      severity: "info",
      code: "TS2CPP_ARDUINO_SPLIT_IGNORED",
      message: "Arduino target emits a single .ino sketch file; split header/source mode was ignored.",
    });
  }
  return {
    headerPath: outputHeaderPath,
    sourcePath,
    headerMapPath: outputHeaderMapPath,
    sourceMapPath: outputSourceMapPath,
    diagnostics,
  };
}
