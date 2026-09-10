import fs from "node:fs";
import path from "node:path";
import type { LibraryDefinition } from "../types.js";
import { toModuleKey, toPascalCase } from "../utils/strings.js";
import type { ImportIR } from "../api/index.js";
import { getLoadedFramework, hasLoadedFramework } from "../framework-registry.js";

function getLibraryResolver() {
  if (hasLoadedFramework()) {
    const { libraryResolver } = getLoadedFramework();
    if (libraryResolver) return libraryResolver;
  }
  return {
    isFrameworkLibraryImport: (_s: string) => false as boolean,
    getFrameworkLibraryHeaderName: (_s: string) => undefined as string | undefined,
  };
}

interface ResolvedImport {
  include: string;
  symbolMap: Record<string, string>;
}

function fallbackInclude(moduleSpecifier: string): string {
  const resolver = getLibraryResolver();
  if (resolver.isFrameworkLibraryImport(moduleSpecifier)) {
    const actualHeader = resolver.getFrameworkLibraryHeaderName(moduleSpecifier);
    if (actualHeader) {
      return `<${actualHeader}>`;
    }
  }

  // Fallback to PascalCase conversion for other modules
  const key = toModuleKey(moduleSpecifier);
  const include = `${toPascalCase(key)}.h`;
  return `<${include}>`;
}

function resolveLocalModuleHeader(moduleSpecifier: string, importerFilePath: string): string | undefined {
  if (!moduleSpecifier.startsWith(".")) {
    return undefined;
  }

  const basePath = path.resolve(path.dirname(importerFilePath), moduleSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }

    const extension = path.extname(candidate).toLowerCase();
    if (extension !== ".ts" && extension !== ".tsx") {
      continue;
    }

    const headerBaseName = path.basename(candidate).replace(/\.[^.]+$/, "");
    return `"${headerBaseName}.h"`;
  }

  return undefined;
}

export function resolveImport(
  importNode: ImportIR,
  definitions: Map<string, LibraryDefinition>,
  importerFilePath?: string,
): ResolvedImport {
  if (importerFilePath) {
    const localInclude = resolveLocalModuleHeader(importNode.moduleSpecifier, importerFilePath);
    if (localInclude) {
      return {
        include: localInclude,
        symbolMap: Object.fromEntries(importNode.namedImports.map((symbol) => [symbol, symbol])),
      };
    }
  }

  const key = toModuleKey(importNode.moduleSpecifier);
  const definition = definitions.get(key);

  if (!definition) {
    return {
      include: fallbackInclude(importNode.moduleSpecifier),
      symbolMap: Object.fromEntries(importNode.namedImports.map((symbol) => [symbol, symbol])),
    };
  }

  return {
    include: definition.include,
    symbolMap: {
      ...Object.fromEntries(importNode.namedImports.map((symbol) => [symbol, symbol])),
      ...definition.symbols,
    },
  };
}
