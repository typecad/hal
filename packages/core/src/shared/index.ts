// ---------------------------------------------------------------------------
// Shared types barrel export
//
// Re-exports all shared types for use by CLI and framework packages.
// ---------------------------------------------------------------------------

// Base types
export type { Diagnostic, DiagnosticSeverity, PlatformContext, ArduinoPlatformContext, SourceSpan, TargetProfile } from './types';

// IR types
export type {
  ExpressionIR,
  StatementIR,
  ProgramIR,
  ImportIR,
  ReExportIR,
  CallExpressionIR,
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
  TypecodeCallStatementIR,
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

// Typecode symbols
export type { TypecodeReceiverKind } from './typecode-symbols';
export { inferKindByName, pinsWithKind } from './typecode-symbols';

// Board resolver
export type { BoardConstants } from './board-resolver';

// Polyfill types
export type {
  RuntimePolyfillIR,
  PolyfillDefinition,
  PolyfillContext,
  PolyfillNeed,
  PolyfillConfig,
  PolyfillDomain,
  StdLibSupport,
} from './polyfill-types';
export { DEFAULT_POLYFILL_CONFIG, STDLIB_SUPPORT, getStdLibSupport } from './polyfill-types';

// Platform strategy
export type {
  PlatformStrategy,
  PlatformProfileStrategy,
  PlatformPolyfillStrategy,
  PlatformTypeStrategy,
  PlatformExpressionStrategy,
  PlatformStatementStrategy,
  PlatformSafetyStrategy,
} from './platform-strategy';

// Toolchain types
export type { CompileError, CompileResult, UploadResult, ToolchainOptions, ArduinoCompileResult, ArduinoUploadResult } from './toolchain-types';
export { parseCompileErrors, collectCppFiles, toArchitectureFromFqbn } from './toolchain-types';

// Snprintf types
export type {
  KnownVariableInfo,
  SnprintfArgRenderResult,
  SnprintfRenderResult,
  EmissionScopeState,
  SnprintfExpressionRenderer,
} from './snprintf-types';

// Polyfill helper registry
export { POLYFILL_HELPER_MAP, extractHelperFunctionName, filterPolyfillHelpers } from './polyfill-helper-registry';
