import type { ProgramIR, Diagnostic } from "../../api/index.js";
import type { SafetyTransformContext } from "../../safety-hook.js";
import { asilLevel, ASIL_THRESHOLDS } from "./asil.js";

/** B1: No recursion (ISO 26262 Part 6, Table 8 — ASIL B+).
 *
 *  Only checks functions decorated with @asilB or higher.
 *  QM/ASIL A functions are skipped.
 *
 *  Builds a function call graph and runs DFS cycle detection. */
export function checkRecursion(
  program: ProgramIR,
  _ctx: SafetyTransformContext,
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // Build function set (only ASIL-annotated functions are checked)
  const asilFnNames = new Set<string>();
  for (const fn of program.functions) {
    if (asilLevel(fn.decorators) >= ASIL_THRESHOLDS.recursion) {
      asilFnNames.add(fn.originalName);
    }
  }
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (method.name && asilLevel(method.decorators) >= ASIL_THRESHOLDS.recursion) {
        asilFnNames.add(method.name);
      }
    }
  }

  if (asilFnNames.size === 0) return diags;

  // Build call graph (all functions, not just ASIL — callees matter)
  const callGraph = buildFunctionCallGraph(program);

  // DFS cycle detection — only report cycles involving ASIL functions
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const name of callGraph.keys()) {
    color.set(name, WHITE);
  }

  for (const entry of callGraph.keys()) {
    if (color.get(entry) === WHITE) {
      const path: string[] = [];
      dfs(entry, callGraph, color, path, (cycle) => {
        // Only report if any function in the cycle is ASIL-annotated
        if (cycle.some(name => asilFnNames.has(name))) {
          diags.push({
            severity: "error",
            code: "ISO26262_B1_RECURSION",
            message: `Recursion detected: ${cycle.join(" → ")}`,
            hint: "ASIL B+ requires bounded call depth. Refactor to an iterative loop or use a fixed-size memoization table.",
          });
        }
      });
    }
  }

  return diags;
}

function buildFunctionCallGraph(program: ProgramIR): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const allFnNames = new Set<string>();
  for (const fn of program.functions) {
    allFnNames.add(fn.originalName);
  }
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

function collectCallTargets(stmt: any, allFnNames: Set<string>, deps: Set<string>): void {
  if (!stmt || typeof stmt !== "object") return;
  if (stmt.kind === "call" && typeof stmt.callee === "string" && allFnNames.has(stmt.callee)) {
    deps.add(stmt.callee);
  }
  if (stmt.kind === "method-call" && typeof stmt.callee === "string" && allFnNames.has(stmt.callee)) {
    deps.add(stmt.callee);
  }
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
        const cycleStart = path.indexOf(next);
        const cycle = path.slice(cycleStart).concat(next);
        onCycle(cycle);
      } else if (nextColor === 0) {
        dfs(next, graph, color, path, onCycle);
      }
    }
  }

  path.pop();
  color.set(node, 2); // BLACK
}
