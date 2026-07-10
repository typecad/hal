import { ProgramIR } from "../api/index.js";
import { Diagnostic, TreeShakingOptions } from "../types.js";
import { ReachabilityResult } from "./reachability.js";

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

  // Filter type aliases. Keep an alias if it's reachable OR if its cppType is
  // a concrete type that will emit a valid `using` directive. The latter
  // rescues aliases-to-tuples/vectors/maps/pairs AND aliases-to-user-types
  // (Partial<T>/Pick/Omit resolve to the underlying struct name) that are used
  // as type annotations but whose names don't surface in the call graph
  // (because typeNodeToCppType resolves them away before the call graph scans).
  // Demo #8 fix F (tuples); demo #10 fix A (utility-type aliases).
  const filteredTypeAliases = program.typeAliases.filter((typeAlias) => {
    if (reachability.reachableTypeAliases.has(typeAlias.name)) return true;
    if (typeAlias.structFields && typeAlias.structFields.length > 0) return true;
    if (typeAlias.variantStructs && typeAlias.variantStructs.length > 0) return true;
    const cpp = typeAlias.cppType ?? "auto";
    if (cpp === "auto") return false;
    // Container/primitive prefixes (std::tuple, std::vector, etc.).
    if (/^(std::tuple|std::vector|std::map|std::set|std::pair|int|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|double|float|bool|std::string)/.test(cpp)) return true;
    // A simple user-type identifier (e.g. `Entry` from `Partial<Entry>`) —
    // `using X = Entry;` is valid C++ when Entry is a defined struct.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(cpp)) return true;
    return false;
  });

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
    ...(program.defaultExportName ? { defaultExportName: program.defaultExportName } : {}),
    ...(program.registeredCallbacks ? { registeredCallbacks: program.registeredCallbacks } : {}),
    ...(program.restParamFunctions ? { restParamFunctions: program.restParamFunctions } : {}),
  };
}
