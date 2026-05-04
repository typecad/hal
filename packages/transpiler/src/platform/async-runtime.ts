import type { ProgramIR } from "@typehal/core";
import type { PlatformContext } from "./../types";
import type { RuntimePolyfillIR } from "@typehal/core/shared";
import { getStdLibSupport, generatePromiseRuntime } from "@typehal/core/shared";

/**
 * Build a RuntimePolyfillIR for the async Promise runtime, if the program
 * has async functions and the target architecture has stdlib support.
 */
export function buildAsyncRuntimePolyfill(
  program: ProgramIR,
  ctx: PlatformContext | undefined,
  target: string,
  queueCapacity?: number,
): RuntimePolyfillIR | null {
  const hasAsync = program.functions.some(fn => fn.isAsync);
  if (!hasAsync) return null;

  const architecture = ctx?.architecture;
  const stdlib = getStdLibSupport(architecture);
  if (!stdlib.hasVector || !stdlib.hasString) return null;

  return {
    kind: "polyfill",
    id: "async_runtime",
    domain: "standard",
    requiredIncludes: ["<functional>", "<vector>", "<utility>", "<string>"],
    forwardDeclarations: [],
    helperStructs: [generatePromiseRuntime(queueCapacity ?? 256)],
    helperFunctions: [],
    shimMacros: [],
    dependencies: [],
    hasPromiseRuntime: true,
  } as RuntimePolyfillIR & { hasPromiseRuntime: boolean };
}
