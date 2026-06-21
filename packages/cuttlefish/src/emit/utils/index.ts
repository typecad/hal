/**
 * Emitter utilities barrel export.
 * Re-exports all utility functions for C++ code emission.
 */

// Type inference utilities
export {
  inferObjectFieldType,
  collectNestedStructDefs,
  hasArrayInObjectLiteral,
  hasThrowStatements,
  hasStdMathCalls,
  hasConsoleCalls,
  isConsoleCall,
  getConsoleMethod,
  isRuntimeExpression,
  statementRequiresRuntime,
  collectPointerVarTypes,
  collectExpressionIdentifiers,
} from "./type-inference.js";

// Async state machine utilities
export {
  toPascalCaseLocal,
  generateAsyncTaskClass,
  type AsyncTaskClassResult,
} from "./async-state-machine.js";

// Include resolution utilities
export {
  isCuttlefishSDKImport,
  normalizeInclude,
  dedupe,
  resolveTranspiledModuleInclude,
  applySymbolMap,
} from "./include-resolver.js";

// Comment handling utilities
export {
  normalizeComment,
  emitCommentLines,
} from "./comment-helpers.js";