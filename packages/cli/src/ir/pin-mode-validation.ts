// ---------------------------------------------------------------------------
// Pin Mode Configuration Validation
//
// Detects when GPIO I/O operations are used on pins without prior mode
// configuration. Generates warnings for reads and info for writes.
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR } from './model';
import type { Diagnostic } from '../types';
import { scanNestedStatements } from './interrupt-analysis';

/** Methods that configure pin mode. */
const MODE_SET_METHODS = new Set([
  'inputPullUp', 'inputPullDown', 'outputOpenDrain',
  'asOutput', 'asInput', 'asInputPullUp',
]);

/** Read operations that require prior INPUT or INPUT_PULLUP mode. */
const READ_METHODS = new Set([
  'read', 'isHigh', 'isLow', 'readAnalog', 'readVoltage',
]);

/** Write operations that implicitly set OUTPUT mode on Arduino. */
const WRITE_METHODS = new Set([
  'write', 'high', 'low', 'toggle', 'pulse', 'pwm', 'tone',
]);

/** Receiver kinds that represent GPIO pins. */
const PIN_RECEIVER_KINDS = new Set([
  'digital', 'pwm', 'analog-input', 'interrupt',
]);

/**
 * Validate that GPIO I/O operations are preceded by mode configuration.
 *
 * - Read without prior mode → **warning** (undefined behavior on floating pin)
 * - Write without prior mode → **info** (Arduino implicitly sets OUTPUT, but
 *   explicit configuration is recommended)
 */
export function validatePinModeConfig(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Track which receivers have had their mode explicitly set
  const pinModeSet = new Set<string>();

  const checkTypecodeCall = (receiver: string, receiverKind: string | undefined, method: string): void => {
    if (!receiverKind || !PIN_RECEIVER_KINDS.has(receiverKind)) return;

    // Warn when analog pin is used as digital output — analog capability is lost
    if (receiverKind === 'analog-input' && method === 'asOutput') {
      diagnostics.push({
        severity: 'warning',
        message: `Analog pin '${receiver}' used as digital output. ` +
                 `Analog input capability (ADC) is lost while pin is in OUTPUT mode. ` +
                 `Call ${receiver}.asInput() to restore analog reading.`,
        code: 'analog-pin-as-output',
        source: 'pin-mode-validation',
      });
    }

    if (MODE_SET_METHODS.has(method)) {
      pinModeSet.add(receiver);
    } else if (READ_METHODS.has(method) && !pinModeSet.has(receiver)) {
      diagnostics.push({
        severity: 'warning',
        message: `Pin '${receiver}' read via '${method}()' without prior mode configuration. ` +
                 `Call ${receiver}.asInput() or ${receiver}.inputPullUp() first.`,
        code: 'pin-mode-not-set',
        source: 'pin-mode-validation',
      });
    } else if (WRITE_METHODS.has(method) && !pinModeSet.has(receiver)) {
      diagnostics.push({
        severity: 'info',
        message: `Pin '${receiver}' written via '${method}()' without explicit mode configuration. ` +
                 `Arduino implicitly sets OUTPUT, but explicit ${receiver}.asOutput() is recommended.`,
        code: 'pin-mode-not-set',
        source: 'pin-mode-validation',
      });
    }
  };

  /**
   * Recursively scan an expression for typecode-call nodes.
   * Pin I/O can appear as expressions inside template literals, function args, etc.
   */
  const scanExpression = (expr: ExpressionIR | undefined): void => {
    if (!expr || typeof expr !== 'object') return;
    const e = expr as any;
    if (!e.kind) return;

    // Check for typecode-call expressions (e.g., D3.read() inside ${...})
    if (e.kind === 'typecode-call') {
      if (e.receiver && e.method) {
        checkTypecodeCall(e.receiver, e.receiverKind, e.method);
      }
      // Also scan args of this typecode-call expression
      if (e.args && Array.isArray(e.args)) {
        for (const arg of e.args) scanExpression(arg);
      }
      return;
    }

    // Recurse into nested expressions
    if (e.args && Array.isArray(e.args)) {
      for (const arg of e.args) scanExpression(arg);
    }
    if (e.left) scanExpression(e.left);
    if (e.right) scanExpression(e.right);
    if (e.operand) scanExpression(e.operand);
    if (e.condition) scanExpression(e.condition);
    if (e.consequent) scanExpression(e.consequent);
    if (e.alternate) scanExpression(e.alternate);
    if (e.object) scanExpression(e.object);
    if (e.value) scanExpression(e.value);
    if (e.elements && Array.isArray(e.elements)) {
      for (const elem of e.elements) scanExpression(elem);
    }
    if (e.fields && Array.isArray(e.fields)) {
      for (const field of e.fields) {
        if (field && field.value) scanExpression(field.value);
      }
    }
    // Template literal: string_concat has a 'parts' array
    if (e.parts && Array.isArray(e.parts)) {
      for (const part of e.parts) scanExpression(part);
    }
    // Template literal: template_string wraps an 'expression' (singular)
    if (e.expression) scanExpression(e.expression);
    // Callback expressions with nested statements
    if (e.statements && Array.isArray(e.statements)) {
      for (const stmt of e.statements) checkStatement(stmt);
    }
  };

  const checkStatement = (stmt: StatementIR): void => {
    if (!stmt || typeof stmt !== 'object') return;

    if (stmt.kind === 'typecode-call') {
      const tc = stmt as any;
      if (tc.receiver && tc.method) {
        checkTypecodeCall(tc.receiver, tc.receiverKind, tc.method);
      }
      // Scan args for nested typecode-call expressions
      if (tc.args && Array.isArray(tc.args)) {
        for (const arg of tc.args) scanExpression(arg);
      }
    }

    // Scan expressions in other statement types for nested typecode-calls
    if (stmt.kind === 'assign') {
      const a = stmt as any;
      if (a.value) scanExpression(a.value);
    }
    if (stmt.kind === 'var_decl') {
      const v = stmt as any;
      if (v.initializer) scanExpression(v.initializer);
    }
    if (stmt.kind === 'return') {
      const r = stmt as any;
      if (r.value) scanExpression(r.value);
    }
    if (stmt.kind === 'call') {
      const c = stmt as any;
      if (c.args && Array.isArray(c.args)) {
        for (const arg of c.args) scanExpression(arg);
      }
    }
    if (stmt.kind === 'if') {
      const i = stmt as any;
      if (i.condition) scanExpression(i.condition);
    }
    if (stmt.kind === 'while' || stmt.kind === 'do_while') {
      const w = stmt as any;
      if (w.condition) scanExpression(w.condition);
    }
    if (stmt.kind === 'for') {
      const f = stmt as any;
      if (f.condition) scanExpression(f.condition);
      if (f.initializer) checkStatement(f.initializer);
      if (f.increment) checkStatement(f.increment);
    }
    if (stmt.kind === 'switch') {
      const s = stmt as any;
      if (s.expression) scanExpression(s.expression);
    }

    // Recurse into nested statements (if branches, loop bodies, etc.)
    scanNestedStatements(stmt, checkStatement);
  };

  // Scan all program locations
  if (program.topLevelStatements) {
    for (const stmt of program.topLevelStatements) checkStatement(stmt);
  }
  if (program.functions) {
    for (const fn of program.functions) {
      if (fn.statements) {
        for (const stmt of fn.statements) checkStatement(stmt);
      }
    }
  }
  if (program.classes) {
    for (const cls of program.classes) {
      if (cls.methods) {
        for (const method of cls.methods) {
          if (method.statements) {
            for (const stmt of method.statements) checkStatement(stmt);
          }
        }
      }
      if ((cls as any).constructor?.statements) {
        for (const stmt of (cls as any).constructor.statements) checkStatement(stmt);
      }
    }
  }

  return diagnostics;
}
