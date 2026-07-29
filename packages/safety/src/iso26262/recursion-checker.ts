import type { ProgramIR, Diagnostic } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

/** B1: No recursion (ISO 26262 Part 6, Table 8 — ASIL C/D).
 *
 *  Builds a call graph from the program's IR and runs cycle detection
 *  via DFS with a recursion stack. Any back-edge in the DFS indicates a
 *  cycle (mutual recursion or self-recursion).
 *
 *  Returns one diagnostic per detected cycle, naming the functions involved. */
export function checkRecursion(
  program: ProgramIR,
  _ctx: SafetyTransformContext,
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // Build a simple function-dependency map: function name → set of called function names.
  // We scan each function's statements for "call" and "method-call" IR nodes.
  const callGraph = buildFunctionCallGraph(program);

  // DFS cycle detection using recursion stack
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const name of callGraph.keys()) {
    color.set(name, WHITE);
  }

  for (const entry of callGraph.keys()) {
    if (color.get(entry) === WHITE) {
      const path: string[] = [];
      dfs(entry, callGraph, color, path, (cycle) => {
        diags.push({
          severity: "error",
          code: "ISO26262_B1_RECURSION",
          message: `Recursion detected: ${cycle.join(" → ")}`,
          hint: "ASIL C/D requires bounded call depth. Refactor to an iterative loop or use a fixed-size memoization table.",
        });
      });
    }
  }

  return diags;
}

/** Build a map of function name → set of function names it calls. */
function buildFunctionCallGraph(program: ProgramIR): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const allFnNames = new Set<string>();
  for (const fn of program.functions) {
    allFnNames.add(fn.originalName);
  }
  // Also class methods
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (method.name) allFnNames.add(method.name);
    }
  }

  for (const fn of program.functions) {
    const name = fn.originalName;
    const deps = new Set<string>();
    for (const stmt of fn.statements) {
      collectCallTargets(stmt, allFnNames, deps);
    }
    graph.set(name, deps);
  }

  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (!method.name) continue;
      const deps = new Set<string>();
      for (const stmt of method.statements) {
        collectCallTargets(stmt, allFnNames, deps);
      }
      // Merge with existing (top-level function might have same name)
      const existing = graph.get(method.name);
      if (existing) {
        for (const d of deps) existing.add(d);
      } else {
        graph.set(method.name, deps);
      }
    }
  }

  return graph;
}

/** Recursively walk a statement and collect function-call targets. */
function collectCallTargets(stmt: any, allFnNames: Set<string>, deps: Set<string>): void {
  if (!stmt || typeof stmt !== "object") return;
  if (stmt.kind === "call" && typeof stmt.callee === "string" && allFnNames.has(stmt.callee)) {
    deps.add(stmt.callee);
  }
  if (stmt.kind === "method-call" && typeof stmt.callee === "string" && allFnNames.has(stmt.callee)) {
    deps.add(stmt.callee);
  }
  // Recurse into child statements/expressions
  for (const key of Object.keys(stmt)) {
    const val = stmt[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === "object" && typeof item.kind === "string") {
          collectCallTargets(item, allFnNames, deps);
        }
      }
    } else if (val && typeof val === "object" && typeof val.kind === "string") {
      collectCallTargets(val, allFnNames, deps);
    }
  }
}

/** DFS with back-edge detection. Calls onCycle when a cycle is found. */
function dfs(
  node: string,
  graph: Map<string, Set<string>>,
  color: Map<string, number>,
  path: string[],
  onCycle: (cycle: string[]) => void,
): void {
  color.set(node, 1); // GRAY
  path.push(node);

  const neighbors = graph.get(node);
  if (neighbors) {
    for (const next of neighbors) {
      const nextColor = color.get(next);
      if (nextColor === 1) {
        // GRAY — back-edge: found a cycle. Extract the cycle path.
        const cycleStart = path.indexOf(next);
        const cycle = path.slice(cycleStart).concat(next);
        onCycle(cycle);
      } else if (nextColor === 0) {
        // WHITE — unvisited
        dfs(next, graph, color, path, onCycle);
      }
    }
  }

  path.pop();
  color.set(node, 2); // BLACK
}
