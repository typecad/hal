import { ProgramIR } from "../api";
import { Diagnostic, TreeShakingOptions } from "../types";
import { ReachabilityResult } from "./reachability";

const DEFAULT_TREE_SHAKING: TreeShakingOptions = {
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
  options: Partial<TreeShakingOptions> = {}
): ProgramIR {
  const effectiveOptions = { ...DEFAULT_TREE_SHAKING, ...options };

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
    registerClasses: program.registerClasses,
    boardConstants: program.boardConstants,
    interfaces: program.interfaces,
    namespaces: program.namespaces,
    peripheralUsage: program.peripheralUsage,
    requiredIncludes: program.requiredIncludes,
  };
}
