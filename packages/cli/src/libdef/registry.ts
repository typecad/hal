import fs from "node:fs";
import path from "node:path";
import { LibraryDefinition, LibraryDefinitionCondition, PlatformContext, TargetProfile } from "../types";
import { listFiles, readText } from "../utils/fs";
import { toModuleKey, toPascalCase } from "../utils/strings";
import { toArchitectureFromFqbn } from "../utils/toolchain";
import { ImportIR } from "../ir/model";

export interface ResolvedImport {
  include: string;
  symbolMap: Record<string, string>;
}

export function loadLibraryDefinitions(definitionsDir: string): Map<string, LibraryDefinition> {
  const registry = new Map<string, LibraryDefinition>();
  const files = listFiles(definitionsDir, ".libdef.json");

  for (const filePath of files) {
    const jsonText = readText(filePath);
    const def = JSON.parse(jsonText) as LibraryDefinition;
    if (!def.module || !def.include) {
      continue;
    }
    registry.set(toModuleKey(def.module), def);
  }

  return registry;
}

function fallbackInclude(moduleSpecifier: string): string {
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
  const arduino = context?.arduino;
  const architecture = toArchitectureFromFqbn(arduino?.fqbn);

  if (condition.target && condition.target !== target) {
    return false;
  }

  if (condition.architecture && architecture !== condition.architecture.toLowerCase()) {
    return false;
  }

  if (condition.fqbnIncludes && !(arduino?.fqbn ?? "").toLowerCase().includes(condition.fqbnIncludes.toLowerCase())) {
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

export function generateLibdefStubs(inputFile: string, imports: ImportIR[], outDir: string): string[] {
  const created: string[] = [];

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const item of imports) {
    const moduleKey = toModuleKey(item.moduleSpecifier);
    const libdefPath = path.join(outDir, `${moduleKey}.libdef.json`);

    if (!fs.existsSync(libdefPath)) {
      const include = `<${toPascalCase(moduleKey)}.h>`;
      const libdefContent = {
        module: moduleKey,
        include,
        symbols: Object.fromEntries(item.namedImports.map((symbol) => [symbol, symbol])),
        source: inputFile,
      };
      fs.writeFileSync(libdefPath, JSON.stringify(libdefContent, null, 2) + "\n", "utf8");
      created.push(libdefPath);
    }
  }

  return created;
}
