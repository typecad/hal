// ---------------------------------------------------------------------------
// Heap / Memory Estimate Analysis
//
// Performs static analysis of the ProgramIR to estimate memory usage.
// This is a conservative approximation — actual usage depends on compiler
// optimizations and runtime behavior.
// ---------------------------------------------------------------------------

import type { ProgramIR, StructDefIR, ClassIR, FunctionIR, StatementIR, ExpressionIR, VariableDeclarationIR } from "../api/index.js";
import type { HeapEstimate } from "../diagnostics/json-schema.js";
import { parseCppType, renderCppType, bareType } from "../api/shared/cpp-type-ir.js";

/** Type sizes for common C++ types on 32-bit targets */
const ESP32_TYPE_SIZES: Record<string, number> = {
  bool: 1,
  char: 1,
  "unsigned char": 1,
  "signed char": 1,
  uint8_t: 1,
  int8_t: 1,
  byte: 1,
  short: 2,
  "unsigned short": 2,
  int16_t: 2,
  uint16_t: 2,
  int: 4,
  "unsigned int": 4,
  int32_t: 4,
  uint32_t: 4,
  long: 4,
  "unsigned long": 4,
  int64_t: 8,
  uint64_t: 8,
  float: 4,
  double: 8,
  "long long": 8,
  size_t: 4,
  ptrdiff_t: 4,
  pointer: 4,
  "char*": 4,
  "const char*": 4,
};

/**
 * Determine the type size table based on the target architecture.
 */
function getTypeSizes(architecture?: string): Record<string, number> {
  return ESP32_TYPE_SIZES;
}

/**
 * Estimate the size of a C++ type string.
 * Handles arrays like "int[10]" and pointers.
 */
function estimateTypeSize(cppType: string, typeSizes: Record<string, number>): number {
  const ir = parseCppType(cppType);

  // Fixed-size arrays: element[N] → element size × N.
  if (ir.kind === "staticArray" && ir.size !== undefined) {
    return estimateTypeSize(renderCppType(ir.element), typeSizes) * ir.size;
  }

  // Pointers.
  if (ir.kind === "pointer") {
    return typeSizes.pointer ?? 2;
  }

  // Normalize: strip const, references, etc., then look up the bare name.
  const normalized = renderCppType(bareType(ir));

  // Check known sizes
  if (typeSizes[normalized] !== undefined) {
    return typeSizes[normalized];
  }

  // For struct/class types, we return 0 here and handle in struct size analysis
  return 0;
}

/**
 * Estimate the size of a variable, falling back to the initializer when the
 * type-based estimate is zero. This handles array-typed variables whose
 * element count isn't in the type string:
 *   - `int32_t buf[] = {0,0,...}` (cArray with no size)
 *   - `std::vector<int32_t> buf = {...}` (vector — common before AVR promotion)
 *   - `__tc_StaticArray<int32_t, N> buf = {...}` (handled by estimateTypeSize
 *     when N is known, but the initializer fallback covers edge cases)
 * Without this, large unsized global arrays (the most common SRAM consumer on
 * AVR) are silently under-counted in the memory budget estimate.
 */
function estimateVariableSize(
  vd: VariableDeclarationIR,
  typeSizes: Record<string, number>,
): number {
  const typeSize = estimateTypeSize(vd.cppType, typeSizes);
  if (typeSize > 0) return typeSize;

  if (!vd.initializer) return 0;

  // Determine the element count and element type from the initializer.
  const init = vd.initializer as { kind?: string; elements?: ExpressionIR[]; elementType?: string; value?: string };
  let count = 0;
  let elementType = "";

  if (init.kind === "array" && Array.isArray(init.elements)) {
    count = init.elements.length;
    elementType = init.elementType ?? "";
  } else if (init.kind === "raw" && typeof init.value === "string") {
    const match = init.value.match(/^\s*\{([\s\S]*)\}\s*$/);
    if (match) {
      const inner = match[1].trim();
      count = inner === "" ? 0 : inner.split(",").length;
    }
  }

  if (count === 0) return 0;

  // Recover the element type from the cppType if the initializer didn't carry it.
  if (!elementType) {
    const ir = parseCppType(vd.cppType);
    // cArray: element field holds the element type IR.
    // std::vector<T> / __tc_StaticArray<T,N>: element field holds T.
    const arrayLike = ir as { element?: unknown };
    if (arrayLike.element && typeof arrayLike.element === "object") {
      elementType = renderCppType(arrayLike.element as Parameters<typeof renderCppType>[0]);
    } else {
      // Fallback: try to extract from the raw type string (e.g. "std::vector<int32_t>").
      const m = vd.cppType.match(/<[ \t]*(\w+)[ \t]*>/);
      if (m) elementType = m[1];
    }
  }

  const elementSize = estimateTypeSize(elementType, typeSizes);
  if (elementSize > 0) return elementSize * count;

  return 0;
}

/**
 * Estimate the size of a struct or class from its fields.
 */
function estimateStructSize(
  def: StructDefIR | ClassIR,
  typeSizes: Record<string, number>,
  structSizes: Record<string, number>,
): number {
  let total = 0;
  const fields = "fields" in def ? def.fields : (def as ClassIR).fields;
  if (fields) {
    for (const field of fields) {
      total += estimateTypeSize(field.cppType, typeSizes);
    }
  }
  return total;
}

/**
 * Walk expression IR to find string literals.
 */
function collectStringLiterals(
  expr: ExpressionIR,
  literals: { value: string; estimatedBytes: number }[],
): void {
  if (!expr) return;

  // Work around type re-export issues with ExpressionIR union
  const e = expr as any;
  if (e.kind === "string") {
    const value = e.value ?? "";
    // C string: length + null terminator
    const bytes = value.length + 1;
    // Deduplicate (optional — keep simple for now)
    literals.push({ value, estimatedBytes: bytes });
  }

  if (e.kind === "binary") {
    collectStringLiterals(e.left, literals);
    collectStringLiterals(e.right, literals);
  }
}

/**
 * Walk statements to find string literals in expressions.
 */
function collectStatementsStringLiterals(
  stmts: StatementIR[],
  literals: { value: string; estimatedBytes: number }[],
): void {
  if (!stmts || !Array.isArray(stmts)) return;
  for (const stmt of stmts) {
    const s = stmt as any;
    if (s.kind === "var_decl") {
      const vd = stmt as VariableDeclarationIR;
      if (vd.initializer) {
        collectStringLiterals(vd.initializer, literals);
      }
    } else if (s.kind === "expr_stmt") {
      if (s.expression) {
        collectStringLiterals(s.expression, literals);
      }
    }
  }
}

/**
 * Estimate stack depth and return the deepest paths.
 */
function estimateStackDepth(
  callGraphNodes: Map<string, { dependencies: Set<string> }>,
  entryPoints: string[],
): { depth: number; paths: string[][] } {
  const visited = new Set<string>();
  let maxDepth = 0;
  let deepestPaths: string[][] = [];

  function dfs(name: string, depth: number, currentPath: string[]) {
    if (depth > 30) return; // guard against infinite recursion
    
    const newPath = [...currentPath, name];
    visited.add(name);

    if (depth > maxDepth) {
      maxDepth = depth;
      deepestPaths = [newPath];
    } else if (depth === maxDepth && maxDepth > 0) {
      deepestPaths.push(newPath);
    }

    const node = callGraphNodes.get(name);
    if (node) {
      for (const dep of node.dependencies) {
        if (!visited.has(dep)) {
          dfs(dep, depth + 1, newPath);
        }
      }
    }
  }

  for (const entry of entryPoints) {
    visited.clear();
    dfs(entry, 1, []);
  }

  return { depth: maxDepth, paths: deepestPaths.slice(0, 5) }; // Return top 5 deepest paths
}

/**
 * Perform heap/memory estimate analysis on a ProgramIR.
 */
export function analyzeHeapUsage(
  program: ProgramIR | null,
  architecture?: string,
  callGraphNodes?: Map<string, { dependencies: Set<string> }>,
): HeapEstimate {
  const typeSizes = getTypeSizes(architecture);
  const globalVariables: { name: string; cppType: string; estimatedBytes: number }[] = [];
  const structSizes: Record<string, number> = {};
  const stringLiterals: { value: string; estimatedBytes: number }[] = [];
  const notes: string[] = [];
  let totalStaticBytes = 0;

  if (!program) {
    notes.push("No program IR available for heap analysis.");
    return {
      globalVariables: [],
      structSizes: {},
      stringLiterals: [],
      totalStaticBytes: 0,
      estimatedStackDepth: 0,
      stackPaths: [],
      notes,
    };
  }

  // Analyze struct sizes
  for (const struct of program.structs) {
    const size = estimateStructSize(struct, typeSizes, structSizes);
    structSizes[struct.name] = size;
    totalStaticBytes += size;
  }

  // Analyze class sizes
  for (const cls of program.classes) {
    const size = estimateStructSize(cls, typeSizes, structSizes);
    structSizes[cls.name] = size;
    totalStaticBytes += size;
  }

  // Analyze global variable declarations from top-level statements
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") {
      const vd = stmt as VariableDeclarationIR;
      const size = estimateVariableSize(vd, typeSizes);
      if (size > 0) {
        globalVariables.push({
          name: vd.name,
          cppType: vd.cppType,
          estimatedBytes: size,
        });
        totalStaticBytes += size;
      } else {
        // Unknown type — might be a struct/class
        globalVariables.push({
          name: vd.name,
          cppType: vd.cppType,
          estimatedBytes: 0,
        });
      }
    }
  }

  // Analyze global variables declared inside functions (static locals)
  // and string literals from function bodies
  for (const fn of program.functions) {
    for (const stmt of fn.statements) {
      if (stmt.kind === "var_decl") {
        const vd = stmt as VariableDeclarationIR;
        const size = estimateVariableSize(vd, typeSizes);
        globalVariables.push({
          name: `${fn.originalName}::${vd.name}`,
          cppType: vd.cppType,
          estimatedBytes: size,
        });
        totalStaticBytes += size;
      }
    }
    collectStatementsStringLiterals(fn.statements, stringLiterals);
  }

  // Collect string literals from top-level statements
  collectStatementsStringLiterals(program.topLevelStatements, stringLiterals);

  // Sum string literal sizes
  let stringTotal = 0;
  for (const sl of stringLiterals) {
    stringTotal += sl.estimatedBytes;
  }
  totalStaticBytes += stringTotal;

  // Estimate stack depth from call graph
  const entryPoints = ["setup", "loop"];
  const stackInfo = callGraphNodes
    ? estimateStackDepth(callGraphNodes, entryPoints)
    : { depth: 0, paths: [] };

  // Add notes about approximations
  notes.push("Heap estimate is static only — dynamic allocations (malloc/new) are not tracked.");
  notes.push("String literals may be deduplicated by the compiler/linker.");
  notes.push(
    `Default sizes: int=${typeSizes.int ?? "?"} bytes, pointer=${typeSizes.pointer ?? "?"} bytes, float=${typeSizes.float ?? "?"} bytes.`,
  );

  return {
    globalVariables,
    structSizes,
    stringLiterals,
    totalStaticBytes,
    estimatedStackDepth: stackInfo.depth,
    stackPaths: stackInfo.paths,
    notes,
  };
}