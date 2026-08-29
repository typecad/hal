import type { ProgramIR } from "../api/index.js";
import type { PlatformContext } from "./../types.js";
import type { RuntimePolyfillIR } from "../api/shared/index.js";
import { getStdLibSupport, generatePromiseRuntime } from "../api/shared/index.js";

/**
 * Build a RuntimePolyfillIR for the async Promise runtime, if the program
 * has async functions and the target architecture has stdlib support.
 */
export function buildAsyncRuntimePolyfill(
  program: ProgramIR,
  ctx: PlatformContext | undefined,
  target: string,
  queueCapacity?: number,
  strategy?: import("../api/shared/platform-strategy.js").PlatformStrategy,
): RuntimePolyfillIR | null {
  const hasAsync = program.functions.some(fn => fn.isAsync);
  if (!hasAsync) return null;

  const architecture = ctx?.architecture;
  const stdlib = getStdLibSupport(architecture);
  if (!stdlib.hasVector || !stdlib.hasString) return null;

  // Pass the strategy through so the runtime's now-expression matches the
  // target (generic bakes a std::chrono expression via currentTimeMillis()
  // instead of a millis() token the generic target never defines). When the
  // expression uses std::chrono, the polyfill must carry <chrono> itself —
  // the generic strategy's forcedIncludes are empty by design.
  const now = strategy?.currentTimeMillis?.() ?? "__tc_now_ms()";
  const requiredIncludes = ["<functional>", "<vector>", "<utility>", "<string>"];
  if (now.includes("std::chrono")) requiredIncludes.push("<chrono>");

  return {
    kind: "polyfill",
    id: "async_runtime",
    domain: "standard",
    requiredIncludes,
    forwardDeclarations: [],
    helperStructs: [generatePromiseRuntime(queueCapacity ?? 256, false, strategy)],
    helperFunctions: [],
    shimMacros: [],
    dependencies: [],
    hasPromiseRuntime: true,
  } as RuntimePolyfillIR & { hasPromiseRuntime: boolean };
}
