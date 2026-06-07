import type { ProgramIR } from "../api";
import type { EmitMode, GeneratedOutputs, PlatformContext, TargetProfile } from "../types";
import type { LibraryDefinition } from "../types";
import type { ResolvedNpmPackage } from "../transpile/resolution";

import { buildEmitterContext } from "./emitters/setup";
import type { EmitterOptions } from "./emitters/emitter-context";
export { type EmitterOptions } from "./emitters/emitter-context";

import { emitPreamble } from "./emitters/output-finalizer";
import { runTopLevelPreprocessing } from "./emitters/top-level-prep";
import { synthesizeEntrypoints } from "./emitters/entrypoint-synthesizer";
import { emitTypeDeclarations } from "./emitters/type-decl-emitter";
import { emitNamespaces } from "./emitters/namespace-emitter";
import { emitClasses } from "./emitters/class-emitter";
import { emitPostClassDeclarations, emitCallbackFunctions, emitFunctions } from "./emitters/function-emitter-impl";
import { finalizeOutput } from "./emitters/output-finalizer";

// ---------------------------------------------------------------------------
// Pre-compiled regex patterns for performance
// ---------------------------------------------------------------------------
const PATH_BACKSLASH_PATTERN = /\\/g;
const DOUBLE_QUOTE_PATTERN = /"/g;
const DOUBLE_QUOTE_ESCAPE_PATTERN = /"/g;
const JS_EXTENSION_PATTERN = /\.js$/;
const MJS_EXTENSION_PATTERN = /\.mjs$/;
const FILE_EXTENSION_PATTERN = /\.[^.]+$/;

// ---------------------------------------------------------------------------
// Emit-time context
// ---------------------------------------------------------------------------

const globalEnumNames = new Set<string>();
const globalLargeEnumNames = new Set<string>();

export function registerAllEnumNames(enums: any[]): void {
  for (const e of enums) {
    globalEnumNames.add(e.name);
    if (e.members && e.members.some((m: any) => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      globalLargeEnumNames.add(e.name);
    }
  }
}

export function emitCpp(program: ProgramIR, options: EmitterOptions): GeneratedOutputs {
  // 1. Build shared emitter context (strategy, renderers, analysis, etc.)
  const ctx = buildEmitterContext(program, options);

  // 2. Emit preamble (includes, polyfills, async task classes, shims)
  emitPreamble(ctx);

  // 3. Run top-level preprocessing (timing promotion, ISR extraction, pointer tracking)
  runTopLevelPreprocessing(ctx);

  // 4. Synthesize entrypoint functions (setup/main/loop)
  synthesizeEntrypoints(ctx);

  // 5. Emit type declarations (enums, type aliases, interfaces, top-level constants)
  emitTypeDeclarations(ctx);

  // 6. Emit namespaces
  emitNamespaces(ctx);

  // 7. Emit classes
  emitClasses(ctx);

  // 8. Emit post-class declarations (runtime vars, promoted vars, object literal structs)
  emitPostClassDeclarations(ctx);

  // 9. Emit callbacks + forward declarations + function definitions
  emitCallbackFunctions(ctx);
  emitFunctions(ctx);

  // 10. Finalize output (write files, source maps, post-processing)
  return finalizeOutput(ctx);
}
