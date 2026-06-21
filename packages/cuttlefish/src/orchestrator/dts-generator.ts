import path from "node:path";
import fs from "node:fs";
import { generateDeclFromCpp } from "../libdef/cpp-to-decl.js";
import { getLoadedFramework, hasLoadedFramework } from "../framework-registry.js";

export function tryGenerateLibDecl(modulePath: string, file: string): string | undefined {
  try {
    if (hasLoadedFramework()) {
      const { libDeclGenerator } = getLoadedFramework();
      if (libDeclGenerator) {
        return libDeclGenerator(modulePath, file);
      }
    }
  } catch {
    // No loaded framework.
  }
  return undefined;
}

/**
 * Extracts module path from "Cannot find module" error messages.
 * Returns the module path (relative or bare module name), undefined otherwise.
 */
export function extractMissingModulePath(errorMessage: string): string | undefined {
  const match = errorMessage.match(/Cannot find module '([^']+)' or its corresponding type declarations/);
  return match ? match[1] : undefined;
}

/**
 * Attempts to find a .cpp file for a missing module.
 * Checks both direct path and index patterns.
 */
export function findCppForModule(fromFile: string, modulePath: string): string | undefined {
  const basePath = path.resolve(path.dirname(fromFile), modulePath);
  
  const candidates = [
    `${basePath}.cpp`,
    path.join(basePath, "index.cpp"),
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  
  return undefined;
}

/**
 * Auto-generates .d.ts files for C++ modules that are missing declarations.
 * Also tries to generate declarations for framework libraries.
 * Returns list of generated files.
 */
export function autoGenerateMissingDecls(
  files: string[],
  errors: string[]
): string[] {
  const generated: string[] = [];
  const processedModules = new Set<string>();
  
  for (const error of errors) {
    const modulePath = extractMissingModulePath(error);
    if (!modulePath || processedModules.has(modulePath)) {
      continue;
    }
    
    processedModules.add(modulePath);
    
    // Try relative C++ module first
    if (modulePath.startsWith(".")) {
      for (const file of files) {
        const cppPath = findCppForModule(file, modulePath);
        if (cppPath) {
          const result = generateDeclFromCpp(cppPath);
          if (result) {
            generated.push(result);
          }
          break;
        }
      }
    } else {
      // Try framework library for bare module imports
      for (const file of files) {
        const declPath = tryGenerateLibDecl(modulePath, file);
        if (declPath) {
          generated.push(declPath);
          break;
        }
      }
    }
  }
  
  return generated;
}
