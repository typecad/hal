import { ProgramIR, FunctionIR, ClassIR, EnumIR, TypeAliasIR } from "../api/index.js";
import { CallGraph, getReachableSymbols } from "./call-graph.js";
import { detectEntryPoints, EntryPointConfig } from "./entry-points.js";
import { TargetProfile, Diagnostic } from "../types.js";
import { resolveStrategy } from "../platform/registry.js";

/**
 * Result of reachability analysis
 */
export interface ReachabilityResult {
  /** Functions that are reachable from entry points */
  reachableFunctions: Set<string>;
  /** Classes that are reachable from entry points */
  reachableClasses: Set<string>;
  /** Enums that are reachable from entry points */
  reachableEnums: Set<string>;
  /** Type aliases that are reachable from entry points */
  reachableTypeAliases: Set<string>;
  /** Top-level variable names that are reachable from entry points */
  reachableVariables: Set<string>;
  /** Indices of reachable top-level statements */
  reachableTopLevelStatements: number[];
  /** Unreachable code items */
  unreachable: {
    functions: FunctionIR[];
    classes: ClassIR[];
    enums: EnumIR[];
    typeAliases: TypeAliasIR[];
  };
  /** Diagnostics for unreachable code */
  diagnostics: Diagnostic[];
}

/**
 * Options for reachability analysis (internal)
 */
interface ReachabilityOptions {
  /** Target platform */
  target: TargetProfile;
  /** Entry point configuration */
  entryPointConfig?: Partial<EntryPointConfig>;
  /** Keep enums even if not referenced */
  keepUnusedEnums?: boolean;
  /** Keep classes even if not instantiated */
  keepUnusedClasses?: boolean;
  /** Keep type aliases even if not used */
  keepUnusedTypeAliases?: boolean;
  /** Keep top-level variables even if not referenced */
  keepUnusedVariables?: boolean;
  /** Generate diagnostics for unreachable code */
  reportUnused?: boolean;
}

/**
 * Analyze reachability from entry points in a program
 */
export function analyzeReachability(
  program: ProgramIR,
  callGraph: CallGraph,
  options: ReachabilityOptions
): ReachabilityResult {
  const {
    target,
    entryPointConfig,
    keepUnusedEnums = false,
    keepUnusedClasses = false,
    keepUnusedTypeAliases = false,
    keepUnusedVariables = false,
    reportUnused = false,
  } = options;

  // Detect entry points — derive from platform strategy instead of hardcoded target strings
  const strategy = resolveStrategy(target);
  const strategyEntryPoints = strategy.requiresLoopFunction()
    ? [strategy.entrypointFunctionName(), "loop"]
    : [strategy.entrypointFunctionName()];
  const entryPoints = detectEntryPoints(program, entryPointConfig, strategyEntryPoints);

  // Get all reachable symbols from entry points
  const reachableSymbols = getReachableSymbols(callGraph, entryPoints);

  // Get defined symbols
  const definedFunctions = new Map<string, FunctionIR>();
  for (const fn of program.functions) {
    definedFunctions.set(fn.originalName, fn);
  }

  const definedClasses = new Map<string, ClassIR>();
  for (const cls of program.classes) {
    definedClasses.set(cls.name, cls);
  }

  const definedEnums = new Map<string, EnumIR>();
  for (const enumDef of program.enums) {
    definedEnums.set(enumDef.name, enumDef);
  }

  const definedTypeAliases = new Map<string, TypeAliasIR>();
  for (const typeAlias of program.typeAliases) {
    definedTypeAliases.set(typeAlias.name, typeAlias);
  }

  // Determine reachable items
  const reachableFunctions = new Set<string>();
  const reachableClasses = new Set<string>();
  const reachableEnums = new Set<string>();
  const reachableTypeAliases = new Set<string>();
  const reachableVariables = new Set<string>();

  // Collect names of top-level var_decl statements
  const definedVariables = new Set<string>();
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") {
      definedVariables.add(stmt.name);
    }
  }

  // All top-level statements are reachable by definition
  const reachableTopLevelStatements = program.topLevelStatements.map((_, index) => index);

  // Check each symbol for reachability
  for (const symbol of reachableSymbols) {
    if (definedFunctions.has(symbol)) {
      reachableFunctions.add(symbol);
    }
    if (definedClasses.has(symbol)) {
      reachableClasses.add(symbol);
    }
    if (definedEnums.has(symbol)) {
      reachableEnums.add(symbol);
    }
    if (definedTypeAliases.has(symbol)) {
      reachableTypeAliases.add(symbol);
    }
    if (definedVariables.has(symbol)) {
      reachableVariables.add(symbol);
    }
  }

  // Mark base classes as reachable when their derived classes are reachable.
  // The call graph only tracks direct references, not inheritance relationships.
  let changed = true;
  while (changed) {
    changed = false;
    for (const cls of program.classes) {
      if (reachableClasses.has(cls.name) && cls.extendsClass && !reachableClasses.has(cls.extendsClass)) {
        reachableClasses.add(cls.extendsClass);
        changed = true;
      }
    }
  }

  // Apply keep options
  if (keepUnusedEnums) {
    for (const [name] of definedEnums) {
      reachableEnums.add(name);
    }
  }

  if (keepUnusedClasses) {
    for (const [name] of definedClasses) {
      reachableClasses.add(name);
    }
  }

  if (keepUnusedTypeAliases) {
    for (const [name] of definedTypeAliases) {
      reachableTypeAliases.add(name);
    }
  }

  if (keepUnusedVariables) {
    for (const name of definedVariables) {
      reachableVariables.add(name);
    }
  }

  // Collect unreachable items
  const unreachableFunctions: FunctionIR[] = [];
  const unreachableClasses: ClassIR[] = [];
  const unreachableEnums: EnumIR[] = [];
  const unreachableTypeAliases: TypeAliasIR[] = [];

  const diagnostics: Diagnostic[] = [];

  for (const [name, fn] of definedFunctions) {
    if (!reachableFunctions.has(name)) {
      unreachableFunctions.push(fn);
      if (reportUnused) {
        diagnostics.push({
          severity: "info",
          message: `Function '${name}' is unreachable and will be removed from output.`,
          line: fn.sourceSpan.startLine,
          column: fn.sourceSpan.startColumn,
          code: "TS2CPP_UNREACHABLE_FUNCTION",
        });
      }
    }
  }

  for (const [name, cls] of definedClasses) {
    if (!reachableClasses.has(name)) {
      unreachableClasses.push(cls);
      if (reportUnused) {
        diagnostics.push({
          severity: "info",
          message: `Class '${name}' is unreachable and will be removed from output.`,
          line: cls.sourceSpan.startLine,
          column: cls.sourceSpan.startColumn,
          code: "TS2CPP_UNREACHABLE_CLASS",
        });
      }
    }
  }

  for (const [name, enumDef] of definedEnums) {
    if (!reachableEnums.has(name)) {
      unreachableEnums.push(enumDef);
      // NOTE: Enum reachability warnings are currently disabled because enums may be
      // referenced in type annotations or used for their type information without
      // appearing in the runtime dependency graph. An enum may be used to type a
      // variable or parameter, making it appear "unreachable" even though it was used.
      //
      // Future improvement: Track enum usage in type annotations and enable this
      // warning when we can accurately detect truly unused enums.
      //
      // if (reportUnused) {
      //   diagnostics.push({
      //     severity: "info",
      //     message: `Enum '${name}' is unreachable and will be removed from output.`,
      //     line: enumDef.sourceSpan.startLine,
      //     column: enumDef.sourceSpan.startColumn,
      //     code: "TS2CPP_UNREACHABLE_ENUM",
      //   });
      // }
    }
  }

  for (const [name, typeAlias] of definedTypeAliases) {
    if (!reachableTypeAliases.has(name)) {
      unreachableTypeAliases.push(typeAlias);
      // NOTE: Type alias reachability warnings are currently disabled because TypeScript
      // type aliases are compile-time only and don't always appear in the IR's dependency
      // graph. A type alias may be used for type annotations that get erased during
      // transpilation, making it appear "unreachable" even though it was used.
      //
      // Future improvement: Track type alias usage in type annotations and enable
      // this warning when we can accurately detect truly unused type aliases.
      //
      // if (reportUnused) {
      //   diagnostics.push({
      //     severity: "info",
      //     message: `Type alias '${name}' is unreachable and will be removed from output.`,
      //     line: typeAlias.sourceSpan.startLine,
      //     column: typeAlias.sourceSpan.startColumn,
      //     code: "TS2CPP_UNREACHABLE_TYPE_ALIAS",
      //   });
      // }
    }
  }

  return {
    reachableFunctions,
    reachableClasses,
    reachableEnums,
    reachableTypeAliases,
    reachableVariables,
    reachableTopLevelStatements,
    unreachable: {
      functions: unreachableFunctions,
      classes: unreachableClasses,
      enums: unreachableEnums,
      typeAliases: unreachableTypeAliases,
    },
    diagnostics,
  };
}

/**
 * Get statistics about reachability
 */
export function getReachabilityStats(
  program: ProgramIR,
  result: ReachabilityResult
): {
  totalFunctions: number;
  reachableFunctions: number;
  totalClasses: number;
  reachableClasses: number;
  totalEnums: number;
  reachableEnums: number;
  totalTypeAliases: number;
  reachableTypeAliases: number;
  reductionPercent: number;
} {
  const totalFunctions = program.functions.length;
  const totalClasses = program.classes.length;
  const totalEnums = program.enums.length;
  const totalTypeAliases = program.typeAliases.length;

  const reachableFunctions = result.reachableFunctions.size;
  const reachableClasses = result.reachableClasses.size;
  const reachableEnums = result.reachableEnums.size;
  const reachableTypeAliases = result.reachableTypeAliases.size;

  const totalItems = totalFunctions + totalClasses + totalEnums + totalTypeAliases;
  const reachableItems = reachableFunctions + reachableClasses + reachableEnums + reachableTypeAliases;

  const totalVariables = program.topLevelStatements.filter((s) => s.kind === "var_decl").length;
  const reachableVariableCount = result.reachableVariables.size;

  const totalAll = totalItems + totalVariables;
  const reachableAll = reachableItems + reachableVariableCount;
  const reductionPercent = totalAll > 0 ? ((totalAll - reachableAll) / totalAll) * 100 : 0;

  return {
    totalFunctions,
    reachableFunctions,
    totalClasses,
    reachableClasses,
    totalEnums,
    reachableEnums,
    totalTypeAliases,
    reachableTypeAliases,
    reductionPercent,
  };
}
