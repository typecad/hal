import type { RuntimePolyfillIR } from "../api/shared/index.js";
import { normalizeInclude } from "./utils/include-resolver.js";

interface EmittedPolyfillCode {
  includes: string[];
  declarations: string[];
  definitions: string[];
}

/**
 * Emit C++ boilerplate from native helper IR (formerly polyfill IR).
 */
export function emitPolyfillBoilerplate(polyfills: RuntimePolyfillIR[]): EmittedPolyfillCode {
  const result: EmittedPolyfillCode = {
    includes: [],
    declarations: [],
    definitions: [],
  };

  const includedHeaders = new Set<string>();

  for (const polyfill of polyfills) {
    for (const include of polyfill.requiredIncludes) {
      const normalizedInclude = normalizeInclude(include);
      if (!includedHeaders.has(normalizedInclude)) {
        includedHeaders.add(normalizedInclude);
        result.includes.push(normalizedInclude);
      }
    }

    for (const decl of polyfill.forwardDeclarations) {
      result.declarations.push(decl);
    }

    for (const struct of polyfill.helperStructs) {
      result.definitions.push(struct.trim());
    }

    for (const func of polyfill.helperFunctions) {
      result.definitions.push(func.trim());
    }

    for (const macro of polyfill.shimMacros) {
      result.declarations.push(macro);
    }
  }

  return result;
}
