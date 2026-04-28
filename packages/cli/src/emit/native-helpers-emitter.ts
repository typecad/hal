import type { RuntimePolyfillIR } from "@typehal/core/shared";

export interface EmittedPolyfillCode {
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

function normalizeInclude(include: string): string {
  if (include.startsWith("<") || include.startsWith("\"")) {
    return include;
  }
  return `<${include}>`;
}
