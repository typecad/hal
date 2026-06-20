/**
 * Combined program analysis - single-pass detection of multiple features.
 * 
 * Instead of traversing the IR multiple times for different checks
 * (hasConsoleCalls, hasArrayInObjectLiteral, hasThrowStatements, etc.),
 * this module performs all checks in a single traversal.
 */

import { ProgramIR, StatementIR, ExpressionIR, PlatformStrategy, Diagnostic } from "../api";
import { POLYFILL_HELPER_MAP } from "../api/shared";
import { parseCppType } from "../api/shared/cpp-type-ir";
import { analyzeResources } from "./resource-analysis";

export interface ProgramAnalysisResult {
  hasConsoleCalls: boolean;
  hasArrayInObjectLiteral: boolean;
  hasThrowStatements: boolean;
  hasStdMathCalls: boolean;
  usesVectorTypes: boolean;
  usesStdString: boolean;
  usesStdFunction: boolean;
  declaredTypes: string[];
  usedPolyfillHelpers: Set<string>;
  usesStringConversion: boolean;
  usesDateNow: boolean;
  usesMillis: boolean;
  usesNullish: boolean;
  /** True when this file actually emits a cuttlefish_nullish/exists/is_nullish CALL
   *  (e.g. from a `??` lowering), as opposed to just referencing the
   *  CUTTLEFISH_UNDEFINED macro via a `null`/`undefined` literal. Used to decide
   *  whether non-entry headers need the full nullish shim block. */
  usesNullishHelper: boolean;
  usesNum: boolean;
  usesTiming: boolean;
  usesWDT: boolean;
  usesStrPtr: boolean;
  hasSerialBegin: boolean;
  hasGenerators: boolean;
  usesStdMap: boolean;
}

// Regex for std:: math calls
const MATH_PATTERN = /\bstd::(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/;

/**
 * Analyze an expression for all features in a single pass.
 */
function analyzeExpression(
  expr: ExpressionIR,
  result: Pick<ProgramAnalysisResult, 'hasConsoleCalls' | 'hasStdMathCalls' | 'usesVectorTypes' | 'usesStdString' | 'usesStdFunction' | 'declaredTypes' | 'usedPolyfillHelpers' | 'usesStringConversion' | 'usesDateNow' | 'usesMillis' | 'usesNullish' | 'usesNullishHelper' | 'usesNum' | 'usesTiming' | 'usesWDT' | 'usesStrPtr'>,
  strategy: PlatformStrategy
): void {
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    return;
  }

  switch (expr.kind) {
    case "raw":
      if (MATH_PATTERN.test(expr.value)) {
        result.hasStdMathCalls = true;
      }
      for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
        if (expr.value.includes(pattern)) {
          for (const name of helperNames) {
            result.usedPolyfillHelpers.add(name);
          }
        }
        // Also check for already-lowered __tc_ names
        for (const name of helperNames) {
          if (expr.value.includes(name)) {
            result.usedPolyfillHelpers.add(name);
          }
        }
      }
      if (/\bString\s*\(/.test(expr.value)) {
        result.usesStringConversion = true;
      }
      if (/Date\.now\s*\(/.test(expr.value) || /Date::now\s*\(/.test(expr.value)) {
        result.usesDateNow = true;
      }
      if (/\bmillis\s*\(/.test(expr.value)) {
        result.usesMillis = true;
      }
      if (expr.value.includes('cuttlefish_nullish(') || expr.value.includes('cuttlefish_exists(') || expr.value.includes('cuttlefish_is_nullish(')) {
        result.usesNullish = true;
        result.usesNullishHelper = true;
      }
      if (/\bNum\b/.test(expr.value)) {
        result.usesNum = true;
      }
      if (/\bTiming\b/.test(expr.value)) {
        result.usesTiming = true;
      }
      if (/\bWDT\b/.test(expr.value)) {
        result.usesWDT = true;
      }
      if (expr.value.includes('__tc_str_ptr')) {
        result.usesStrPtr = true;
      }
      break;

    case "method-call":
      if (strategy.isConsoleCall(expr.callee)) {
        result.hasConsoleCalls = true;
      }
      if (/\bmillis\b/.test(expr.callee) || /\bdelay\b/.test(expr.callee) || /\bmicros\b/.test(expr.callee)) {
        result.usesMillis = true;
      }
      if (expr.callee === "Date.now" || expr.callee === "Date::now") {
        result.usesDateNow = true;
      }
      if (expr.callee === "String") {
        result.usesStringConversion = true;
      }
      if (MATH_PATTERN.test(expr.callee)) {
        result.hasStdMathCalls = true;
      }
      for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
        const methodName = pattern.startsWith('.') ? pattern.slice(1, -1) : pattern.slice(0, -1);
        if (expr.callee.includes(pattern) || expr.callee.endsWith("." + methodName) || expr.callee === methodName) {
          for (const name of helperNames) {
            result.usedPolyfillHelpers.add(name);
          }
        }
        for (const name of helperNames) {
          if (expr.callee.includes(name)) {
            result.usedPolyfillHelpers.add(name);
          }
        }
      }
      if (expr.callee.startsWith("Num.") || expr.callee === "Num") {
        result.usesNum = true;
      }
      if (expr.callee.startsWith("Timing.") || expr.callee === "Timing") {
        result.usesTiming = true;
      }
      if (expr.callee.startsWith("WDT.") || expr.callee === "WDT") {
        result.usesWDT = true;
      }
      for (const arg of expr.args) {
        analyzeExpression(arg, result, strategy);
      }
      break;

    case "identifier":
      // expression-to-ir lowers the TS `null` literal to the "nullptr" sentinel
      // (routed through nullValue() at render time, which yields CUTTLEFISH_UNDEFINED
      // on native/arduino). Include it so usesNullish triggers the defining shim.
      if (expr.value === "null" || expr.value === "undefined" || expr.value === "nullptr" || expr.value === "CUTTLEFISH_UNDEFINED") {
        result.usesNullish = true;
      }
      break;

    case "string":
      for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
        if (expr.value.includes(pattern)) {
          for (const name of helperNames) {
            result.usedPolyfillHelpers.add(name);
          }
        }
        // Also check for already-lowered __tc_ names (e.g. in __EMIT__ calls from HAL resolver)
        for (const name of helperNames) {
          if (expr.value.includes(name)) {
            result.usedPolyfillHelpers.add(name);
          }
        }
      }
      break;

    case "array":
      result.usesVectorTypes = true;
      for (const element of expr.elements) {
        analyzeExpression(element, result, strategy);
      }
      break;

    case "object":
      for (const field of expr.fields) {
        analyzeExpression(field.value, result, strategy);
      }
      break;

    case "ternary":
      analyzeExpression(expr.condition, result, strategy);
      analyzeExpression(expr.whenTrue, result, strategy);
      analyzeExpression(expr.whenFalse, result, strategy);
      break;

    case "await":
      analyzeExpression(expr.value, result, strategy);
      break;

    case "instanceof":
      analyzeExpression(expr.object, result, strategy);
      break;

    case "spread_array":
      analyzeExpression(expr.spreadExpr, result, strategy);
      for (const element of expr.additionalElements) {
        analyzeExpression(element, result, strategy);
      }
      break;

    case "binary":
      if (expr.operator === "**") {
        result.hasStdMathCalls = true;
      }
      analyzeExpression(expr.left, result, strategy);
      analyzeExpression(expr.right, result, strategy);
      break;

    case "unary":
      analyzeExpression(expr.operand, result, strategy);
      break;

    case "property-access":
      analyzeExpression(expr.object, result, strategy);
      break;

    case "element-access":
      analyzeExpression(expr.object, result, strategy);
      analyzeExpression(expr.index, result, strategy);
      break;

    case "string_concat":
    case "template_string":
      result.usesStringConversion = true;
      if (expr.kind === "string_concat") {
        for (const part of expr.parts) {
          analyzeExpression(part, result, strategy);
        }
      } else {
        analyzeExpression(expr.expression, result, strategy);
      }
      break;
  }
}

/**
 * Analyze a statement for all features in a single pass.
 */
function analyzeStatement(
  statement: StatementIR,
  result: ProgramAnalysisResult,
  strategy: PlatformStrategy
): void {
  if (!statement || typeof statement !== 'object' || !statement.kind) {
    return;
  }

  switch (statement.kind) {
    case "call":
      if (strategy.isConsoleCall(statement.callee)) {
        result.hasConsoleCalls = true;
      }
      if (statement.callee === "Serial.begin" || statement.callee.endsWith(".begin")) {
        result.hasSerialBegin = true;
      }
      if (statement.callee === "String") {
        result.usesStringConversion = true;
      }
      if (statement.callee === "Date.now" || statement.callee === "Date::now") {
        result.usesDateNow = true;
      }
      if (statement.callee === "millis" || statement.callee === "delay") {
        result.usesMillis = true;
      }
      // Namespace-qualified polyfill entry points used as bare call statements
      // (e.g. `Timing.delay(5);`). The expression-level analyzer (case
      // "method-call") already checks these prefixes, but a statement-form call
      // never becomes a method-call expression — it stays a `call` statement —
      // so without these mirrors `usesTiming`/`usesNum`/`usesWDT` stayed false
      // and the defining shim was filtered out (avr-g++: "'Timing' was not
      // declared in this scope"). Demo #30 Finding A.
      if (statement.callee.startsWith("Timing.") || statement.callee === "Timing") {
        result.usesTiming = true;
      }
      if (statement.callee.startsWith("Num.") || statement.callee === "Num") {
        result.usesNum = true;
      }
      if (statement.callee.startsWith("WDT.") || statement.callee === "WDT") {
        result.usesWDT = true;
      }
      // The HAL resolver lowers WDT.*/Timing.* namespace calls to bare AVR
      // library functions (WDT.reset() → wdt_reset(), Timing.delay() → delay(),
      // Timing.millis() → millis()). When that happens the `WDT.`/`Timing.`
      // prefix is gone, so the namespace checks above miss it and the defining
      // shim gets filtered out (avr-g++: "'wdt_reset' was not declared in this
      // scope"). Detect the lowered names directly. Demo #32 Finding A.
      if (statement.callee === "wdt_reset" || statement.callee === "wdt_enable" || statement.callee === "wdt_disable") {
        result.usesWDT = true;
      }
      for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
        const methodName = pattern.startsWith('.') ? pattern.slice(1, -1) : pattern.slice(0, -1);
        if (statement.callee === methodName || statement.callee.endsWith("." + methodName)) {
          for (const name of helperNames) {
            result.usedPolyfillHelpers.add(name);
          }
        }
        // Also detect already-lowered __tc_* helper calls — including raw-statement
        // wrappers (`__RAW_STMT____tc_pop(...)`) produced by the structural
        // vector-method lowering in call-statement.ts. Without this, a statement
        // form like `arr.pop();` (lowered to `__RAW_STMT____tc_pop(arr)`) wouldn't
        // register the polyfill, and the helper definition would be filtered out.
        for (const name of helperNames) {
          if (statement.callee.includes(name)) {
            result.usedPolyfillHelpers.add(name);
          }
        }
      }
      for (const arg of statement.args) {
        analyzeExpression(arg, result, strategy);
      }
      break;

    case "var_decl":
      result.declaredTypes.push(statement.cppType);
      if (parseCppType(statement.cppType).kind === "strPtr") {
        result.usesStrPtr = true;
      }
      if (statement.initializer) {
        analyzeExpression(statement.initializer, result, strategy);
        // Check for array in object literal
        if (statement.initializer.kind === "array") {
          result.hasArrayInObjectLiteral = true;
        }
      }
      break;

    case "assign":
      analyzeExpression(statement.value, result, strategy);
      break;

    case "return":
      if (statement.value) {
        analyzeExpression(statement.value, result, strategy);
      }
      break;

    case "throw":
      result.hasThrowStatements = true;
      analyzeExpression(statement.value, result, strategy);
      break;

    case "while":
    case "do_while":
      analyzeExpression(statement.condition, result, strategy);
      for (const nested of statement.body) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "if":
      analyzeExpression(statement.condition, result, strategy);
      for (const nested of statement.thenBranch) {
        analyzeStatement(nested, result, strategy);
      }
      for (const nested of statement.elseBranch ?? []) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "for":
      if (statement.initializer) {
        analyzeStatement(statement.initializer, result, strategy);
      }
      if (statement.condition) {
        analyzeExpression(statement.condition, result, strategy);
      }
      if (statement.increment) {
        analyzeStatement(statement.increment, result, strategy);
      }
      for (const nested of statement.body) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "for_of":
      analyzeStatement(statement.variable, result, strategy);
      analyzeExpression(statement.iterable, result, strategy);
      for (const nested of statement.body) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "for_in":
      analyzeStatement(statement.variable, result, strategy);
      analyzeExpression(statement.object, result, strategy);
      for (const nested of statement.body) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "switch":
      analyzeExpression(statement.expression, result, strategy);
      for (const caseClause of statement.cases) {
        if (caseClause.value) {
          analyzeExpression(caseClause.value, result, strategy);
        }
        for (const nested of caseClause.body) {
          analyzeStatement(nested, result, strategy);
        }
      }
      break;

    case "try":
      for (const nested of statement.tryBlock) {
        analyzeStatement(nested, result, strategy);
      }
      for (const nested of statement.catchBlock ?? []) {
        analyzeStatement(nested, result, strategy);
      }
      for (const nested of statement.finallyBlock ?? []) {
        analyzeStatement(nested, result, strategy);
      }
      break;

    case "hal-op":
      // Scan raw C++ code in HAL ops for polyfill helper usage
      if (statement.operation && statement.operation.operation === "raw" && typeof statement.operation.code === "string") {
        const code = statement.operation.code;
        for (const [pattern, helperNames] of Object.entries(POLYFILL_HELPER_MAP)) {
          if (code.includes(pattern)) {
            for (const name of helperNames) {
              result.usedPolyfillHelpers.add(name);
            }
          }
          for (const name of helperNames) {
            if (code.includes(name)) {
              result.usedPolyfillHelpers.add(name);
            }
          }
        }
        // The HAL resolver lowers WDT.*/Timing.* namespace calls to bare AVR
        // library functions inside hal-op raw code (WDT.reset() → wdt_reset(),
        // Timing.delay() → delay()). The namespace prefix is gone, so detect
        // the lowered names to keep the defining shim/include alive.
        // Demo #32 Finding B.
        if (/\bwdt_(reset|enable|disable)\b/.test(code)) {
          result.usesWDT = true;
        }
        if (/\b(millis|micros|delay|delayMicroseconds)\s*\(/.test(code)) {
          result.usesTiming = true;
          result.usesMillis = true;
        }
      }
      break;

    case "update":
      // update statements just increment/decrement a variable
      break;

    case "break":
    case "continue":
      // no expressions to analyze
      break;

    case "super_call":
      for (const arg of statement.args) {
        analyzeExpression(arg, result, strategy);
      }
      break;

    case "labeled":
    case "block":
      const body = statement.kind === "labeled" ? statement.body : statement.body;
      for (const nested of body) {
        analyzeStatement(nested, result, strategy);
      }
      break;
  }
}


/**
 * Analyze a program IR in a single pass to detect all features.
 * This replaces multiple separate traversals with one combined traversal.
 */
export function analyzeProgram(program: ProgramIR, strategy: PlatformStrategy): ProgramAnalysisResult {
  const result: ProgramAnalysisResult = {
    hasConsoleCalls: false,
    hasArrayInObjectLiteral: false,
    hasThrowStatements: false,
    hasStdMathCalls: false,
    usesVectorTypes: false,
    usesStdString: false,
    usesStdFunction: false,
    declaredTypes: [],
    usedPolyfillHelpers: new Set(),
    usesStringConversion: false,
    usesDateNow: false,
    usesMillis: false,
    usesNullish: false,
    usesNullishHelper: false,
    usesNum: false,
    usesTiming: false,
    usesWDT: false,
    usesStrPtr: false,
    hasSerialBegin: false,
    hasGenerators: false,
    usesStdMap: false,
  };

  // Analyze type aliases
  for (const typeAlias of program.typeAliases) {
    result.declaredTypes.push(typeAlias.cppType);
    if (typeAlias.structFields) {
      for (const field of typeAlias.structFields) {
        result.declaredTypes.push(field.cppType);
      }
    }
    if (typeAlias.variantStructs) {
      for (const variant of typeAlias.variantStructs) {
        for (const field of variant.fields) {
          result.declaredTypes.push(field.cppType);
        }
      }
    }
  }

  // Analyze interfaces for field types and index signatures
  for (const iface of program.interfaces) {
    for (const field of iface.fields) {
      result.declaredTypes.push(field.cppType);
    }
    if (iface.indexSignature) {
      result.usesStdMap = true;
      result.declaredTypes.push(iface.indexSignature.keyType);
      result.declaredTypes.push(iface.indexSignature.valueType);
    }
  }

  // Analyze functions
  for (const fn of program.functions) {
    if (fn.isGenerator) result.hasGenerators = true;
    result.declaredTypes.push(fn.returnType);
    for (const parameter of fn.parameters) {
      result.declaredTypes.push(parameter.cppType);
    }
    for (const statement of fn.statements) {
      analyzeStatement(statement, result, strategy);
    }
  }

  // Analyze top-level statements
  for (const statement of program.topLevelStatements) {
    analyzeStatement(statement, result, strategy);
  }

  // Analyze classes
  for (const classDef of program.classes) {
    for (const field of classDef.fields) {
      result.declaredTypes.push(field.cppType);
      if (field.initializer) {
        analyzeExpression(field.initializer, result, strategy);
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
        analyzeStatement(statement, result, strategy);
      }
    }
    if (classDef.constructor) {
      for (const parameter of classDef.constructor.parameters) {
        result.declaredTypes.push(parameter.cppType);
      }
      for (const statement of classDef.constructor.statements) {
        analyzeStatement(statement, result, strategy);
      }
    }
  }

  // Post-process declared types to detect std:: usage
  for (const typeName of result.declaredTypes) {
    if (typeName.includes("std::vector<")) {
      result.usesVectorTypes = true;
    }
    if (strategy.needsStdVector() && typeName.includes("__tc_StaticArray<")) {
      result.usesVectorTypes = true;
    }
    // Track __tc_StaticArray type usage on ALL targets so the defining
    // polyfill is retained by filterPolyfillHelpers (the struct's constructor
    // matches the helper-name regex but is never a user call site, so without
    // this the struct would be filtered out and `__tc_StaticArray<int,N>`
    // undeclared — avr-g++: "'__tc_StaticArray' was not declared"). Demo #23.
    if (typeName.includes("__tc_StaticArray<")) {
      result.usedPolyfillHelpers.add("__tc_StaticArray");
    }
    if (typeName.includes("std::string")) {
      result.usesStdString = true;
      // The Arduino/AVR strategy normalizes `std::string` → `__tc_str_ptr` at
      // emit time (Strategy.normalizeCppType). The `usesStrPtr` flag gates
      // emission of the `__tc_str_ptr` shim block, but the per-statement
      // detector at the `var_decl` arm compares the PRE-normalization cppType
      // (still `std::string`) against `parseCppType(...).kind === "strPtr"` —
      // which never matches, so a string-typed LOCAL/field/return that emits
      // as `__tc_str_ptr` silently drops its own shim and fails at g++ time
      // ("'__tc_str_ptr' does not name a type"). Resolving the type through
      // the strategy's normalizer here — the single broadest chokepoint over
      // every declared type (locals, fields, params, returns, aliases) — makes
      // the analysis agree with the emit path on every target. On native the
      // normalizer leaves `std::string` alone, so this is a no-op there.
      if (strategy.normalizeCppType("std::string") === "__tc_str_ptr") {
        result.usesStrPtr = true;
      }
    }
    if (typeName.includes("std::function<")) {
      result.usesStdFunction = true;
    }
    if (typeName.includes("std::map<")) {
      result.usesStdMap = true;
    }
  }

  return result;
}
