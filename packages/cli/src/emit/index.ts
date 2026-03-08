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