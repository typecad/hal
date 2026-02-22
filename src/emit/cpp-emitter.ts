import path from "node:path";
import { ProgramIR, ExpressionIR, StatementIR } from "../ir/model";
import { Diagnostic, EmitMode, GeneratedOutputs, PlatformContext, SourceMapEntry, TargetProfile } from "../types";
import { ensureDir, writeText } from "../utils/fs";
import { resolveImport } from "../libdef/registry";
import { LibraryDefinition } from "../types";
import { makeGeneratedMap, writeSourceMap } from "../mapping/source-map";
import { resolveArduinoProfile } from "../platform/arduino-profile";
import { RuntimePolyfillIR } from "../polyfill/types";
import { emitPolyfillBoilerplate } from "../polyfill/emitter";

interface EmitterOptions {
  outDir: string;
  emitMode: EmitMode;
  target: TargetProfile;
  libdefs: Map<string, LibraryDefinition>;
  emitMaps: boolean;
  platformContext?: PlatformContext;
  polyfills?: RuntimePolyfillIR[];
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

function renderExpression(expr: ExpressionIR, exprTransformer?: (expr: string) => string): string {
  switch (expr.kind) {
    case "number":
      return `${expr.value}`;
    case "string":
      return `"${expr.value.replace(/"/g, '\\"')}"`;
    case "boolean":
      return expr.value ? "true" : "false";
    case "identifier":
      return expr.value;
    case "raw":
      // Apply transformation to raw expressions (for fixing pointer field access)
      if (exprTransformer) {
        return exprTransformer(expr.value);
      }
      return expr.value;
    case "await":
      return renderExpression(expr.value);
    case "ternary":
      return `(${renderExpression(expr.condition)} ? ${renderExpression(expr.whenTrue)} : ${renderExpression(expr.whenFalse)})`;
    case "array":
      const elements = expr.elements.map((e) => renderExpression(e)).join(", ");
      return `{ ${elements} }`;
    case "object":
      const fields = expr.fields.map((f) => `.${f.name} = ${renderExpression(f.value)}`).join(", ");
      return `{ ${fields} }`;
    case "instanceof":
      // C++ doesn't have native instanceof - use dynamic_cast with RTTI
      // Note: This assumes the object is a pointer (from 'new'). For non-pointer objects,
      // the behavior may differ. Full type tracking would be needed for correct handling.
      return `(dynamic_cast<const ${expr.className}*>(${renderExpression(expr.object)}) != nullptr)`;
    case "spread_array":
      // Spread arrays need to be handled in variable declaration context
      // For expression context, emit a comment warning
      return `/* spread_array: see variable declaration */`;
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

function mapReturnType(functionName: string, returnType: string, target: TargetProfile): string {
  if (target === "arduino" && (functionName === "setup" || functionName === "loop")) {
    return "void";
  }

  if (functionName === "setup" || functionName === "loop") {
    return "void";
  }

  return returnType;
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

function inferObjectFieldType(value: ExpressionIR, pointerVarTypes?: Map<string, string>): string {
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
    // Check if this identifier is a known pointer variable
    if (pointerVarTypes && pointerVarTypes.has(value.value)) {
      return pointerVarTypes.get(value.value)!;
    }
    return "int";
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

/**
 * Scan program IR for console.* calls
 */
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

function renderParameters(parameters: Array<{ name: string; cppType: string; defaultValue?: any }>): string {
  if (parameters.length === 0) {
    return "";
  }

  return parameters
    .map((parameter) => {
      const type = parameter.cppType === "auto" ? "int" : parameter.cppType;
      let result = `${type} ${parameter.name}`;
      if (parameter.defaultValue) {
        result += ` = ${renderExpression(parameter.defaultValue)}`;
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
  const renderedArgs = args.map((arg) => renderExpression(arg)).join(", ");
  
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

function renderStatement(statement: StatementIR, forHeader: boolean = false, target: TargetProfile = "generic", pointerVarTypes?: Map<string, string>, calleeTransformer?: (callee: string) => string): string {
  if (statement.kind === "call") {
    // Handle console.* calls specially
    if (isConsoleCall(statement.callee)) {
      return transformConsoleCall(statement.callee, statement.args, target, forHeader);
    }
    let callee = statement.callee;
    if (calleeTransformer) {
      callee = calleeTransformer(callee);
    }
    const renderedArgs = statement.args.map((arg) => renderExpression(arg)).join(", ");
    return forHeader ? `${callee}(${renderedArgs})` : `${callee}(${renderedArgs});`;
  }

  if (statement.kind === "assign") {
    return forHeader 
      ? `${statement.target} ${statement.operator} ${renderExpression(statement.value)}`
      : `${statement.target} ${statement.operator} ${renderExpression(statement.value)};`;
  }

  if (statement.kind === "update") {
    return statement.prefix
      ? `${statement.operator}${statement.target}${forHeader ? "" : ";"}`
      : `${statement.target}${statement.operator}${forHeader ? "" : ";"}`;
  }

  if (statement.kind === "return") {
    return statement.value ? `return ${renderExpression(statement.value)};` : "return;";
  }

  if (statement.kind === "while") {
    return `while (${renderExpression(statement.condition)})`;
  }

  if (statement.kind === "if") {
    return `if (${renderExpression(statement.condition)})`;
  }

  if (statement.kind === "for") {
    const init = statement.initializer ? renderStatement(statement.initializer, true) : "";
    const cond = statement.condition ? renderExpression(statement.condition) : "";
    const incr = statement.increment ? renderStatement(statement.increment, true) : "";
    return `for (${init}; ${cond}; ${incr})`;
  }

  if (statement.kind === "for_of") {
    const varDecl = statement.variable;
    if (varDecl.kind === "var_decl") {
      const prefix = varDecl.storage === "const" ? `const ${varDecl.cppType}` : varDecl.cppType;
      const varName = varDecl.name;
      return `for (${prefix} ${varName} : ${renderExpression(statement.iterable)})`;
    }
    return `for (auto item : ${renderExpression(statement.iterable)})`;
  }

  if (statement.kind === "for_in") {
    // for...in iterates over object keys
    // In C++, we need to use a map iterator or similar pattern
    // For Arduino/embedded, emit a comment and a simplified iteration pattern
    const varDecl = statement.variable;
    if (varDecl.kind === "var_decl") {
      const prefix = varDecl.storage === "const" ? `const ${varDecl.cppType}` : varDecl.cppType;
      const varName = varDecl.name;
      // Use a key iteration pattern - the object should be a map-like structure
      return `for (${prefix} ${varName} : ${renderExpression(statement.object)})`;
    }
    return `for (auto key : ${renderExpression(statement.object)})`;
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
    return `switch (${renderExpression(statement.expression)})`;
  }

  if (statement.kind === "try") {
    return "try";
  }

  if (statement.kind === "throw") {
    return `throw ${renderExpression(statement.value)};`;
  }

  if (statement.kind !== "var_decl") {
    return "/* unsupported_statement */";
  }

  const declaredType = statement.cppType;
  const prefix = statement.storage === "const" ? `const ${declaredType}` : declaredType;
  if (statement.initializer) {
    // Handle array initializers
    if (statement.initializer.kind === "array") {
      const elements = statement.initializer.elements.map((e) => renderExpression(e)).join(", ");
      if (declaredType.startsWith("std::vector<")) {
        return forHeader
          ? `${prefix} ${statement.name} = { ${elements} }`
          : `${prefix} ${statement.name} = { ${elements} };`;
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
        .map((f) => `${inferObjectFieldType(f.value, pointerVarTypes)} ${f.name};`)
        .join(" ");
      const initValues = statement.initializer.fields
        .map((f) => `${renderExpression(f.value)}`)
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
      const spreadName = renderExpression(statement.initializer.spreadExpr);
      const additionalElements = statement.initializer.additionalElements.map(e => renderExpression(e)).join(", ");
      // Emit a comment indicating the spread behavior - for full support would need runtime helper
      return forHeader
        ? `${arrayType} ${statement.name}[] = { /* spread from ${spreadName} */ ${additionalElements} }`
        : `${arrayType} ${statement.name}[] = { /* spread from ${spreadName} */ ${additionalElements} };`;
    }
    return forHeader 
      ? `${prefix} ${statement.name} = ${renderExpression(statement.initializer, calleeTransformer)}`
      : `${prefix} ${statement.name} = ${renderExpression(statement.initializer, calleeTransformer)};`;
  }

  return forHeader ? `${prefix} ${statement.name}` : `${prefix} ${statement.name};`;
}

export function emitCpp(program: ProgramIR, options: EmitterOptions): GeneratedOutputs {
  ensureDir(options.outDir);

  const baseName = path.basename(program.fileName).replace(/\.[^.]+$/, "");
  const effectiveEmitMode: EmitMode = options.target === "arduino" ? "cpp" : options.emitMode;
  const sourceExtension = options.target === "arduino" ? "ino" : "cpp";
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

  if (options.target === "arduino") {
    const arduinoProfile = resolveArduinoProfile(program, options.platformContext);
    includes.push(...arduinoProfile.forcedIncludes);
    Object.assign(symbolMap, arduinoProfile.symbolAliases);
    shimLines = [...arduinoProfile.shimLines];
    profileDiagnostics = [...arduinoProfile.diagnostics];
  }

  for (const imported of program.imports) {
    const resolved = resolveImport(imported, options.libdefs, options.target, options.platformContext, program.fileName);
    includes.push(normalizeInclude(resolved.include));
    Object.assign(symbolMap, resolved.symbolMap);
  }

  const mappedFunctions = program.functions.map((fn) => ({
    name: mapFunctionName(fn.originalName, options.target),
    returnType: mapReturnType(mapFunctionName(fn.originalName, options.target), fn.returnType, options.target),
    sourceSpan: fn.sourceSpan,
    leadingComments: fn.leadingComments,
    trailingComments: fn.trailingComments,
    parameters: fn.parameters,
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
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target, pointerVarTypes)}`, {
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
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target)}`, {
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
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target)}`, {
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
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target)}`, {
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
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target)}`, {
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
      appendSourceLine(`${indent}} while (${renderExpression(statement.condition)});`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "switch") {
      appendSourceLine(`${indent}switch (${renderExpression(statement.expression)})`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const caseClause of statement.cases) {
        emitCommentLines(caseClause.leadingComments, `${indent}  `, (line) => appendSourceLine(line));
        if (caseClause.value !== undefined) {
          appendSourceLine(`${indent}  case ${renderExpression(caseClause.value)}:`);
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
      appendSourceLine(`${indent}${renderStatement(statement, false, options.target)}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    appendSourceLine(`${indent}${renderStatement(statement, false, options.target, pointerVarTypes, fixPointerFieldAccess)}`, {
      tsSpan: statement.sourceSpan,
      nodeKind: statement.kind,
    });
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
  }

  if (effectiveEmitMode === "split") {
    appendSourceLine(`#include \"${baseName}.h\"`);
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
  if (declaredTypes.some((typeName) => typeName.includes("std::vector<"))) {
    includes.push("<vector>");
  }
  if (hasArrayInObjectLiteral(program)) {
    includes.push("<vector>");
  }
  if (declaredTypes.some((typeName) => typeName.includes("std::function<"))) {
    includes.push("<functional>");
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

  // Arduino reserved names that conflict with macros
  const arduinoReservedNames = new Set(["HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP"]);

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

  const entrypointFunctionName = options.target === "arduino" ? "setup" : "main";
  const entrypointCallNames = new Set<string>([entrypointFunctionName]);
  for (const fn of program.functions) {
    if (mapFunctionName(fn.originalName, options.target) === entrypointFunctionName) {
      entrypointCallNames.add(fn.originalName);
      entrypointCallNames.add(applySymbolMap(fn.originalName, symbolMap));
    }
  }

  const filteredTopLevelExecutables = topLevelExecutables.filter((statement) => {
    if (statement.kind !== "call") {
      return true;
    }

    const mappedCallee = applySymbolMap(statement.callee, symbolMap);
    return !entrypointCallNames.has(statement.callee) && !entrypointCallNames.has(mappedCallee);
  });

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
        const fieldType = inferObjectFieldType(field.value, globalPointerVarTypes);
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
  if (filteredTopLevelExecutables.length > 0) {
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
          statements: [...filteredTopLevelExecutables, { kind: "return", sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number", value: 0 } }],
        });
      }
    }
  }

  // Arduino requires a loop() function even if empty
  if (options.target === "arduino" && !mappedFunctions.some((fn) => fn.name === "loop")) {
    mappedFunctions.push({
      name: "loop",
      returnType: "void",
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: hasAsyncRuntime ? ["// Auto-generated loop() for async microtask pumping"] : undefined,
      trailingComments: undefined,
      parameters: [],
      statements: [],
    });
  }

  if (hasAsyncRuntime && options.target !== "arduino" && !mappedFunctions.some((fn) => fn.name === "main")) {
    mappedFunctions.push({
      name: "main",
      returnType: "int",
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: ["// Auto-generated main() for async microtask pumping"],
      trailingComments: undefined,
      parameters: [],
      statements: [{ kind: "return", sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number", value: 0 } }],
    });
  }

  // Emit enums
  for (const enumDef of program.enums) {
    emitCommentLines(enumDef.leadingComments, "", (line) => appendSourceLine(line));
    const enumKeyword = enumDef.isConst ? "enum class" : "enum class";
    appendSourceLine(`${enumKeyword} ${enumDef.name} {`);
    for (let i = 0; i < enumDef.members.length; i++) {
      const member = enumDef.members[i];
      const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
      const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
      // Prefix reserved names with underscore for Arduino compatibility
      const memberName = (options.target === "arduino" && arduinoReservedNames.has(member.name)) 
        ? `_${member.name}` 
        : member.name;
      appendSourceLine(`  ${memberName}${valueSuffix}${commaSuffix}`);
    }
    appendSourceLine("};");
    emitCommentLines(enumDef.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  // Emit type aliases
  for (const typeAlias of program.typeAliases) {
    emitCommentLines(typeAlias.leadingComments, "", (line) => appendSourceLine(line));
    // Skip type aliases with 'auto' as it's not valid in C++ type aliases
    // Also skip for Arduino if the type uses std::string (not available on AVR)
    const cppType = typeAlias.cppType;
    if (cppType === "auto") {
      continue; // Skip invalid 'auto' type aliases
    }
    if (options.target === "arduino" && cppType.includes("std::string")) {
      continue; // Skip std::string type aliases for Arduino
    }
    appendSourceLine(`using ${typeAlias.name} = ${cppType};`);
    emitCommentLines(typeAlias.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  // Emit classes
  for (const classDef of program.classes) {
    emitCommentLines(classDef.leadingComments, "", (line) => appendSourceLine(line));
    appendSourceLine(`class ${classDef.name} {`);
    
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
              cppType: p.cppType === "std::string" ? "const char*" : p.cppType
            }))
          : classDef.constructor.parameters;
        const ctorParams = renderParameters(arduinoParams);
        appendSourceLine(`  ${classDef.name}(${ctorParams}) {`);
        for (const stmt of classDef.constructor.statements) {
          appendRenderedStatement(stmt, "    ");
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      
      // Public fields
      for (const field of publicFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer)}` : "";
        // Replace 'auto' with 'int' for class members (auto is not valid for class members in C++)
        // Also replace std::string with const char* for Arduino (no std::string on AVR)
        let cppType = field.cppType;
        if (cppType === "auto") {
          cppType = "int";
        } else if (options.target === "arduino" && cppType === "std::string") {
          cppType = "const char*";
        }
        appendSourceLine(`  ${cppType} ${field.name}${initSuffix};`);
      }
      if (publicFields.length > 0) {
        appendSourceLine("");
      }
      
      // Public methods
      for (const method of publicMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        // Replace 'auto' return type with 'int' for C++ (auto return requires trailing return type or deduction)
        let returnType = method.returnType;
        if (returnType === "auto") {
          returnType = "int";
        } else if (options.target === "arduino" && returnType === "std::string") {
          returnType = "const char*";
        }
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
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer)}` : "";
        // Replace 'auto' with 'int' for class members (auto is not valid for class members in C++)
        // Also replace std::string with const char* for Arduino (no std::string on AVR)
        let cppType = field.cppType;
        if (cppType === "auto") {
          cppType = "int";
        } else if (options.target === "arduino" && cppType === "std::string") {
          cppType = "const char*";
        }
        appendSourceLine(`  ${cppType} ${field.name}${initSuffix};`);
      }
      if (privateFields.length > 0) {
        appendSourceLine("");
      }
      for (const method of privateMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(`  ${staticPrefix}${method.returnType} ${method.name}(${methodParams}) {`);
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
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer)}` : "";
        appendSourceLine(`  ${field.cppType} ${field.name}${initSuffix};`);
      }
      if (protectedFields.length > 0) {
        appendSourceLine("");
      }
      for (const method of protectedMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(`  ${staticPrefix}${method.returnType} ${method.name}(${methodParams}) {`);
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

  for (const statement of filteredTopLevelDeclarations) {
    appendRenderedStatement(statement, "");
  }
  if (filteredTopLevelDeclarations.length > 0) {
    appendSourceLine("");
  }

  for (const fn of mappedFunctions) {
    const parameterList = renderParameters(fn.parameters);
    if (effectiveEmitMode === "split") {
      emitCommentLines(fn.leadingComments, "", (line) => appendHeaderLine(line));
      appendHeaderLine(`${fn.returnType} ${fn.name}(${parameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
      emitCommentLines(fn.trailingComments, "", (line) => appendHeaderLine(line));
    }

    emitCommentLines(fn.leadingComments, "", (line) => appendSourceLine(line));
    appendSourceLine(`${fn.returnType} ${fn.name}(${parameterList})`, {
      tsSpan: fn.sourceSpan,
      nodeKind: "function_definition",
      symbolName: fn.name,
    });
    appendSourceLine("{");
    if (hasAsyncRuntime && ((options.target === "arduino" && fn.name === "loop") || (options.target !== "arduino" && fn.name === "main"))) {
      appendSourceLine("  ts2cpp_pump_microtasks();");
    }
    for (const statement of fn.statements) {
      appendRenderedStatement(statement, "  ", globalPointerVarTypes);
    }
    if (hasAsyncRuntime && options.target === "arduino" && fn.name === "loop") {
      appendSourceLine("  ts2cpp_pump_microtasks();");
    }
    appendSourceLine("}");
    emitCommentLines(fn.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  let outputHeaderPath: string | undefined;
  let outputHeaderMapPath: string | undefined;
  if (effectiveEmitMode === "split") {
    writeText(headerPath, headerLines.join("\n").trimEnd() + "\n");
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
