/**
 * Emitter utilities barrel export.
 * Re-exports all utility functions for C++ code emission.
 */

// Type inference utilities
export {
  inferObjectFieldType,
  collectNestedStructDefs,
  collectDeclaredTypes,
  hasArrayInObjectLiteral,
  hasThrowStatements,
  hasStdMathCalls,
  hasConsoleCalls,
  isConsoleCall,
  getConsoleMethod,
  isRuntimeExpression,
  statementRequiresRuntime,
  collectPointerVarTypes,
} from "./type-inference";

// Async state machine utilities
export {
  toPascalCaseLocal,
  generateAsyncTaskClass,
  type AsyncTaskClassResult,
} from "./async-state-machine";

// Include resolution utilities
export {
  isTypecodeSDKImport,
  normalizeInclude,
  dedupe,
  resolveTranspiledModuleInclude,
  applySymbolMap,
  type TranspiledIncludeResult,
} from "./include-resolver";

// Comment handling utilities
export {
  normalizeComment,
  emitCommentLines,
} from "./comment-helpers";