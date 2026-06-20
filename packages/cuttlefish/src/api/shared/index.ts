// ---------------------------------------------------------------------------
// Shared types barrel export
//
// Re-exports all shared types for use by CLI and framework packages.
// ---------------------------------------------------------------------------

// Base types
export type { Diagnostic, PlatformContext, SourceSpan, TargetProfile } from './types';

// C++ type IR (structured replacement for stringly-typed CppType)
export type {
  CppTypeIR,
  CppTypeKind,
  CppPrimitiveName,
  CppFormatKind,
} from './cpp-type-ir';
export {
  parseCppType,
  renderCppType,
  splitTemplateArgs,
  isPointer,
  isReference,
  isContainer,
  isVector,
  isMap,
  isSet,
  isTuple,
  isVariant,
  isStdFunction,
  isStaticArray,
  isCArray,
  isStringLike,
  isPrimitive,
  bareType,
  elementOf,
  formatKindOf,
  CppTypeIR as cppTypeIRBuilder,
  parsedIsPointer,
  parsedIsStringLike,
  parsedIsPrimitive,
  parsedIsContainer,
  parsedIsVector,
  parsedIsMap,
  parsedIsSet,
  parsedIsTuple,
  parsedIsVariant,
  parsedIsStaticArray,
  parsedIsStdString,
  parsedElementOf,
  parsedElementString,
  parsedBareString,
  parsedBareType,
  collectNamedTypes,
  parsedCollectNamedTypes,
  needsCStrForStringLike,
  parsedIsPlainStructType,
} from './cpp-type-ir';

// IR types
export type {
  ExpressionIR,
  StatementIR,
  ProgramIR,
  ImportIR,
  ReExportIR,
  CallExpressionIR,
  SuperCallIR,
  VariableDeclarationIR,
  AssignmentIR,
  UpdateIR,
  ReturnIR,
  WhileIR,
  IfIR,
  ForIR,
  ForOfIR,
  ForInIR,
  BreakIR,
  ContinueIR,
  DoWhileIR,
  SwitchIR,
  CaseIR,
  TryIR,
  ThrowIR,
  LabeledIR,
  BlockIR,
  HALOpStatementIR,
  FunctionIR,
  StructDefIR,
  EnumIR,
  ClassFieldIR,
  ClassConstructorIR,
  ClassMethodIR,
  ClassGetterIR,
  ClassSetterIR,
  ClassIR,
  InterfaceIR,
  TypeAliasIR,
  NamespaceIR,
  PeripheralUsageIR,
  RegisterBitFieldIR,
  RegisterClassIR,
  ParameterIR,
  CppType,
} from './ir';

// HAL Operation IR types
export type {
  HALOpIR,
  HALOperationKind,
} from './hal-op-ir';

// Display HAL Operation IR types (graphics draw calls)
export type {
  DisplayInitOp,
  DisplayFillRectOp,
  DisplayDrawTextOp,
  DisplayDrawRectOp,
  DisplayFlushOp,
  DisplayHALOp,
} from './display-op-ir';
export { DISPLAY_OPERATION_KINDS } from './display-op-ir';

// Board resolver
export type { BoardConstants } from './board-resolver';

// Polyfill types
export type {
  RuntimePolyfillIR,
  StdLibSupport,
} from './polyfill-types';
export { getStdLibSupport, DEFAULT_STDLIB_SUPPORT } from './polyfill-types';

// Platform strategy
export type {
  PlatformStrategy,
  PlatformProfileStrategy,
  PlatformPolyfillStrategy,
  PlatformTypeStrategy,
  PlatformExpressionStrategy,
  PlatformStatementStrategy,
  PlatformSafetyStrategy,
  PlatformBuildStrategy,
  PlatformDebugStrategy,
  PlatformAsyncStrategy,
  PlatformHALStrategy,
} from './platform-strategy';

// Toolchain types
export type { CompileError, CompileResult, UploadResult, ToolchainOptions } from './toolchain-types';
export { parseCompileErrors, collectCppFiles } from './toolchain-types';

// Snprintf types
export type {
  KnownVariableInfo,
  SnprintfArgRenderResult,
  SnprintfRenderResult,
  EmissionScopeState,
  SnprintfExpressionRenderer,
} from './snprintf-types';

// Polyfill helper registry
export { POLYFILL_HELPER_MAP, filterPolyfillHelpers } from './polyfill-helper-registry';

// Shared string-method lowering (used by all platform strategies)
export { STRING_METHODS, STRING_METHOD_NAMES, applyStringMethodRewrites } from './string-method-registry';
export type { StringMethodSpec, StringMethodArgForm } from './string-method-registry';

// Runtime helpers
export { isStringEnum } from './ir-declarations';

// Async types
export type { AsyncRuntimeConfig } from './async-types';

// Promise runtime generator
export { generatePromiseRuntime } from './promise-runtime';