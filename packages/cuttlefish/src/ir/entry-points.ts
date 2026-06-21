import { ProgramIR, StatementIR, ExpressionIR } from "../api/index.js";

/**
 * Configuration for entry point detection
 */
export interface EntryPointConfig {
  /** Default entry points when none are explicitly provided */
  defaultEntryPoints: string[];
  /** Additional custom entry points */
  customEntryPoints: string[];
}

/**
 * Default entry point configuration (internal)
 */
const DEFAULT_ENTRY_POINT_CONFIG: EntryPointConfig = {
  defaultEntryPoints: ["main"],
  customEntryPoints: [],
};

/**
 * Detect entry points for a program.
 *
 * @param program  The IR program to analyze
 * @param config   Entry point configuration
 * @param entryPointNames  Explicit entry point names (overrides config defaults).
 *                         Derived from the platform strategy's `entrypointFunctionName()`
 *                         and `requiresLoopFunction()` at the call site.
 */
export function detectEntryPoints(
  program: ProgramIR,
  config: Partial<EntryPointConfig> = {},
  entryPointNames?: string[],
): Set<string> {
  const effectiveConfig = { ...DEFAULT_ENTRY_POINT_CONFIG, ...config };
  const entryPoints = new Set<string>();

  // Always include top-level statements as an entry point
  entryPoints.add("__top_level__");

  // Get defined function names
  const definedFunctions = new Set(program.functions.map((fn) => fn.originalName));

  // Get defined class names
  const definedClasses = new Set(program.classes.map((cls) => cls.name));

  // Add target-specific entry points
  const targetEntryPoints = entryPointNames ?? effectiveConfig.defaultEntryPoints;

  for (const entryPoint of targetEntryPoints) {
    if (definedFunctions.has(entryPoint)) {
      entryPoints.add(entryPoint);
    }
  }

  // Add custom entry points
  const definedEnums = new Set(program.enums.map((e) => e.name));
  for (const entryPoint of effectiveConfig.customEntryPoints) {
    if (definedFunctions.has(entryPoint) || definedClasses.has(entryPoint) || definedEnums.has(entryPoint)) {
      entryPoints.add(entryPoint);
    }
  }

  // Detect classes instantiated at top level
  const topLevelInstantiatedClasses = detectTopLevelInstantiations(program);
  for (const className of topLevelInstantiatedClasses) {
    entryPoints.add(className);
  }

  // Detect functions called at top level
  const topLevelCalledFunctions = detectTopLevelCalls(program);
  for (const functionName of topLevelCalledFunctions) {
    if (definedFunctions.has(functionName)) {
      entryPoints.add(functionName);
    }
  }

  return entryPoints;
}

/**
 * Detect classes that are instantiated at the top level
 */
function detectTopLevelInstantiations(program: ProgramIR): Set<string> {
  const instantiatedClasses = new Set<string>();

  const checkExpression = (expr: ExpressionIR) => {
    if (expr.kind === "raw") {
      // Check for 'new ClassName(' pattern
      const newMatch = expr.value.match(/new\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (newMatch) {
        instantiatedClasses.add(newMatch[1]);
      }
    }

    // Recursively check nested expressions
    if (expr.kind === "array") {
      for (const element of expr.elements) {
        checkExpression(element);
      }
    } else if (expr.kind === "object") {
      for (const field of expr.fields) {
        checkExpression(field.value);
      }
    } else if (expr.kind === "ternary") {
      checkExpression(expr.condition);
      checkExpression(expr.whenTrue);
      checkExpression(expr.whenFalse);
    } else if (expr.kind === "await") {
      checkExpression(expr.value);
    } else if (expr.kind === "spread_array") {
      checkExpression(expr.spreadExpr);
      for (const element of expr.additionalElements) {
        checkExpression(element);
      }
    }
  };

  const checkStatement = (statement: StatementIR) => {
    if (statement.kind === "var_decl" && statement.initializer) {
      checkExpression(statement.initializer);
    } else if (statement.kind === "assign") {
      checkExpression(statement.value);
    } else if (statement.kind === "call") {
      for (const arg of statement.args) {
        checkExpression(arg);
      }
    } else if (statement.kind === "return" && statement.value) {
      checkExpression(statement.value);
    }

    // Check nested statements
    if ("body" in statement && Array.isArray(statement.body)) {
      for (const nested of statement.body as StatementIR[]) {
        checkStatement(nested);
      }
    }
    if ("thenBranch" in statement && Array.isArray(statement.thenBranch)) {
      for (const nested of statement.thenBranch as StatementIR[]) {
        checkStatement(nested);
      }
    }
    if ("elseBranch" in statement && Array.isArray(statement.elseBranch)) {
      for (const nested of statement.elseBranch as StatementIR[]) {
        checkStatement(nested);
      }
    }
  };

  for (const statement of program.topLevelStatements) {
    checkStatement(statement);
  }

  return instantiatedClasses;
}

/**
 * Detect functions that are called at the top level
 */
function detectTopLevelCalls(program: ProgramIR): Set<string> {
  const calledFunctions = new Set<string>();

  const checkStatement = (statement: StatementIR) => {
    if (statement.kind === "call") {
      // Extract the base function name (before any dot or parenthesis)
      const baseName = statement.callee.split(/[.(]/)[0];
      calledFunctions.add(baseName);
    }

    // Check nested statements
    if ("body" in statement && Array.isArray(statement.body)) {
      for (const nested of statement.body as StatementIR[]) {
        checkStatement(nested);
      }
    }
    if ("thenBranch" in statement && Array.isArray(statement.thenBranch)) {
      for (const nested of statement.thenBranch as StatementIR[]) {
        checkStatement(nested);
      }
    }
    if ("elseBranch" in statement && Array.isArray(statement.elseBranch)) {
      for (const nested of statement.elseBranch as StatementIR[]) {
        checkStatement(nested);
      }
    }
  };

  for (const statement of program.topLevelStatements) {
    checkStatement(statement);
  }

  return calledFunctions;
}

/**
 * Detect symbols in a program that are imported by other files in the project.
 * These become additional entry points for tree-shaking so they aren't
 * eliminated as "unused" when they are only used externally.
 *
 * @param program  The IR for one file
 * @param importedByOtherFiles  Symbol names that other files import from this one
 * @returns Set of symbol names that should be treated as entry points
 */
export function detectExportedEntryPoints(
  program: ProgramIR,
  importedByOtherFiles: Set<string>,
): Set<string> {
  const entryPoints = new Set<string>();

  if (importedByOtherFiles.size === 0) return entryPoints;

  const definedFunctions = new Set(program.functions.map(fn => fn.originalName));
  const definedClasses = new Set(program.classes.map(cls => cls.name));
  const definedEnums = new Set(program.enums.map(e => e.name));
  const definedTypeAliases = new Set(program.typeAliases.map(ta => ta.name));

  for (const symbol of importedByOtherFiles) {
    if (definedFunctions.has(symbol)) entryPoints.add(symbol);
    if (definedClasses.has(symbol)) entryPoints.add(symbol);
    if (definedEnums.has(symbol)) entryPoints.add(symbol);
    if (definedTypeAliases.has(symbol)) entryPoints.add(symbol);
  }

  return entryPoints;
}
