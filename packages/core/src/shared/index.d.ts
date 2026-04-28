export type { Diagnostic, DiagnosticSeverity, PlatformContext, ArduinoPlatformContext, SourceSpan, TargetProfile } from './types';
export type { ExpressionIR, StatementIR, ProgramIR, ImportIR, ReExportIR, CallExpressionIR, VariableDeclarationIR, AssignmentIR, UpdateIR, ReturnIR, WhileIR, IfIR, ForIR, ForOfIR, ForInIR, BreakIR, ContinueIR, DoWhileIR, SwitchIR, CaseIR, TryIR, ThrowIR, LabeledIR, BlockIR, TypehalCallStatementIR, FunctionIR, StructDefIR, EnumIR, ClassFieldIR, ClassConstructorIR, ClassMethodIR, ClassGetterIR, ClassSetterIR, ClassIR, InterfaceIR, TypeAliasIR, NamespaceIR, PeripheralUsageIR, RegisterBitFieldIR, RegisterClassIR, ParameterIR, CppType, } from './ir';
export type { TypehalReceiverKind } from './typehal-symbols';
export { inferKindByName } from './typehal-symbols';
export type { BoardConstants } from './board-resolver';
export type { RuntimePolyfillIR, PolyfillDefinition, PolyfillContext, PolyfillNeed, PolyfillConfig, PolyfillDomain, StdLibSupport, } from './polyfill-types';
export { DEFAULT_POLYFILL_CONFIG, STDLIB_SUPPORT, getStdLibSupport } from './polyfill-types';
export type { PlatformStrategy } from './platform-strategy';
export type { CompileError, CompileResult, UploadResult, ToolchainOptions, ArduinoCompileResult, ArduinoUploadResult } from './toolchain-types';
export { parseCompileErrors, collectCppFiles, toArchitectureFromFqbn } from './toolchain-types';
//# sourceMappingURL=index.d.ts.map