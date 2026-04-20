// ---------------------------------------------------------------------------
// Polyfill types (re-export from @typecode/core)
//
// All polyfill type definitions live in @typecode/core/shared so they can be
// shared across CLI, framework, and simulator packages.
//
// NOTE: This file re-exports for backwards compatibility. New code should
// import directly from '@typecode/core/shared'.
// ---------------------------------------------------------------------------

export type {
  PolyfillDomain,
  TargetProfile,
  PolyfillContext,
  PolyfillNeed,
  PolyfillDefinition,
  RuntimePolyfillIR,
  PolyfillConfig,
  StdLibSupport,
} from "@typecode/core";

export {
  DEFAULT_POLYFILL_CONFIG,
  STDLIB_SUPPORT,
  getStdLibSupport,
} from "@typecode/core";