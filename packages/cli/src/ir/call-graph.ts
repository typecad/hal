import { ProgramIR, StatementIR, ExpressionIR, FunctionIR, ClassIR, EnumIR } from "./model";

/**
 * Represents a node in the call graph
 */
export interface CallGraphNode {
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

  // Helper to collect identifiers from an expression
  const collectExpressionIdentifiers = (expr: ExpressionIR): Set<string> => {
    const identifiers = new Set<string>();

    switch (expr.kind) {
      case "identifier":
        identifiers.add(expr.value);
        break;

      case "raw": {
        // Extract identifiers from raw expressions
        const matches = expr.value.match(/[A-Za-z_][A-Za-z0-9_]*/g);
        if (matches) {
          for (const match of matches) {
            identifiers.add(match);
          }
        }
        break;
      }

      case "await":
        for (const id of collectExpressionIdentifiers(expr.value)) {
          identifiers.add(id);
        }
        break;

      case "ternary":
        for (const id of collectExpressionIdentifiers(expr.condition)) {
          identifiers.add(id);
        }
        for (const id of collectExpressionIdentifiers(expr.whenTrue)) {
          identifiers.add(id);
        }
        for (const id of collectExpressionIdentifiers(expr.whenFalse)) {
          identifiers.add(id);
        }
        break;

      case "array":
        for (const element of expr.elements) {
          for (const id of collectExpressionIdentifiers(element)) {
            identifiers.add(id);
          }
        }
        break;

      case "object":
        for (const field of expr.fields) {
          for (const id of collectExpressionIdentifiers(field.value)) {
            identifiers.add(id);
          }
        }
        break;

      case "instanceof":
        for (const id of collectExpressionIdentifiers(expr.object)) {
          identifiers.add(id);
        }
        identifiers.add(expr.className);
        break;

      case "spread_array":
        for (const id of collectExpressionIdentifiers(expr.spreadExpr)) {
          identifiers.add(id);
        }
        for (const element of expr.additionalElements) {
          for (const id of collectExpressionIdentifiers(element)) {
            identifiers.add(id);
          }
        }
        break;

      // number, string, boolean have no identifiers
    }

    return identifiers;
  };

  // Helper to collect identifiers from a statement
  const collectStatementIdentifiers = (statement: StatementIR): Set<string> => {
    const identifiers = new Set<string>();

    switch (statement.kind) {
      case "call":
        // Extract function/method name from callee
        const calleeParts = statement.callee.split(/[.(]/);
        identifiers.add(calleeParts[0]);
        for (const arg of statement.args) {
          for (const id of collectExpressionIdentifiers(arg)) {
            identifiers.add(id);
          }
        }
        break;

      case "var_decl":
        for (const id of collectExpressionIdentifiers(statement.initializer ?? { kind: "number", value: 0 })) {
          identifiers.add(id);
        }
        break;

      case "assign":
        identifiers.add(statement.target);
        for (const id of collectExpressionIdentifiers(statement.value)) {
          identifiers.add(id);
        }
        break;

      case "update":
        identifiers.add(statement.target);
        break;

      case "return":
        if (statement.value) {
          for (const id of collectExpressionIdentifiers(statement.value)) {
            identifiers.add(id);
          }
        }
        break;

      case "while":
      case "do_while":
        for (const id of collectExpressionIdentifiers(statement.condition)) {
          identifiers.add(id);
        }
        for (const nested of statement.body) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
        break;

      case "if":
        for (const id of collectExpressionIdentifiers(statement.condition)) {
          identifiers.add(id);
        }
        for (const nested of statement.thenBranch) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
        for (const nested of statement.elseBranch ?? []) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
        break;

      case "for":
        if (statement.initializer) {
          for (const id of collectStatementIdentifiers(statement.initializer)) {
            identifiers.add(id);
          }
        }
        if (statement.condition) {
          for (const id of collectExpressionIdentifiers(statement.condition)) {
            identifiers.add(id);
          }
        }
        if (statement.increment) {
          for (const id of collectStatementIdentifiers(statement.increment)) {
            identifiers.add(id);
          }
        }
        for (const nested of statement.body) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
        break;

      case "for_of":
      case "for_in":
        for (const id of collectStatementIdentifiers(statement.variable)) {
          identifiers.add(id);
        }
        for (const id of collectExpressionIdentifiers(statement.kind === "for_of" ? statement.iterable : statement.object)) {
          identifiers.add(id);
        }
        for (const nested of statement.body) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
        break;

      case "switch":
        for (const id of collectExpressionIdentifiers(statement.expression)) {
          identifiers.add(id);
        }
        for (const caseClause of statement.cases) {
          if (caseClause.value) {
            for (const id of collectExpressionIdentifiers(caseClause.value)) {
              identifiers.add(id);
            }
          }
          for (const nested of caseClause.body) {
            for (const id of collectStatementIdentifiers(nested)) {
              identifiers.add(id);
            }
          }
        }
        break;

      case "try":
        if (statement.catchParam) {
          identifiers.add(statement.catchParam);
        }
        for (const nested of statement.tryBlock) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
        for (const nested of statement.catchBlock ?? []) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
        break;

      case "throw":
        for (const id of collectExpressionIdentifiers(statement.value)) {
          identifiers.add(id);
        }
        break;

      // break, continue have no identifiers
    }

    return identifiers;
  };

  // Process functions
  for (const fn of program.functions) {
    const dependencies = new Set<string>();

    // Add parameters as local (don't count as external dependencies)
    const localBindings = new Set(fn.parameters.map((p) => p.name));

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
      const typeMatches = field.cppType.match(/[A-Za-z_][A-Za-z0-9_]*/g);
      if (typeMatches) {
        for (const match of typeMatches) {
          if (match !== cls.name && !["int", "float", "bool", "void", "auto", "const", "char"].includes(match)) {
            dependencies.add(match);
          }
        }
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
    const typeMatches = typeAlias.cppType.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (typeMatches) {
      for (const match of typeMatches) {
        if (!["int", "float", "bool", "void", "auto", "const", "char", "std", "vector", "string", "function", "map", "set"].includes(match)) {
          dependencies.add(match);
        }
      }
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
