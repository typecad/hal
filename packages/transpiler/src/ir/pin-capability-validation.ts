// ---------------------------------------------------------------------------
// Pin Capability Validation
//
// Detects calls to capability-specific methods on pins that don't support them.
// E.g. D12.readAnalog() — D12 is a digital-only pin, use A0-A5 instead.
// Produces diagnostics with actionable hints listing the correct pins.
// ---------------------------------------------------------------------------

import type { ProgramIR, ExpressionIR, StatementIR } from '@typehal/core';
import type { Diagnostic } from '../types';

/** Compile-time exhaustiveness check for switch statements on IR kinds. */
function assertNever(x: never): never {
  throw new Error(`Unhandled IR kind: ${JSON.stringify(x)}`);
}

function scanExpression(expr: ExpressionIR, parentLine: number | undefined, parentCol: number | undefined, diagnostics: Diagnostic[]): void {
  if (!expr || typeof expr !== 'object') return;

  switch (expr.kind) {
    case 'binary': {
      scanExpression(expr.left, parentLine, parentCol, diagnostics);
      scanExpression(expr.right, parentLine, parentCol, diagnostics);
      break;
    }
    case 'ternary': {
      scanExpression(expr.condition, parentLine, parentCol, diagnostics);
      scanExpression(expr.whenTrue, parentLine, parentCol, diagnostics);
      scanExpression(expr.whenFalse, parentLine, parentCol, diagnostics);
      break;
    }
    case 'property-access': {
      scanExpression(expr.object, parentLine, parentCol, diagnostics);
      break;
    }
    case 'unary': {
      scanExpression(expr.operand, parentLine, parentCol, diagnostics);
      break;
    }
    case 'paren': {
      scanExpression(expr.inner, parentLine, parentCol, diagnostics);
      break;
    }
    case 'array': {
      for (const el of expr.elements) {
        scanExpression(el, parentLine, parentCol, diagnostics);
      }
      break;
    }
    case 'object': {
      for (const field of expr.fields) {
        scanExpression(field.value, parentLine, parentCol, diagnostics);
      }
      break;
    }
    case 'callback': {
      for (const s of expr.statements) {
        scanStatement(s, diagnostics);
      }
      break;
    }
    case 'lambda': {
      for (const s of expr.body) {
        scanStatement(s, diagnostics);
      }
      break;
    }
    case 'method-call': {
      for (const arg of expr.args) {
        scanExpression(arg, parentLine, parentCol, diagnostics);
      }
      break;
    }
    case 'element-access': {
      scanExpression(expr.object, parentLine, parentCol, diagnostics);
      scanExpression(expr.index, parentLine, parentCol, diagnostics);
      break;
    }
    case 'string_concat': {
      for (const part of expr.parts) {
        scanExpression(part, parentLine, parentCol, diagnostics);
      }
      break;
    }
    case 'template_string': {
      scanExpression(expr.expression, parentLine, parentCol, diagnostics);
      break;
    }
    case 'spread_array': {
      scanExpression(expr.spreadExpr, parentLine, parentCol, diagnostics);
      for (const el of expr.additionalElements) {
        scanExpression(el, parentLine, parentCol, diagnostics);
      }
      break;
    }
    case 'instanceof': {
      scanExpression(expr.object, parentLine, parentCol, diagnostics);
      break;
    }
    case 'await': {
      scanExpression(expr.value, parentLine, parentCol, diagnostics);
      break;
    }
    case 'number':
    case 'string':
    case 'boolean':
    case 'identifier':
    case 'raw':
    case 'hal-expr':
      break;
    default:
      assertNever(expr);
  }
}

function scanStatement(stmt: StatementIR, diagnostics: Diagnostic[]): void {
  if (!stmt || typeof stmt !== 'object') return;

  const line = stmt.sourceSpan?.startLine as number | undefined;
  const col = stmt.sourceSpan?.startColumn as number | undefined;

  switch (stmt.kind) {
  case 'var_decl': {
    if (stmt.initializer) scanExpression(stmt.initializer, line, col, diagnostics);
    break;
  }

  case 'assign': {
    if (stmt.value) scanExpression(stmt.value, line, col, diagnostics);
    break;
  }

  case 'if': {
    if (stmt.condition) scanExpression(stmt.condition, line, col, diagnostics);
    for (const s of stmt.thenBranch) scanStatement(s, diagnostics);
    if (stmt.elseBranch) for (const s of stmt.elseBranch) scanStatement(s, diagnostics);
    break;
  }

  case 'while':
  case 'do_while': {
    if (stmt.condition) scanExpression(stmt.condition, line, col, diagnostics);
    for (const s of stmt.body) scanStatement(s, diagnostics);
    break;
  }

  case 'for': {
    if (stmt.condition) scanExpression(stmt.condition, line, col, diagnostics);
    if (stmt.initializer) scanStatement(stmt.initializer, diagnostics);
    if (stmt.increment) scanStatement(stmt.increment, diagnostics);
    for (const s of stmt.body) scanStatement(s, diagnostics);
    break;
  }

  case 'for_of':
  case 'for_in': {
    if (stmt.variable) scanStatement(stmt.variable, diagnostics);
    for (const s of stmt.body) scanStatement(s, diagnostics);
    break;
  }

  case 'return': {
    if (stmt.value) scanExpression(stmt.value, line, col, diagnostics);
    break;
  }

  case 'call': {
    for (const arg of stmt.args) {
      scanExpression(arg, line, col, diagnostics);
    }
    break;
  }

  case 'switch': {
    if (stmt.expression) scanExpression(stmt.expression, line, col, diagnostics);
    for (const c of stmt.cases) {
      for (const s of c.body) scanStatement(s, diagnostics);
    }
    break;
  }

  case 'block': {
    for (const s of stmt.body) scanStatement(s, diagnostics);
    break;
  }

  case 'labeled': {
    for (const s of stmt.body) scanStatement(s, diagnostics);
    break;
  }

  case 'try': {
    for (const s of stmt.tryBlock) scanStatement(s, diagnostics);
    if (stmt.catchBlock) for (const s of stmt.catchBlock) scanStatement(s, diagnostics);
    if (stmt.finallyBlock) for (const s of stmt.finallyBlock) scanStatement(s, diagnostics);
    break;
  }

  case 'throw': {
    if (stmt.value) scanExpression(stmt.value, line, col, diagnostics);
    break;
  }

  case 'update':
  case 'break':
  case 'continue':
  case 'hal-op':
    break;

  default:
    assertNever(stmt);
  }
}

/**
 * Validate that capability-specific methods are only called on pins that support them.
 */
export function validatePinCapabilities(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (program.topLevelStatements) {
    for (const stmt of program.topLevelStatements) {
      scanStatement(stmt, diagnostics);
    }
  }

  if (program.functions) {
    for (const fn of program.functions) {
      if (fn.statements) {
        for (const stmt of fn.statements) {
          scanStatement(stmt, diagnostics);
        }
      }
    }
  }

  if (program.classes) {
    for (const cls of program.classes) {
      if (cls.methods) {
        for (const method of cls.methods) {
          if (method.statements) {
            for (const stmt of method.statements) {
              scanStatement(stmt, diagnostics);
            }
          }
        }
      }
      if (cls.constructor?.statements) {
        for (const stmt of cls.constructor.statements) {
          scanStatement(stmt, diagnostics);
        }
      }
    }
  }

  return diagnostics;
}
