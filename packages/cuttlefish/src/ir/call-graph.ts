import { ProgramIR, StatementIR } from "../api/index.js";
import { collectExpressionIdentifiers, collectStatementIdentifiers } from "./identifier-collector.js";
import { parsedCollectNamedTypes } from "../api/shared/cpp-type-ir.js";

/**
 * Represents a node in the call graph
 */
interface CallGraphNode {
  /** Symbol name */
  name: string;
  /** Type of symbol */
  kind: "function" | "class" | "enum" | "variable" | "type_alias";
  /** Names of symbols this node references */
  dependencies: Set<string>;
  /** Source for debugging/diagnostics */
  source?: {
    line: number;
    column: number;
  };
}

/**
 * Call graph representing dependencies between symbols
 */
export interface CallGraph {
  /** All nodes in the graph, keyed by symbol name */
  nodes: Map<string, CallGraphNode>;
  /** Reverse mapping: symbol -> symbols that reference it */
  referencedBy: Map<string, Set<string>>;
}

/**
 * Build a call graph from program IR
 */
export function buildCallGraph(program: ProgramIR): CallGraph {
  const nodes = new Map<string, CallGraphNode>();
  const referencedBy = new Map<string, Set<string>>();

  // Helper to add a reference
  const addReference = (from: string, to: string) => {
    if (!referencedBy.has(to)) {
      referencedBy.set(to, new Set());
    }
    referencedBy.get(to)!.add(from);
  };

  // Process functions
  for (const fn of program.functions) {
    const dependencies = new Set<string>();

    // Add parameters as local (don't count as external dependencies)
    const localBindings = new Set(fn.parameters.map((p) => p.name));

    // Collect type references from parameter types (e.g. SampleWindow)
    for (const param of fn.parameters) {
      for (const match of parsedCollectNamedTypes(param.cppType)) {
        dependencies.add(match);
      }
    }

    // Collect identifiers from function body
    for (const statement of fn.statements) {
      for (const id of collectStatementIdentifiers(statement)) {
        if (!localBindings.has(id)) {
          dependencies.add(id);
        }
      }
    }

    nodes.set(fn.originalName, {
      name: fn.originalName,
      kind: "function",
      dependencies,
      source: {
        line: fn.sourceSpan.startLine,
        column: fn.sourceSpan.startColumn,
      },
    });

    // Update reverse mapping
    for (const dep of dependencies) {
      addReference(fn.originalName, dep);
    }
  }

  // Process classes
  for (const cls of program.classes) {
    const dependencies = new Set<string>();

    // Collect from fields
    for (const field of cls.fields) {
      if (field.initializer) {
        for (const id of collectExpressionIdentifiers(field.initializer)) {
          dependencies.add(id);
        }
      }
      // Field type might reference other classes
      for (const match of parsedCollectNamedTypes(field.cppType)) {
        if (match !== cls.name) dependencies.add(match);
      }
    }

    // Collect from constructor
    if (cls.constructor) {
      const localBindings = new Set(cls.constructor.parameters.map((p) => p.name));
      for (const statement of cls.constructor.statements) {
        for (const id of collectStatementIdentifiers(statement)) {
          if (!localBindings.has(id)) {
            dependencies.add(id);
          }
        }
      }
    }

    // Collect from methods
    for (const method of cls.methods) {
      const localBindings = new Set(method.parameters.map((p) => p.name));
      for (const statement of method.statements) {
        for (const id of collectStatementIdentifiers(statement)) {
          if (!localBindings.has(id)) {
            dependencies.add(id);
          }
        }
      }
    }

    nodes.set(cls.name, {
      name: cls.name,
      kind: "class",
      dependencies,
      source: {
        line: cls.sourceSpan.startLine,
        column: cls.sourceSpan.startColumn,
      },
    });

    // Update reverse mapping
    for (const dep of dependencies) {
      addReference(cls.name, dep);
    }
  }

  // Process enums
  for (const enumDef of program.enums) {
    // Enums might reference other enums for values, but typically are leaf nodes
    nodes.set(enumDef.name, {
      name: enumDef.name,
      kind: "enum",
      dependencies: new Set(),
      source: {
        line: enumDef.sourceSpan.startLine,
        column: enumDef.sourceSpan.startColumn,
      },
    });
  }

  // Process type aliases
  for (const typeAlias of program.typeAliases) {
    const dependencies = new Set<string>();
    for (const match of parsedCollectNamedTypes(typeAlias.cppType)) {
      dependencies.add(match);
    }

    nodes.set(typeAlias.name, {
      name: typeAlias.name,
      kind: "type_alias",
      dependencies,
      source: {
        line: typeAlias.sourceSpan.startLine,
        column: typeAlias.sourceSpan.startColumn,
      },
    });

    for (const dep of dependencies) {
      addReference(typeAlias.name, dep);
    }
  }

  // Process top-level statements.
  // Named var_decl statements get their own nodes so they can be
  // individually tree-shaken.  All other (non-var_decl) statements
  // contribute to the special __top_level__ node.
  const topLevelDependencies = new Set<string>();
  for (const statement of program.topLevelStatements) {
    if (statement.kind === "var_decl") {
      const varDeps = new Set<string>();
      if (statement.initializer) {
        for (const id of collectExpressionIdentifiers(statement.initializer)) {
          varDeps.add(id);
          topLevelDependencies.add(id);
        }
      }
      nodes.set(statement.name, {
        name: statement.name,
        kind: "variable",
        dependencies: varDeps,
      });
      for (const dep of varDeps) {
        addReference(statement.name, dep);
      }
    } else {
      for (const id of collectStatementIdentifiers(statement)) {
        topLevelDependencies.add(id);
      }
    }
  }

  // Registered callbacks from the HAL resolver (e.g. the arrow function passed
  // to `Ble.characteristic(...).onRead(() => readTemp())`) are NOT present in
  // top-level statements — they ride in `program.registeredCallbacks` and are
  // later hoisted to file-scope `*_isr_*` functions by top-level-prep. The
  // placeholder name (`__CALLBACK_N__`) is what surfaces in top-level deps,
  // not the identifiers the callback body references (e.g. a free function
  // like `readTemp`). Without this scan those references are invisible to the
  // call graph: the function survives the hoist (its call sits inside the
  // emitted ISR) but is tree-shaken as unreachable, and g++ later reports it
  // "not declared in this scope". Attach their body identifiers to
  // __top_level__ since the callbacks execute from the top-level entry path.
  for (const rc of (program.registeredCallbacks ?? [])) {
    for (const id of collectExpressionIdentifiers(rc.callbackIR)) {
      topLevelDependencies.add(id);
    }
  }

  nodes.set("__top_level__", {
    name: "__top_level__",
    kind: "variable",
    dependencies: topLevelDependencies,
  });

  for (const dep of topLevelDependencies) {
    addReference("__top_level__", dep);
  }

  return { nodes, referencedBy };
}

/**
 * Get all symbols reachable from a starting set
 */
export function getReachableSymbols(
  graph: CallGraph,
  entryPoints: Set<string>
): Set<string> {
  const reachable = new Set<string>();
  const worklist = [...entryPoints];

  while (worklist.length > 0) {
    const current = worklist.pop()!;
    if (reachable.has(current)) {
      continue;
    }
    reachable.add(current);

    const node = graph.nodes.get(current);
    if (node) {
      for (const dep of node.dependencies) {
        if (!reachable.has(dep)) {
          worklist.push(dep);
        }
      }
    }
  }

  return reachable;
}
