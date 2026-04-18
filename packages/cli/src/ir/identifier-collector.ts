import { ExpressionIR, StatementIR } from "./model";

/**
 * Shared utility for collecting identifiers from IR nodes.
 * This consolidates duplicate logic that was previously in:
 * - transpile.ts (collectExpressionIdentifiers, collectStatementIdentifiers)
 * - call-graph.ts (collectExpressionIdentifiers, collectStatementIdentifiers)
 * - build-ir.ts (similar traversal logic)
 */

/**
 * Collect all identifiers from an expression IR node.
 * Returns a Set of identifier names found.
 */
export function collectExpressionIdentifiers(expr: ExpressionIR | null | undefined): Set<string> {
  const identifiers = new Set<string>();

  // Safety check
  if (!expr || typeof expr !== "object" || !expr.kind) {
    return identifiers;
  }

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

    case "binary":
      for (const id of collectExpressionIdentifiers(expr.left)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(expr.right)) {
        identifiers.add(id);
      }
      break;

    case "unary":
      for (const id of collectExpressionIdentifiers(expr.operand)) {
        identifiers.add(id);
      }
      break;

    case "property-access":
      for (const id of collectExpressionIdentifiers(expr.object)) {
        identifiers.add(id);
      }
      break;

    case "typecode-call":
      for (const id of collectExpressionIdentifiers({ kind: "identifier", value: expr.receiver } as ExpressionIR)) {
        identifiers.add(id);
      }
      for (const arg of expr.args) {
        for (const id of collectExpressionIdentifiers(arg)) {
          identifiers.add(id);
        }
      }
      break;

    case "template_string":
      for (const id of collectExpressionIdentifiers(expr.expression)) {
        identifiers.add(id);
      }
      break;

    case "string_concat":
      for (const part of expr.parts) {
        for (const id of collectExpressionIdentifiers(part)) {
          identifiers.add(id);
        }
      }
      break;

    case "callback":
      // Callbacks have nested statements
      for (const stmt of expr.statements) {
        for (const id of collectStatementIdentifiers(stmt)) {
          identifiers.add(id);
        }
      }
      break;

    // number, string, boolean have no identifiers
  }

  return identifiers;
}

/**
 * Collect all identifiers from a statement IR node.
 * Returns a Set of identifier names found.
 */
export function collectStatementIdentifiers(statement: StatementIR | null | undefined): Set<string> {
  const identifiers = new Set<string>();

  // Safety check
  if (!statement || typeof statement !== "object" || !statement.kind) {
    return identifiers;
  }

  switch (statement.kind) {
    case "call":
      // Extract function/method name from callee
      const calleeParts = statement.callee.split(/[.(]/);
      identifiers.add(calleeParts[0]);
      // Also add the full callee (e.g. "Serial.begin") for polyfill detection
      identifiers.add(statement.callee);
      for (const arg of statement.args) {
        for (const id of collectExpressionIdentifiers(arg)) {
          identifiers.add(id);
        }
      }
      break;

    case "typecode-call":
      identifiers.add(statement.receiver);
      for (const arg of statement.args) {
        for (const id of collectExpressionIdentifiers(arg)) {
          identifiers.add(id);
        }
      }
      break;

    case "var_decl":
      identifiers.add(statement.name);
      if (statement.initializer) {
        for (const id of collectExpressionIdentifiers(statement.initializer)) {
          identifiers.add(id);
        }
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
      for (const id of collectStatementIdentifiers(statement.variable)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(statement.iterable)) {
        identifiers.add(id);
      }
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    case "for_in":
      for (const id of collectStatementIdentifiers(statement.variable)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(statement.object)) {
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
      if (statement.finallyBlock) {
        for (const nested of statement.finallyBlock) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
      }
      break;

    case "throw":
      for (const id of collectExpressionIdentifiers(statement.value)) {
        identifiers.add(id);
      }
      break;

    case "labeled":
      identifiers.add(statement.label);
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    case "block":
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    // break, continue have no identifiers
  }

  return identifiers;
}

/**
 * Collect all identifiers used in a ProgramIR.
 * This includes imports, functions, classes, enums, type aliases, and top-level statements.
 */
export function collectUsedIdentifiers(program: {
  imports: Array<{ moduleSpecifier: string; namedImports: string[] }>;
  functions: Array<{
    originalName: string;
    parameters: Array<{ name: string }>;
    statements: StatementIR[];
  }>;
  classes: Array<{
    name: string;
    fields: Array<{ name: string; initializer?: ExpressionIR }>;
    methods: Array<{
      name: string;
      parameters: Array<{ name: string }>;
      statements: StatementIR[];
    }>;
    constructor?: {
      parameters: Array<{ name: string }>;
      statements: StatementIR[];
    };
  }>;
  enums: Array<{ name: string; members: Array<{ name: string }> }>;
  typeAliases: Array<{ name: string }>;
  topLevelStatements: StatementIR[];
}): Set<string> {
  const identifiers = new Set<string>();

  // Collect from imports
  for (const imported of program.imports) {
    identifiers.add(imported.moduleSpecifier);
    for (const symbol of imported.namedImports) {
      identifiers.add(symbol);
    }
  }

  // Collect from functions
  for (const fn of program.functions) {
    identifiers.add(fn.originalName);
    for (const parameter of fn.parameters) {
      identifiers.add(parameter.name);
    }
    for (const statement of fn.statements) {
      for (const id of collectStatementIdentifiers(statement)) {
        identifiers.add(id);
      }
    }
  }

  // Collect from top-level statements
  for (const statement of program.topLevelStatements) {
    for (const id of collectStatementIdentifiers(statement)) {
      identifiers.add(id);
    }
  }

  // Collect from classes
  for (const cls of program.classes) {
    identifiers.add(cls.name);
    for (const field of cls.fields) {
      identifiers.add(field.name);
      if (field.initializer) {
        for (const id of collectExpressionIdentifiers(field.initializer)) {
          identifiers.add(id);
        }
      }
    }
    for (const method of cls.methods) {
      identifiers.add(method.name);
      for (const parameter of method.parameters) {
        identifiers.add(parameter.name);
      }
      for (const statement of method.statements) {
        for (const id of collectStatementIdentifiers(statement)) {
          identifiers.add(id);
        }
      }
    }
    if (cls.constructor) {
      for (const parameter of cls.constructor.parameters) {
        identifiers.add(parameter.name);
      }
      for (const statement of cls.constructor.statements) {
        for (const id of collectStatementIdentifiers(statement)) {
          identifiers.add(id);
        }
      }
    }
  }

  // Collect from enums
  for (const enumDef of program.enums) {
    identifiers.add(enumDef.name);
    for (const member of enumDef.members) {
      identifiers.add(member.name);
    }
  }

  // Collect from type aliases
  for (const typeAlias of program.typeAliases) {
    identifiers.add(typeAlias.name);
  }

  return identifiers;
}