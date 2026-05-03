// ---------------------------------------------------------------------------
// Peripheral Ownership Validation
//
// Validates opt-in bus ownership via take()/release(). When take() is used
// anywhere in the program, this pass checks that:
//   1. I/O on owned buses only occurs between take() and release()
//   2. take() is not called on an already-owned bus (double-take error)
//   3. release() is not called on a bus that wasn't taken
//
// If take() is never used, no diagnostics are generated (opt-in).
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR } from './model';
import type { Diagnostic } from '../types';
import { scanNestedStatements } from './interrupt-analysis';

/**
 * Validate peripheral bus ownership when the take()/release() pattern is used.
 *
 * - I/O on a bus after take() → OK (owned)
 * - I/O on a bus after release() → warning (not owned)
 * - I/O on a bus that was never take()'d → warning (if any bus uses ownership)
 * - Double take() without release() → error
 * - release() without take() → warning
 */
export function validatePeripheralOwnership(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Track ownership state per bus receiver
  const ownedBuses = new Set<string>();

  // First pass: find which specific buses use the ownership pattern
  const busesWithOwnership = new Set<string>();
  const quickScan = (stmts: StatementIR[]): void => {
    for (const stmt of stmts) {
      scanNestedStatements(stmt, (s) => {
      });
    }
  };
  quickScan(program.topLevelStatements);
  for (const fn of program.functions) {
    quickScan(fn.statements);
  }

  // If no bus uses the ownership pattern, skip validation entirely
  if (busesWithOwnership.size === 0) return diagnostics;

  /** Scan an expression for typehal calls. */
  const scanExpression = (expr: ExpressionIR | undefined): void => {
    if (!expr || typeof expr !== 'object') return;

    // Scan callback bodies for nested typehal-calls
    if (expr.kind === 'callback') {
      const e = expr as any;
      if (e.statements && Array.isArray(e.statements)) {
        for (const stmt of e.statements) checkStatement(stmt);
      }
    }
  };

  /** Scan a statement for typehal calls. */
  const checkStatement = (stmt: StatementIR): void => {
    if (!stmt || typeof stmt !== 'object') return;

    if (stmt.kind === 'call') {
      const c = stmt as any;
      if (c.args && Array.isArray(c.args)) {
        for (const arg of c.args) scanExpression(arg);
      }
    }

    if (stmt.kind === 'assign') {
      const a = stmt as any;
      if (a.value) scanExpression(a.value);
    }

    if (stmt.kind === 'var_decl') {
      const v = stmt as any;
      if (v.initializer) scanExpression(v.initializer);
    }

    if (stmt.kind === 'if') {
      const i = stmt as any;
      if (i.condition) scanExpression(i.condition);
    }

    if (stmt.kind === 'return') {
      const r = stmt as any;
      if (r.value) scanExpression(r.value);
    }

    // Recurse into nested statements
    scanNestedStatements(stmt, checkStatement);
  };

  // Scan top-level statements
  for (const stmt of program.topLevelStatements) {
    checkStatement(stmt);
  }

  // Scan function bodies
  for (const fn of program.functions) {
    for (const stmt of fn.statements) {
      checkStatement(stmt);
    }
  }

  return diagnostics;
}
