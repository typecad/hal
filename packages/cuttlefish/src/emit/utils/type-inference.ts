/**
 * Type inference utilities for C++ code emission.
 * Pure functions with no side effects - extracted from cpp-emitter.ts
 */

import type { ExpressionIR, StatementIR, PlatformStrategy } from "../../api/index.js";
import { parsedIsPointer } from "../../api/shared/cpp-type-ir.js";

/**
 * Infers the C++ type for an object field based on its initializer value.
 *
 * @param value The expression to infer type for
 * @param pointerVarTypes Map of variable names to their pointer types (e.g., "sensor" -> "Sensor*")
 * @param knownFunctionReturnTypes Map of function names to their return types
 * @param knownObjectTypes Map of object names to their types
 * @param knownObjectFieldTypes Map of object names to their field type maps
 * @param largeEnumNames Set of enum names with values outside 16-bit int range
 * @param resolvePinType Optional callback to resolve pin types from the platform strategy
 * @returns The inferred C++ type string
 */
export function inferObjectFieldType(
  value: ExpressionIR,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
  knownObjectTypes?: Map<string, string>,
  knownObjectFieldTypes?: Map<string, Map<string, string>>,
  largeEnumNames?: Set<string>,
  parentName?: string,
  fieldName?: string,
  defaultIntType: string = "int",
  resolvePinType?: (objectName: string, fieldName: string) => string | undefined,
): string {
  if (value.kind === "number") {
    if (value.cppType === "float" || value.cppType === "double" || !Number.isInteger(value.value)) {
      return value.cppType === "double" ? "double" : "float";
    }
    if (value.value > 32767 || value.value < -32768) {
      return "long";
    }
    return defaultIntType;
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
    // Default to the defaultIntType for unknown identifiers
    // This will be overridden if knownVariableTypes is provided
    return defaultIntType;
  }

  // For enum member access (e.g. I2CSpeed.STANDARD), return `long` if the
  // enum has values outside the 16-bit int range, otherwise `int`.
  if (value.kind === "property-access" && value.object.kind === "identifier") {
    const enumName = (value.object as Extract<ExpressionIR, { kind: "identifier" }>).value;
    return largeEnumNames?.has(enumName) ? "long" : defaultIntType;
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
      if (objectName === "Pins" && resolvePinType) {
        const resolved = resolvePinType(objectName, fieldName);
        if (resolved) return resolved;
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
    let elementType = defaultIntType;
    if (elementKinds.includes("string")) {
      elementType = "const char*";
    } else if (value.elements.some((element) => element.kind === "number" && !Number.isInteger((element as Extract<ExpressionIR, { kind: "number" }>).value))) {
      elementType = "float";
    } else if (elementKinds.includes("boolean") && !elementKinds.includes("number")) {
      elementType = "bool";
    }

    return `std::vector<${elementType}>`;
  }

  // Nested object literal — generate a struct type name
  if (value.kind === "object") {
    if (parentName && fieldName) {
      return `_${parentName}_${fieldName}_t`;
    }
    return defaultIntType;
  }

  return defaultIntType;
}

/**
 * Recursively collects nested struct definitions from an object ExpressionIR.
 * Returns an array of struct definitions ordered from deepest to shallowest,
 * so that inner structs are defined before outer structs that reference them.
 *
 * @param objExpr  The object ExpressionIR to scan for nested objects
 * @param parentName The variable/struct name prefix for generating struct type names
 * @param pointerVarTypes Optional pointer variable type map
 * @param knownFunctionReturnTypes Optional function return type map
 * @param knownObjectTypes Optional object type map
 * @param knownObjectFieldTypes Optional object field type map
 * @param largeEnumNames Optional large enum names set
 */
export function collectNestedStructDefs(
  objExpr: Extract<ExpressionIR, { kind: "object" }>,
  parentName: string,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
  knownObjectTypes?: Map<string, string>,
  knownObjectFieldTypes?: Map<string, Map<string, string>>,
  largeEnumNames?: Set<string>,
): { structName: string; fields: { type: string; name: string }[] }[] {
  const result: { structName: string; fields: { type: string; name: string }[] }[] = [];

  for (const field of objExpr.fields) {
    if (field.value.kind === "object") {
      const nestedObj = field.value as Extract<ExpressionIR, { kind: "object" }>;
      const nestedStructName = `_${parentName}_${field.name}_t`;

      // Recursively collect deeper nested structs first
      const deeper = collectNestedStructDefs(
        nestedObj, `${parentName}_${field.name}`,
        pointerVarTypes, knownFunctionReturnTypes,
        knownObjectTypes, knownObjectFieldTypes, largeEnumNames,
      );
      result.push(...deeper);

      // Collect this nested struct's fields
      const nestedFields = nestedObj.fields.map((f) => ({
        type: inferObjectFieldType(
          f.value, pointerVarTypes, knownFunctionReturnTypes,
          knownObjectTypes, knownObjectFieldTypes, largeEnumNames,
          `${parentName}_${field.name}`, f.name,
        ),
        name: f.name,
      }));
      result.push({ structName: nestedStructName, fields: nestedFields });
    }
  }

  return result;
}

/**
 * Checks if a program contains array literals inside object literals.
 * This affects whether std::vector needs to be included.
 * 
 * @param program The program IR to analyze
 * @returns true if arrays in object literals are found
 */
export function hasArrayInObjectLiteral(program: {
  topLevelStatements: StatementIR[];
  functions: Array<{ statements: StatementIR[] }>;
  classes: Array<{
    fields: Array<{ initializer?: ExpressionIR }>;
    methods: Array<{ statements: StatementIR[] }>;
    constructor?: { statements: StatementIR[] };
  }>;
}): boolean {
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

/**
 * Checks if a program contains throw statements.
 * This affects whether <stdexcept> needs to be included.
 * 
 * @param program The program IR to analyze
 * @returns true if throw statements are found
 */
export function hasThrowStatements(program: {
  topLevelStatements: StatementIR[];
  functions: Array<{ statements: StatementIR[] }>;
  classes: Array<{
    methods: Array<{ statements: StatementIR[] }>;
    constructor?: { statements: StatementIR[] };
  }>;
}): boolean {
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

/**
 * Checks if a program contains std::math function calls.
 * This affects whether <cmath> or <math.h> needs to be included.
 * 
 * @param program The program IR to analyze
 * @returns true if math calls are found
 */
export function hasStdMathCalls(program: {
  topLevelStatements: StatementIR[];
  functions: Array<{ statements: StatementIR[] }>;
  classes: Array<{
    methods: Array<{ statements: StatementIR[] }>;
    constructor?: { statements: StatementIR[] };
  }>;
}): boolean {
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

/**
 * Checks if an expression requires runtime execution (cannot be evaluated at global scope in C++).
 * Compile-time expressions can be placed at global scope; runtime expressions must go in setup()/main().
 * 
 * @param expr The expression to check
 * @returns true if the expression requires runtime execution
 */
export function collectExpressionIdentifiers(expr: ExpressionIR): Set<string> {
  const names = new Set<string>();
  function scan(e: ExpressionIR): void {
    if (!e || typeof e !== 'object' || !e.kind) return;
    if (e.kind === "identifier") {
      names.add(e.value);
      return;
    }
    for (const key of Object.keys(e)) {
      if (key === "kind" || key === "loc" || key === "range" || key === "sourceSpan") continue;
      const val = (e as any)[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object' && item.kind) scan(item);
        }
      } else if (val && typeof val === 'object' && val.kind) {
        scan(val);
      }
    }
  }
  scan(expr);
  return names;
}

export function isRuntimeExpression(expr: ExpressionIR): boolean {
  // Safety check
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    return false;
  }
  
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
      // Plain object literals can stay at global scope as long as all their
      // field initializers are themselves compile-time-safe.
      return expr.fields.some((f) => isRuntimeExpression(f.value));
    
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

    case "binary":
      return isRuntimeExpression(expr.left) || isRuntimeExpression(expr.right);

    case "unary":
      return isRuntimeExpression(expr.operand);

    case "method-call":
      return true;

    case "instanceof":
      // instanceof requires RTTI and runtime evaluation
      return true;
    
    case "spread_array":
      // Spread operations are runtime
      return true;

    case "property-access":
      // An enum member access (Mode.Run → Mode::Run) is a compile-time
      // constant, NOT a runtime expression. Without this, a top-level
      // `const currentMode: Mode = Mode.Run` was classified as runtime
      // (the default returns true) and emitted as a local inside setup()
      // instead of a file-scope global, making it invisible to functions
      // (enum stress test Finding B). Only consider it compile-time when
      // it's a static/enum access (no runtime object receiver).
      return false;

    default:
      // Unknown expression types - be conservative
      return true;
  }
}

/**
 * Checks if a statement requires runtime execution.
 * 
 * @param statement The statement to check
 * @returns true if the statement requires runtime execution
 */
export function statementRequiresRuntime(statement: StatementIR): boolean {
  if (statement.kind === "var_decl") {
    // Variable declaration requires runtime if its initializer does
    return statement.initializer ? isRuntimeExpression(statement.initializer) : false;
  }
  // All other statement types (calls, assignments, etc.) are runtime
  return true;
}

/**
 * Collects pointer variable types from program statements.
 * Variables initialized with 'new ClassName()' get type 'ClassName*'.
 * 
 * @param statements The statements to analyze
 * @param classNameMap Optional map for transforming simple class names to fully qualified names
 * @returns Map of variable names to their pointer types
 */
export function collectPointerVarTypes(
  statements: StatementIR[], 
  classNameMap?: Map<string, string>
): Map<string, string> {
  const pointerVarTypes = new Map<string, string>();
  
  for (const statement of statements) {
    if (statement.kind === "var_decl" && statement.initializer) {
      const declaredType = statement.cppType;
      if (parsedIsPointer(declaredType)) {
        pointerVarTypes.set(statement.name, declaredType);
        continue;
      }
      const init = statement.initializer;
      // Check for raw expression containing 'new'
      if (init.kind === "raw" && init.value.startsWith("new ")) {
        // Extract class name from 'new ClassName(...)'
        const match = init.value.match(/^new\s+(\w+)/);
        if (match) {
          const simpleName = match[1];
          // Use fully qualified name if available (for namespaced classes)
          const fullName = classNameMap?.get(simpleName) ?? simpleName;
          pointerVarTypes.set(statement.name, `${fullName}*`);
        }
      }
    }
  }
  
  return pointerVarTypes;
}