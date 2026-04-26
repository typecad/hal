/**
 * Combined program analysis - single-pass detection of multiple features.
 * 
 * Instead of traversing the IR multiple times for different checks
 * (hasConsoleCalls, hasArrayInObjectLiteral, hasThrowStatements, etc.),
 * this module performs all checks in a single traversal.
 */

import { ProgramIR, StatementIR, ExpressionIR } from "./model";

export interface ProgramAnalysisResult {
  hasConsoleCalls: boolean;
  hasArrayInObjectLiteral: boolean;
  hasThrowStatements: boolean;
  hasStdMathCalls: boolean;
  usesVectorTypes: boolean;
  usesStdString: boolean;
  usesStdFunction: boolean;
  declaredTypes: string[];
}

// Regex for std:: math calls
const MATH_PATTERN = /\bstd::(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/;

/**
 * Analyze an expression for all features in a single pass.
 */
function analyzeExpression(
  expr: ExpressionIR,
  result: Pick<ProgramAnalysisResult, 'hasStdMathCalls' | 'usesVectorTypes' | 'usesStdString' | 'usesStdFunction' | 'declaredTypes'>
): void {
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    return;
  }

  switch (expr.kind) {
    case "raw":
      if (MATH_PATTERN.test(expr.value)) {
        result.hasStdMathCalls = true;
      }
      break;

    case "array":
      result.usesVectorTypes = true;
      for (const element of expr.elements) {
        analyzeExpression(element, result);
      }
      break;

    case "object":
      for (const field of expr.fields) {
        analyzeExpression(field.value, result);
      }
      break;

    case "ternary":
      analyzeExpression(expr.condition, result);
      analyzeExpression(expr.whenTrue, result);
      analyzeExpression(expr.whenFalse, result);
      break;

    case "await":
      analyzeExpression(expr.value, result);
      break;

    case "instanceof":
      analyzeExpression(expr.object, result);
      break;

    case "spread_array":
      analyzeExpression(expr.spreadExpr, result);
      for (const element of expr.additionalElements) {
        analyzeExpression(element, result);
      }
      break;

    case "binary":
      analyzeExpression(expr.left, result);
      analyzeExpression(expr.right, result);
      break;

    case "unary":
      analyzeExpression(expr.operand, result);
      break;

    case "property-access":
      analyzeExpression(expr.object, result);
      break;

    case "typecode-call":
      for (const arg of expr.args) {
        analyzeExpression(arg, result);
      }
      break;

    case "string_concat":
    case "template_string":
      if (expr.kind === "string_concat") {
        for (const part of expr.parts) {
          analyzeExpression(part, result);
        }
      } else {
        analyzeExpression(expr.expression, result);
      }
      break;
  }
}

/**
 * Analyze a statement for all features in a single pass.
 */
function analyzeStatement(
  statement: StatementIR,
  result: ProgramAnalysisResult
): void {
  if (!statement || typeof statement !== 'object' || !statement.kind) {
    return;
  }

  switch (statement.kind) {
    case "call":
      if (isConsoleCall(statement.callee)) {
        result.hasConsoleCalls = true;
      }
      for (const arg of statement.args) {
        analyzeExpression(arg, result);
      }
      break;

    case "var_decl":
      result.declaredTypes.push(statement.cppType);
      if (statement.initializer) {
        analyzeExpression(statement.initializer, result);
        // Check for array in object literal
        if (statement.initializer.kind === "array") {
          result.hasArrayInObjectLiteral = true;
        }
      }
      break;

    case "assign":
      analyzeExpression(statement.value, result);
      break;

    case "return":
      if (statement.value) {
        analyzeExpression(statement.value, result);
      }
      break;

    case "throw":
      result.hasThrowStatements = true;
      analyzeExpression(statement.value, result);
      break;

    case "while":
    case "do_while":
      analyzeExpression(statement.condition, result);
      for (const nested of statement.body) {
        analyzeStatement(nested, result);
      }
      break;

    case "if":
      analyzeExpression(statement.condition, result);
      for (const nested of statement.thenBranch) {
        analyzeStatement(nested, result);
      }
      for (const nested of statement.elseBranch ?? []) {
        analyzeStatement(nested, result);
      }
      break;

    case "for":
      if (statement.initializer) {
        analyzeStatement(statement.initializer, result);
      }
      if (statement.condition) {
        analyzeExpression(statement.condition, result);
      }
      if (statement.increment) {
        analyzeStatement(statement.increment, result);
      }
      for (const nested of statement.body) {
        analyzeStatement(nested, result);
      }
      break;

    case "for_of":
      analyzeStatement(statement.variable, result);
      analyzeExpression(statement.iterable, result);
      for (const nested of statement.body) {
        analyzeStatement(nested, result);
      }
      break;

    case "for_in":
      analyzeStatement(statement.variable, result);
      analyzeExpression(statement.object, result);
      for (const nested of statement.body) {
        analyzeStatement(nested, result);
      }
      break;

    case "switch":
      analyzeExpression(statement.expression, result);
      for (const caseClause of statement.cases) {
        if (caseClause.value) {
          analyzeExpression(caseClause.value, result);
        }
        for (const nested of caseClause.body) {
          analyzeStatement(nested, result);
        }
      }
      break;

    case "try":
      for (const nested of statement.tryBlock) {
        analyzeStatement(nested, result);
      }
      for (const nested of statement.catchBlock ?? []) {
        analyzeStatement(nested, result);
      }
      for (const nested of statement.finallyBlock ?? []) {
        analyzeStatement(nested, result);
      }
      break;

    case "typecode-call":
      for (const arg of statement.args) {
        analyzeExpression(arg, result);
      }
      break;

    case "update":
      // update statements just increment/decrement a variable
      break;

    case "break":
    case "continue":
      // no expressions to analyze
      break;

    case "labeled":
    case "block":
      const body = statement.kind === "labeled" ? statement.body : statement.body;
      for (const nested of body) {
        analyzeStatement(nested, result);
      }
      break;
  }
}

/**
 * Check if a callee is a console method call (e.g., "console.log", "console.error")
 */
function isConsoleCall(callee: string): boolean {
  return callee.startsWith("console.");
}

/**
 * Analyze a program IR in a single pass to detect all features.
 * This replaces multiple separate traversals with one combined traversal.
 */
export function analyzeProgram(program: ProgramIR): ProgramAnalysisResult {
  const result: ProgramAnalysisResult = {
    hasConsoleCalls: false,
    hasArrayInObjectLiteral: false,
    hasThrowStatements: false,
    hasStdMathCalls: false,
    usesVectorTypes: false,
    usesStdString: false,
    usesStdFunction: false,
    declaredTypes: [],
  };

  // Analyze type aliases
  for (const typeAlias of program.typeAliases) {
    result.declaredTypes.push(typeAlias.cppType);
  }

  // Analyze functions
  for (const fn of program.functions) {
    result.declaredTypes.push(fn.returnType);
    for (const parameter of fn.parameters) {
      result.declaredTypes.push(parameter.cppType);
    }
    for (const statement of fn.statements) {
      analyzeStatement(statement, result);
    }
  }

  // Analyze top-level statements
  for (const statement of program.topLevelStatements) {
    analyzeStatement(statement, result);
  }

  // Analyze classes
  for (const classDef of program.classes) {
    for (const field of classDef.fields) {
      result.declaredTypes.push(field.cppType);
      if (field.initializer) {
        analyzeExpression(field.initializer, result);
        if (field.initializer.kind === "array") {
          result.hasArrayInObjectLiteral = true;
        }
      }
    }
    for (const method of classDef.methods) {
      result.declaredTypes.push(method.returnType);
      for (const parameter of method.parameters) {
        result.declaredTypes.push(parameter.cppType);
      }
      for (const statement of method.statements) {
        analyzeStatement(statement, result);
      }
    }
    if (classDef.constructor) {
      for (const parameter of classDef.constructor.parameters) {
        result.declaredTypes.push(parameter.cppType);
      }
      for (const statement of classDef.constructor.statements) {
        analyzeStatement(statement, result);
      }
    }
  }

  // Post-process declared types to detect std:: usage
  for (const typeName of result.declaredTypes) {
    if (typeName.includes("std::vector<")) {
      result.usesVectorTypes = true;
    }
    if (typeName.includes("std::string")) {
      result.usesStdString = true;
    }
    if (typeName.includes("std::function<")) {
      result.usesStdFunction = true;
    }
  }

  return result;
}