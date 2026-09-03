// ---------------------------------------------------------------------------
// Pin Mode Configuration Validation
//
// Detects when GPIO I/O operations are used on pins without prior mode
// configuration. Generates warnings for reads and info for writes.
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR } from '../api/index.js';
import type { Diagnostic } from '../types.js';
import { scanNestedStatements } from './interrupt-analysis.js';
import { hasLoadedFramework, getLoadedFramework } from '../framework-registry.js';

/** Methods that configure pin mode. */
const MODE_SET_METHODS = new Set([
  'inputPullUp', 'inputPullDown', 'outputOpenDrain',
  'asOutput', 'asInput', 'asInputPullUp',
]);

/** Read operations that require prior INPUT or INPUT_PULLUP mode. */
const READ_METHODS = new Set([
  'read', 'isHigh', 'isLow', 'readAnalog', 'readVoltage',
]);

/** Write operations that implicitly set OUTPUT mode on Wiring-derived frameworks. */
const WRITE_METHODS = new Set([
  'write', 'high', 'low', 'toggle', 'pulse', 'pwm',
]);

/** Receiver kinds that represent GPIO pins. */
const PIN_RECEIVER_KINDS = new Set([
  'digital', 'pwm', 'analog-input', 'interrupt',
]);

/**
 * Validate that GPIO I/O operations are preceded by mode configuration.
 *
 * - Read without prior mode → **warning** (undefined behavior on floating pin)
 * - Write without prior mode → **info** (Wiring-derived frameworks implicitly
 *   set OUTPUT, but explicit configuration is recommended)
 */
export function validatePinModeConfig(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Track which receivers have had their mode explicitly set
  const pinModeSet = new Set<string>();

  // Pins currently driven by PWM/tone (since their last digital write or
  // mode change). Reading such a pin has no defined digital level.
  const analogDrivenPins = new Set<string>();

  const checkCuttlefishCall = (receiver: string, receiverKind: string | undefined, method: string): void => {
    if (!receiverKind || !PIN_RECEIVER_KINDS.has(receiverKind)) return;

    // Warn when analog pin is used as digital output — analog capability is lost
    if (receiverKind === 'analog-input' && method === 'asOutput') {
      diagnostics.push({
        severity: 'warning',
        message: `Analog pin '${receiver}' used as digital output. ` +
                 `Analog input capability (ADC) is lost while pin is in OUTPUT mode. ` +
                 `Call ${receiver}.asInput() to restore analog reading.`,
        filePath: program.fileName,
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
        filePath: program.fileName,
        code: 'pin-mode-not-set',
        source: 'pin-mode-validation',
      });
    } else if (WRITE_METHODS.has(method) && !pinModeSet.has(receiver)) {
      diagnostics.push({
        severity: 'info',
        message: `Pin '${receiver}' written via '${method}()' without explicit mode configuration. ` +
                 `The target framework implicitly sets OUTPUT, but explicit ${receiver}.asOutput() is recommended.`,
        filePath: program.fileName,
        code: 'pin-mode-not-set',
        source: 'pin-mode-validation',
      });
    }
  };

  /**
   * Recursively scan an expression for cuttlefish-call nodes.
   * Pin I/O can appear as expressions inside template literals, function args, etc.
   */
  /** Infer the receiver kind from the method name. Analog/PWM methods imply
   *  their respective pin kinds; everything else defaults to digital. */
  const inferReceiverKind = (method: string): string | undefined => {
    if (method === 'readAnalog' || method === 'readVoltage') return 'analog-input';
    if (method === 'pwm') return 'pwm';
    // Methods in the read/write/mode sets that aren't analog/pwm are digital.
    if (READ_METHODS.has(method) || WRITE_METHODS.has(method) || MODE_SET_METHODS.has(method)) return 'digital';
    return undefined;
  };

  /** Check a gpio HAL op for pin-mode issues. Used by both scanExpression
   *  (hal-expr, for reads used as values) and checkStatement (hal-op, for
   *  standalone writes/calls). */
  const checkGpioHalOp = (op: any): void => {
    if (!op) return;
    const pinKey = `pin${op.pin}`;
    if (op.operation === 'gpio.configure' || op.operation === 'gpio.read_cfg') {
      pinModeSet.add(pinKey);
      analogDrivenPins.delete(pinKey);
    } else if (op.operation === 'pwm.set_pulse' || op.operation === 'pwm.set_duty') {
      analogDrivenPins.add(pinKey);
    } else if (op.operation === 'gpio.write' || op.operation === 'gpio.toggle') {
      analogDrivenPins.delete(pinKey);
    } else if (op.operation === 'gpio.read') {
      if (analogDrivenPins.has(pinKey)) {
        diagnostics.push({
          severity: 'warning',
          message: `Pin ${op.pin} read while driven by PWM/tone. ` +
                   `The pin has no defined digital level while an analog output is active; ` +
                   `tracked reads return the last digital write, not the waveform.`,
          filePath: program.fileName,
          code: 'pin-read-while-pwm',
          source: 'pin-mode-validation',
        });
      } else if (!pinModeSet.has(pinKey)) {
        diagnostics.push({
          severity: 'warning',
          message: `Pin ${op.pin} read without prior mode configuration. ` +
                   `Call asInput() or inputPullUp() first — reading a floating pin is undefined behavior.`,
          filePath: program.fileName,
          code: 'pin-mode-not-set',
          source: 'pin-mode-validation',
        });
      }
    } else if ((op.operation === 'gpio.write' || op.operation === 'gpio.toggle') && !pinModeSet.has(pinKey)) {
      diagnostics.push({
        severity: 'info',
        message: `Pin ${op.pin} written without explicit mode configuration. ` +
                 `The target framework implicitly sets OUTPUT, but explicit asOutput() is recommended.`,
        filePath: program.fileName,
        code: 'pin-mode-not-set',
        source: 'pin-mode-validation',
      });
    }
  };

  const scanExpression = (expr: ExpressionIR | undefined): void => {
    if (!expr || typeof expr !== 'object') return;
    const e = expr as any;
    if (!e.kind) return;

    // Method calls on pins: extract receiver + method and dispatch to
    // checkCuttlefishCall (pre-HAL-resolution fallback path).
    if (e.kind === 'method-call' && typeof e.callee === 'string') {
      const callee = e.callee;
      const dotIdx = callee.lastIndexOf('.');
      if (dotIdx > 0) {
        const receiver = callee.slice(0, dotIdx);
        const method = callee.slice(dotIdx + 1);
        const receiverKind = inferReceiverKind(method);
        if (receiverKind) {
          checkCuttlefishCall(receiver, receiverKind, method);
        }
      }
    }

    // HAL expression (read used as a value, e.g. `const v = D2.isHigh()`).
    // After HAL resolution, pin reads become hal-expr nodes with a gpio.read
    // operation — this is the common form at validation time.
    if (e.kind === 'hal-expr' && e.operation) {
      checkGpioHalOp(e.operation);
    }

    // Raw nodes: after full HAL resolution, some pin ops land as their C++ text
    // (e.g. `digitalRead(2)`, `digitalWrite(2, 1)`) rather than structured
    // hal-expr nodes. Extract the pin number and apply the same mode check.
    // Detect GPIO ops in lowered raw C++ text. Build the read/write name
    // patterns from the loaded framework's HAL vocabulary (halCallNames),
    // classifying names containing "Read" as reads and "Write" as writes (the
    // Wiring-derived convention). Seed with digitalRead/digitalWrite as the
    // canonical Wiring forms so the validator works even when no framework is
    // loaded. Non-Wiring frameworks that emit other call forms register them
    // via halCallNames; this loop picks them up.
    if (e.kind === 'raw' && typeof e.value === 'string') {
      const frameworkHalNames = hasLoadedFramework()
        ? getLoadedFramework().strategy.halCallNames?.()
        : undefined;
      const halNames = frameworkHalNames ?? new Set<string>(['digitalRead', 'digitalWrite']);
      const readNames = [...halNames].filter(n => /read/i.test(n));
      const writeNames = [...halNames].filter(n => /write/i.test(n));
      let pin: number | null = null;
      let op: { operation: string; pin: number } | null = null;
      for (const rn of readNames) {
        const esc = rn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = e.value.match(new RegExp(`${esc}\\((\\d+)\\)`));
        if (m) { pin = parseInt(m[1], 10); op = { operation: 'gpio.read', pin }; break; }
      }
      if (!op) {
        for (const wn of writeNames) {
          const esc = wn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const m = e.value.match(new RegExp(`${esc}\\((\\d+)`));
          if (m) { pin = parseInt(m[1], 10); op = { operation: 'gpio.write', pin }; break; }
        }
      }
      // toggle: a write call whose second arg is a read call on the same pin.
      if (!op) {
        const tm = e.value.match(/\((\d+),\s*\w*[Rr]ead/);
        if (tm) { op = { operation: 'gpio.toggle', pin: parseInt(tm[1], 10) }; }
      }
      if (op) checkGpioHalOp(op);
    }

    // Recurse into nested expressions
    if (e.args && Array.isArray(e.args)) {
      for (const arg of e.args) scanExpression(arg);
    }
    if (e.left) scanExpression(e.left);
    if (e.right) scanExpression(e.right);
    if (e.operand) scanExpression(e.operand);
    if (e.condition && typeof e.condition === 'object') scanExpression(e.condition);
    if (e.whenTrue) scanExpression(e.whenTrue);
    if (e.whenFalse) scanExpression(e.whenFalse);
    if (e.object && typeof e.object === 'object') scanExpression(e.object);
    // Only recurse into .value when it's an object with a kind (an expression),
    // not a primitive (number/string/boolean literals carry primitive values).
    if (e.value && typeof e.value === 'object' && e.value.kind) scanExpression(e.value);
    if (e.inner) scanExpression(e.inner);
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
    if (e.expression && typeof e.expression === 'object' && e.expression.kind) scanExpression(e.expression);
    // Callback expressions with nested statements
    if (e.statements && Array.isArray(e.statements)) {
      for (const stmt of e.statements) checkStatement(stmt);
    }
  };

  const checkStatement = (stmt: StatementIR): void => {
    if (!stmt || typeof stmt !== 'object') return;

    // HAL-op statements: track pin-mode state from gpio.configure and warn on
    // gpio.read/write/toggle without prior mode configuration. After HAL
    // resolution, pin method calls (D2.isHigh(), D2.high()) become these
    // structured ops — the method-call form no longer exists at validation time.
    if (stmt.kind === 'hal-op') {
      checkGpioHalOp((stmt as any).operation);
    }

    // Scan expressions in other statement types for nested cuttlefish-calls
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
