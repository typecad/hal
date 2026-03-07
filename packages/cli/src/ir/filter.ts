import { ProgramIR } from "./model";
import { Diagnostic } from "../types";
import { ReachabilityResult } from "./reachability";

/**
 * Options for filtering program IR
 */
export interface FilterOptions {
  /** Enable tree-shaking (filter unreachable code) */
  enabled: boolean;
  /** Keep enums even if not referenced */
  keepUnusedEnums?: boolean;
  /** Keep classes even if not instantiated */
  keepUnusedClasses?: boolean;
  /** Keep type aliases even if not used */
  keepUnusedTypeAliases?: boolean;
  /** Keep top-level variables even if not referenced */
  keepUnusedVariables?: boolean;
  /** Generate diagnostics for removed code */
  reportUnused?: boolean;
}

/**
 * Default filter options
 */
export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  enabled: true,
  keepUnusedEnums: false,
  keepUnusedClasses: false,
  keepUnusedTypeAliases: false,
  keepUnusedVariables: false,
  reportUnused: false,
};

/**
 * Filter a program IR to remove unreachable code
 */
export function filterProgramIR(
  program: ProgramIR,
  reachability: ReachabilityResult,
  options: Partial<FilterOptions> = {}
): ProgramIR {
  const effectiveOptions = { ...DEFAULT_FILTER_OPTIONS, ...options };

  // If filtering is disabled, return original program
  if (!effectiveOptions.enabled) {
    return program;
  }

  // Filter functions
  const filteredFunctions = program.functions.filter((fn) =>
    reachability.reachableFunctions.has(fn.originalName)
  );

  // Filter classes
  const filteredClasses = program.classes.filter((cls) =>
    reachability.reachableClasses.has(cls.name)
  );

  // Filter enums
  const filteredEnums = program.enums.filter((enumDef) =>
    reachability.reachableEnums.has(enumDef.name)
  );

  // Filter type aliases
  const filteredTypeAliases = program.typeAliases.filter((typeAlias) =>
    reachability.reachableTypeAliases.has(typeAlias.name)
  );

  // Filter top-level var_decl statements based on variable reachability.
  // Non-var_decl statements (calls, loops, etc.) are always kept.
  const filteredTopLevelStatements = program.topLevelStatements.filter((stmt) => {
    if (stmt.kind === "var_decl") {
      return reachability.reachableVariables.has(stmt.name);
    }
    return true;
  });

  // Combine diagnostics
  const diagnostics: Diagnostic[] = [
    ...program.diagnostics,
    ...reachability.diagnostics,
  ];

  return {
    fileName: program.fileName,
    imports: program.imports,
    reExports: program.reExports,
    structs: program.structs,
    enums: filteredEnums,
    classes: filteredClasses,
    typeAliases: filteredTypeAliases,
    topLevelStatements: filteredTopLevelStatements,
    functions: filteredFunctions,
    boilerplates: program.boilerplates,
    diagnostics,
    boardConstants: program.boardConstants,
    interfaces: program.interfaces,
    namespaces: program.namespaces,
  };
}

/**
 * Create a shallow copy of program IR with filtered functions
 */
export function filterFunctions(
  program: ProgramIR,
  reachableFunctionNames: Set<string>
): ProgramIR {
  return {
    ...program,
    functions: program.functions.filter((fn) =>
      reachableFunctionNames.has(fn.originalName)
    ),
  };
}

/**
 * Create a shallow copy of program IR with filtered classes
 */
export function filterClasses(
  program: ProgramIR,
  reachableClassNames: Set<string>
): ProgramIR {
  return {
    ...program,
    classes: program.classes.filter((cls) => reachableClassNames.has(cls.name)),
  };
}

/**
 * Create a shallow copy of program IR with filtered enums
 */
export function filterEnums(
  program: ProgramIR,
  reachableEnumNames: Set<string>
): ProgramIR {
  return {
    ...program,
    enums: program.enums.filter((enumDef) =>
      reachableEnumNames.has(enumDef.name)
    ),
  };
}

/**
 * Create a shallow copy of program IR with filtered type aliases
 */
export function filterTypeAliases(
  program: ProgramIR,
  reachableTypeAliasNames: Set<string>
): ProgramIR {
  return {
    ...program,
    typeAliases: program.typeAliases.filter((typeAlias) =>
      reachableTypeAliasNames.has(typeAlias.name)
    ),
  };
}

/**
 * Get summary of what was filtered
 */
export function getFilterSummary(
  original: ProgramIR,
  filtered: ProgramIR
): {
  functionsRemoved: number;
  classesRemoved: number;
  enumsRemoved: number;
  typeAliasesRemoved: number;
  variablesRemoved: number;
  totalRemoved: number;
} {
  const functionsRemoved =
    original.functions.length - filtered.functions.length;
  const classesRemoved = original.classes.length - filtered.classes.length;
  const enumsRemoved = original.enums.length - filtered.enums.length;
  const typeAliasesRemoved =
    original.typeAliases.length - filtered.typeAliases.length;
  const variablesRemoved =
    original.topLevelStatements.filter((s) => s.kind === "var_decl").length -
    filtered.topLevelStatements.filter((s) => s.kind === "var_decl").length;
  const totalRemoved =
    functionsRemoved + classesRemoved + enumsRemoved + typeAliasesRemoved + variablesRemoved;

  return {
    functionsRemoved,
    classesRemoved,
    enumsRemoved,
    typeAliasesRemoved,
    variablesRemoved,
    totalRemoved,
  };
}
