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

/** Receiver kinds that represent shared buses. */
const BUS_RECEIVER_KINDS = new Set(['spi', 'i2c', 'serial']);

/** I/O methods that require bus ownership. */
const BUS_IO_METHODS = new Set([
  // SPI
  'transfer', 'write', 'write16', 'read', 'beginTransaction', 'endTransaction',
  'setFrequency', 'setMode', 'setBitOrder',
  // I2C
  'beginTransmission', 'endTransmission', 'requestFrom',
  'setClock', 'onReceive', 'onRequest',
  // UART/Serial
  'print', 'println', 'printf', 'writeString', 'writeLine',
  'readString', 'readLine', 'clearRxBuffer',
]);

/** Methods that initialize a bus (not I/O, so no ownership required). */
const INIT_METHODS = new Set([
  'begin', 'end', 'initialize',
  'take', 'release',
]);

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
      if (stmt.kind === 'typehal-call') {
        const tc = stmt as any;
        if ((tc.method === 'take' || tc.method === 'release') && tc.receiver) {
          busesWithOwnership.add(tc.receiver);
        }
      }
      scanNestedStatements(stmt, (s) => {
        if (s.kind === 'typehal-call') {
          const tc = s as any;
          if ((tc.method === 'take' || tc.method === 'release') && tc.receiver) {
            busesWithOwnership.add(tc.receiver);
          }
        }
      });
    }
  };
  quickScan(program.topLevelStatements);
  for (const fn of program.functions) {
    quickScan(fn.statements);
  }

  // If no bus uses the ownership pattern, skip validation entirely
  if (busesWithOwnership.size === 0) return diagnostics;

  const checkTypehalCall = (receiver: string, receiverKind: string | undefined, method: string): void => {
    if (!receiverKind || !BUS_RECEIVER_KINDS.has(receiverKind)) return;

    if (method === 'take') {
      if (ownedBuses.has(receiver)) {
        diagnostics.push({
          severity: 'error',
          message: `Bus '${receiver}' is already owned. Call ${receiver}.release() before taking again.`,
          code: 'peripheral-double-take',
          source: 'peripheral-ownership',
        });
      } else {
        ownedBuses.add(receiver);
      }
    } else if (method === 'release') {
      if (!ownedBuses.has(receiver)) {
        diagnostics.push({
          severity: 'warning',
          message: `Bus '${receiver}' is not currently owned. Call ${receiver}.take() first.`,
          code: 'peripheral-release-without-take',
          source: 'peripheral-ownership',
        });
      } else {
        ownedBuses.delete(receiver);
      }
    } else if (!INIT_METHODS.has(method) && BUS_IO_METHODS.has(method) && busesWithOwnership.has(receiver)) {
      // I/O method — check if bus is owned (only for buses that use ownership pattern)
      if (!ownedBuses.has(receiver)) {
        diagnostics.push({
          severity: 'warning',
          message: `Bus '${receiver}' I/O via '${method}()' without ownership. ` +
                   `Use ${receiver}.take() before I/O and ${receiver}.release() after.`,
          code: 'peripheral-io-without-ownership',
          source: 'peripheral-ownership',
        });
      }
    }
  };

  /** Scan an expression for typehal calls. */
  const scanExpression = (expr: ExpressionIR | undefined): void => {
    if (!expr || typeof expr !== 'object') return;

    if (expr.kind === 'typehal-call') {
      const tc = expr as any;
      if (tc.receiver && tc.method) {
        checkTypehalCall(tc.receiver, tc.receiverKind, tc.method);
      }
      if (tc.args && Array.isArray(tc.args)) {
        for (const arg of tc.args) scanExpression(arg);
      }
    }

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

    if (stmt.kind === 'typehal-call') {
      const tc = stmt as any;
      if (tc.receiver && tc.method) {
        checkTypehalCall(tc.receiver, tc.receiverKind, tc.method);
      }
      // Scan args for nested typehal-call expressions
      if (tc.args && Array.isArray(tc.args)) {
        for (const arg of tc.args) scanExpression(arg);
      }
    }

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
