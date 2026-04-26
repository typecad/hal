// ---------------------------------------------------------------------------
// PlatformStrategy — abstract interface for target-specific C++ emit decisions
//
// Every `target === "arduino"` branch in cpp-emitter.ts is captured here as
// a strategy method.  Board packages provide concrete implementations so the
// emitter stays target-agnostic.
//
// NOTE: This file re-exports the interface from @typecode/core for backwards
// compatibility. New code should import directly from '@typecode/core'.
// ---------------------------------------------------------------------------

// Re-export from the canonical source in @typecode/core
export type { PlatformStrategy } from "@typecode/core";

// Re-export types that PlatformStrategy depends on (for convenience)
export type { ExpressionIR, ProgramIR, StatementIR } from "@typecode/core";
export type { Diagnostic, PlatformContext } from "@typecode/core";
export type { BoardConstants } from "@typecode/core";
export type { TypecodeReceiverKind } from "@typecode/core";
export type { RuntimePolyfillIR } from "@typecode/core";