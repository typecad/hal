import { RuntimePolyfillIR } from "./types";

export interface EmittedPolyfillCode {
  includes: string[];
  declarations: string[];
  definitions: string[];
}

/**
 * Emit C++ boilerplate from polyfill IR
 */
export function emitPolyfillBoilerplate(polyfills: RuntimePolyfillIR[]): EmittedPolyfillCode {
  const result: EmittedPolyfillCode = {
    includes: [],
    declarations: [],
    definitions: [],
  };

  // Track included headers to avoid duplicates
  const includedHeaders = new Set<string>();

  for (const polyfill of polyfills) {
    // Add required includes
    for (const include of polyfill.requiredIncludes) {
      const normalizedInclude = normalizeInclude(include);
      if (!includedHeaders.has(normalizedInclude)) {
        includedHeaders.add(normalizedInclude);
        result.includes.push(normalizedInclude);
      }
    }

    // Add forward declarations
    for (const decl of polyfill.forwardDeclarations) {
      result.declarations.push(decl);
    }

    // Add helper structs
    for (const struct of polyfill.helperStructs) {
      result.definitions.push(struct.trim());
    }

    // Add helper functions
    for (const func of polyfill.helperFunctions) {
      result.definitions.push(func.trim());
    }

    // Add shim macros (as comments for documentation)
    for (const macro of polyfill.shimMacros) {
      result.declarations.push(macro);
    }
  }

  return result;
}

/**
 * Normalize include directive format
 */
function normalizeInclude(include: string): string {
  if (include.startsWith("<") || include.startsWith("\"")) {
    return include;
  }
  return `<${include}>`;
}

/**
 * Render all polyfill code as a single string block
 */
export function renderPolyfillBlock(polyfills: RuntimePolyfillIR[]): string {
  const emitted = emitPolyfillBoilerplate(polyfills);
  const lines: string[] = [];

  // Add includes
  if (emitted.includes.length > 0) {
    for (const include of emitted.includes) {
      lines.push(`#include ${include}`);
    }
    lines.push("");
  }

  // Add declarations (macros, etc.)
  if (emitted.declarations.length > 0) {
    for (const decl of emitted.declarations) {
      lines.push(decl);
    }
    lines.push("");
  }

  // Add definitions (structs, functions)
  if (emitted.definitions.length > 0) {
    for (const def of emitted.definitions) {
      lines.push(def);
      lines.push("");
    }
  }

  return lines.join("\n");
}