import { getArduinoLibraryClassNames, isArduinoLibraryImport } from "./arduino-libs";

// Module-level cache for Arduino library class name mappings.
// Maps module specifier -> (simple class name -> fully qualified name)
const arduinoClassNameCache = new Map<string, Map<string, string>>();

export interface ArduinoImportLike {
  moduleSpecifier: string;
  namedImports: string[];
}

export function buildArduinoClassNameMap(imports: ArduinoImportLike[]): Map<string, string> {
  const result = new Map<string, string>();

  for (const importedModule of imports) {
    if (!isArduinoLibraryImport(importedModule.moduleSpecifier)) {
      continue;
    }

    let classMap = arduinoClassNameCache.get(importedModule.moduleSpecifier);
    if (!classMap) {
      classMap = getArduinoLibraryClassNames(importedModule.moduleSpecifier);
      arduinoClassNameCache.set(importedModule.moduleSpecifier, classMap);
    }

    for (const [simpleName, fullName] of classMap) {
      result.set(simpleName, fullName);
    }
  }

  return result;
}
