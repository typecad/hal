/**
 * C++ Emitter module barrel export.
 * Provides a clean public API for C++ code generation.
 */

// Re-export utilities
export * from "./utils";

// Re-export renderers
export { ExpressionRenderer, transformTypeName, type ExpressionRendererContext } from "./expression-renderer";
export { StatementRenderer, type StatementRendererContext } from "./statement-renderer";

// Re-export base emitter
export { BaseEmitter, type EmitterContext, type EmitResult } from "./base-emitter";

// Re-export emitter state (for migration from module-level state)
export { EmitterState, createEmitterState } from "./emitter-context";

// Re-export specialized emitters
export { ClassEmitter, type ClassEmitterContext } from "./class-emitter";
export { EnumEmitter, type EnumEmitterContext, type EnumDefForEmit, type TypeAliasForEmit } from "./enum-emitter";
export { FunctionEmitter, type FunctionEmitterContext, type FunctionDefForEmit, type CallbackDefForEmit } from "./function-emitter";
export { SetupEmitter, type SetupEmitterContext, type SetupLoopResult } from "./setup-emitter";
