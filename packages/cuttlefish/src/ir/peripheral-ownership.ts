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

import type { ProgramIR, StatementIR, ExpressionIR, SourceSpan } from '../api/index.js';
import type { Diagnostic } from '../types.js';
import { scanNestedStatements } from './interrupt-analysis.js';

export function validatePeripheralOwnership(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ownedBuses = new Map<string, SourceSpan>();
  const busesRequiringOwnership = new Set<string>();

  // Helper to extract the bus object from a property access (e.g., I2C0.begin -> I2C0)
  const getBusName = (callee: string): string | undefined => {
    const busMatch = callee.match(/^(I2C\d|SPI\d|UART\d|Wire|Serial\d?)\b/);
    return busMatch ? busMatch[1] : undefined;
  };

  /** Scan an expression for take() calls. */
  const scanExpression = (expr: ExpressionIR | undefined, span: SourceSpan): void => {
    if (!expr || typeof expr !== 'object') return;

    if (expr.kind === 'method-call') {
      const bus = getBusName(expr.callee);
      if (bus) {
        if (expr.callee.endsWith('.take')) {
          if (ownedBuses.has(bus)) {
            diagnostics.push({
              severity: 'error',
              message: `Double-take: '${bus}' is already owned.`,
              hint: `Call '${bus}.release()' before taking it again.`,
              filePath: span.filePath,
              line: span.startLine,
              column: span.startColumn,
              code: 'hal-ownership-double-take',
              source: 'peripheral-ownership',
            });
          }
          ownedBuses.set(bus, span);
          busesRequiringOwnership.add(bus);
        }
      }
      expr.args.forEach(arg => scanExpression(arg, span));
    }

    if (expr.kind === 'callback') {
      expr.statements.forEach(checkStatement);
    }
  };

  /** Scan a statement for I/O and release() calls. */
  const checkStatement = (stmt: StatementIR): void => {
    if (!stmt || typeof stmt !== 'object') return;

    const span = stmt.sourceSpan;

    if (stmt.kind === 'call') {
      let bus = getBusName(stmt.callee);
      let isRelease = stmt.callee.endsWith('.release');
      let isBegin = stmt.callee.endsWith('.begin');
      let isTake = stmt.callee.endsWith('.take');

      // Special case: scan HAL-resolved emits for bus usage
      if (stmt.callee === '__EMIT__' && stmt.args[0]?.kind === 'string') {
        const rawCode = stmt.args[0].value;
        const busMatch = rawCode.match(/\b(Wire|SPI|Serial\d?)\./);
        if (busMatch) {
          const rawBus = busMatch[1];
          if (rawBus === 'Wire') bus = 'I2C0';
          else if (rawBus === 'SPI') bus = 'SPI0';
          else if (rawBus.startsWith('Serial')) bus = 'UART0';
        }
      }

      if (bus) {
        if (isTake) {
          if (ownedBuses.has(bus)) {
            diagnostics.push({
              severity: 'error',
              message: `Double-take: '${bus}' is already owned.`,
              hint: `Call '${bus}.release()' before taking it again.`,
              filePath: span.filePath,
              line: span.startLine,
              column: span.startColumn,
              code: 'hal-ownership-double-take',
              source: 'peripheral-ownership',
            });
          }
          ownedBuses.set(bus, span);
          busesRequiringOwnership.add(bus);
        } else if (isRelease) {
          if (!ownedBuses.has(bus)) {
            diagnostics.push({
              severity: 'warning',
              message: `'${bus}.release()' called but bus was not taken.`,
              hint: `Ensure you call '${bus}.take()' before releasing.`,
              filePath: span.filePath,
              line: span.startLine,
              column: span.startColumn,
              code: 'hal-ownership-unowned-release',
              source: 'peripheral-ownership',
            });
          }
          ownedBuses.delete(bus);
        } else if (busesRequiringOwnership.has(bus) && !ownedBuses.has(bus) && !isBegin) {
          // If ownership mode is opt-in and active for this bus, all calls must be owned
          diagnostics.push({
            severity: 'error',
            message: `Unowned access: '${bus}' is used without being taken.`,
            hint: `Call 'const bus = ${bus}.take();' and use the returned 'bus' object, or ensure '${bus}' is taken in the current scope.`,
            filePath: span.filePath,
            line: span.startLine,
            column: span.startColumn,
            code: 'hal-ownership-unowned-access',
            source: 'peripheral-ownership',
          });
        }
      }
      stmt.args.forEach(arg => scanExpression(arg, span));
    }

    if (stmt.kind === 'var_decl' && stmt.initializer) {
      scanExpression(stmt.initializer, span);
    }

    if (stmt.kind === 'assign' && stmt.value) {
      scanExpression(stmt.value, span);
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

  // Check for unreleased buses at end of program
  for (const [bus, busSpan] of ownedBuses) {
    diagnostics.push({
      severity: 'warning',
      message: `'${bus}' was taken but never released.`,
      hint: `Call '${bus}.release()' when finished with the bus.`,
      filePath: busSpan.filePath,
      line: busSpan.startLine,
      column: busSpan.startColumn,
      code: 'hal-ownership-leak',
      source: 'peripheral-ownership',
    });
  }

  return diagnostics;
}
