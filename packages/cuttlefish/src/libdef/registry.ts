import fs from "node:fs";
import path from "node:path";
import { LibraryDefinition, LibraryDefinitionCondition, PlatformContext, TargetProfile } from "../types.js";
import { listFilesRecursive, readText } from "../utils/fs.js";
import { toModuleKey, toPascalCase } from "../utils/strings.js";
import type { ImportIR } from "../api/index.js";
import { getLoadedFramework, hasLoadedFramework } from "../framework-registry.js";

function toArchitectureFromFqbn(fqbn?: string): string | undefined {
  if (!fqbn) return undefined;
  return fqbn.split(":")[1];
}

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

export function loadLibraryDefinitions(definitionsDir: string): Map<string, LibraryDefinition> {
  const registry = new Map<string, LibraryDefinition>();
  // Recursive scan: libdefs may live at the entry dir (single-level convention)
  // or nested in project subdirectories (per-module overrides).
  const files = listFilesRecursive(definitionsDir, ".libdef.json");

  for (const filePath of files) {
    let def: LibraryDefinition;
    try {
      def = JSON.parse(readText(filePath)) as LibraryDefinition;
    } catch (e) {
      throw new Error(`Failed to parse library definition ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!def.module || !def.include) {
      continue;
    }
    registry.set(toModuleKey(def.module), def);
  }

  return registry;
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

function conditionMatches(condition: LibraryDefinitionCondition, target: TargetProfile, context?: PlatformContext): boolean {
  const architecture = context?.architecture ?? toArchitectureFromFqbn(
    (context?.frameworkData as { fqbn?: string } | undefined)?.fqbn
  );
  const fqbn = (context?.frameworkData as { fqbn?: string } | undefined)?.fqbn;

  if (condition.target && condition.target !== target) {
    return false;
  }

  if (condition.architecture && architecture !== condition.architecture.toLowerCase()) {
    return false;
  }

  if (condition.fqbnIncludes && !(fqbn ?? "").toLowerCase().includes(condition.fqbnIncludes.toLowerCase())) {
    return false;
  }

  return true;
}

export function resolveImport(
  importNode: ImportIR,
  definitions: Map<string, LibraryDefinition>,
  target: TargetProfile,
  platformContext?: PlatformContext,
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

  const selectedVariant = definition.variants?.find((variant) => conditionMatches(variant.when, target, platformContext));
  const include = selectedVariant?.include ?? definition.include;
  const mappedSymbols = selectedVariant?.symbols ?? definition.symbols ?? {};

  return {
    include,
    symbolMap: {
      ...Object.fromEntries(importNode.namedImports.map((symbol) => [symbol, symbol])),
      ...mappedSymbols,
    },
  };
}
