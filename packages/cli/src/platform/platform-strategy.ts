// ---------------------------------------------------------------------------
// PlatformStrategy — abstract interface for target-specific C++ emit decisions
//
// Every `target === "arduino"` branch in cpp-emitter.ts is captured here as
// a strategy method.  Board packages provide concrete implementations so the
// emitter stays target-agnostic.
//
// NOTE: This file re-exports the interface from @typehal/core for backwards
// compatibility. New code should import directly from '@typehal/core'.
// ---------------------------------------------------------------------------

// Re-export from the canonical source in @typehal/core
export type { PlatformStrategy } from "@typehal/core";

// Re-export types that PlatformStrategy depends on (for convenience)
export type { ExpressionIR, ProgramIR, StatementIR } from "@typehal/core";
export type { Diagnostic, PlatformContext } from "@typehal/core";
export type { BoardConstants } from "@typehal/core";
export type { TypehalReceiverKind } from "@typehal/core";
export type { RuntimePolyfillIR } from "@typehal/core";