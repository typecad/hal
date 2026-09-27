import type { ProgramIR } from "../api/index.js";
import type { GeneratedOutputs } from "../types.js";

import { buildEmitterContext } from "./emitters/setup.js";
import type { EmitterOptions } from "./emitters/emitter-context.js";
export { type EmitterOptions } from "./emitters/emitter-context.js";

import { emitPreamble, emitAsyncTaskClasses, emitAsyncMethodTasks, emitPromotedVarExterns, finalizeOutput } from "./emitters/output-finalizer.js";
import { runTopLevelPreprocessing } from "./emitters/top-level-prep.js";
import { synthesizeEntrypoints } from "./emitters/entrypoint-synthesizer.js";
import { emitTypeDeclarations } from "./emitters/type-decl-emitter.js";
import { emitNamespaces } from "./emitters/namespace-emitter.js";
import { emitClasses } from "./emitters/class-emitter.js";
import { emitPostClassDeclarations, emitCallbackFunctions, emitFunctions, emitFunctionForwardDeclarations } from "./emitters/function-emitter-impl.js";
import { emitUIRuntime } from "./emitters/ui-emitter.js";

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

  // 2. Emit preamble (includes, polyfills, shims) — async task classes deferred
  emitPreamble(ctx);

  // 2.5. Emit UI runtime (header structs + static tables) — entry file only,
  //      when a UI is mounted. File-scope, must precede any function using it.
  emitUIRuntime(ctx);

  // 3. Run top-level preprocessing (timing promotion, ISR extraction, pointer tracking)
  runTopLevelPreprocessing(ctx);

  // 4. Synthesize entrypoint functions (setup/main/loop)
  synthesizeEntrypoints(ctx);

  // 5. Emit type declarations (enums, type aliases, interfaces, top-level constants)
  emitTypeDeclarations(ctx);

  // 6. Emit namespaces
  emitNamespaces(ctx);

  // 6.5. Emit function forward declarations (split mode — must precede class
  // definitions; also precedes the async task classes below)
  emitFunctionForwardDeclarations(ctx);

  // 6.55. Early `extern` declarations for promoted runtime vars. Their real
  // forward declarations land in step 8, AFTER the task classes (6.6) and
  // user classes (7) that may reference them in TS source order — a class
  // method using a global declared later in the file is legal TS (methods
  // run post-init) but invalid C++ emission order without these externs.
  emitPromotedVarExterns(ctx);

  // 6.6. Async state machines — after globals (WIFI_SSID etc. in scope) AND
  // after the function forward declarations: task bodies call the user's
  // plain helper functions (`clamp`, `reportJson`) whose prototypes land in
  // 6.5. Before the reorder, every such call failed with "not declared in
  // this scope".
  emitAsyncTaskClasses(ctx);

  // 7. Emit classes
  emitClasses(ctx);

  // 7.5. Async-method tasks — after the owning classes (segments dereference
  // _owner->field on a complete type), before functions (loop pump + starters).
  emitAsyncMethodTasks(ctx);

  // 8. Emit post-class declarations (runtime vars, promoted vars, object literal structs)
  emitPostClassDeclarations(ctx);

  // 9. Emit callbacks + forward declarations + function definitions
  emitCallbackFunctions(ctx);
  emitFunctions(ctx);

  // 10. Finalize output (write files, source maps, post-processing)
  return finalizeOutput(ctx);
}
