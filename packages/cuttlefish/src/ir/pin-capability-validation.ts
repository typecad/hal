// ---------------------------------------------------------------------------
// Pin Capability Validation
//
// Detects calls to capability-specific methods on pins that don't support them.
// E.g. D12.readAnalog() — D12 is a digital-only pin, use A0-A5 instead.
// A0.pwm() — A0 has no PWM, use D3/D5/D6/D9/D10/D11 instead.
// Produces diagnostics with actionable hints listing the correct pins.
// ---------------------------------------------------------------------------

import type { ProgramIR, ExpressionIR, StatementIR, HALOpIR } from '../api/index.js';
import type { BoardConstants } from './board-resolver.js';
import type { Diagnostic } from '../types.js';

/** Compile-time exhaustiveness check for switch statements on IR kinds. */
function assertNever(x: never): never {
  throw new Error(`Unhandled IR kind: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------
// HAL operation → capability mapping
// ---------------------------------------------------------------------------

/** Maps a HAL operation string to the board-definition capability flag it requires. */
function operationToCapability(op: string): string | null {
  if (op === 'pwm.write' || op === 'pwm.get_frequency' || op === 'pwm.get_resolution' || op === 'tone.play') {
    return 'pwm';
  }
  if (op === 'adc.read' || op === 'adc.read_voltage' || op === 'adc.get_resolution') {
    return 'analogInput';
  }
  if (op === 'dac.write') {
    return 'analogOutput';
  }
  if (op === 'interrupt.attach') {
    return 'interrupt';
  }
  // GPIO and timing ops are always available — no capability check needed.
  return null;
}

// ---------------------------------------------------------------------------
// Board constant lookups
// ---------------------------------------------------------------------------

/** Find the human-readable name for a pin number (e.g. 14 → "PC0" or "A0"). */
function getPinName(pinNumber: number, boardConstants: BoardConstants | undefined): string {
  if (!boardConstants) return `pin ${pinNumber}`;
  const name = boardConstants.get(`pins.all.${pinNumber}.name`);
  return name ? String(name) : `pin ${pinNumber}`;
}

/** Find all pins on this board that support a given capability. */
function findPinsWithCapability(capability: string, boardConstants: BoardConstants | undefined): string[] {
  if (!boardConstants) return [];
  const result: string[] = [];
  const funcTypeMap: Record<string, string> = {
    pwm: 'pwm',
    analogInput: 'adc',
    analogOutput: 'dac',
    interrupt: 'interrupt',
  };
  const funcType = funcTypeMap[capability];

  for (let i = 0; i < 100; i++) {
    const name = boardConstants.get(`pins.all.${i}.name`);
    if (name === undefined) continue;

    // Check capabilities flag first
    const capFlag = boardConstants.get(`pins.all.${i}.capabilities.${capability}`);
    if (capFlag === true || capFlag === 'true') {
      result.push(String(name));
      continue;
    }

    // Fallback: check functions array
    if (funcType) {
      for (let j = 0; j < 10; j++) {
        const type = boardConstants.get(`pins.all.${i}.functions.${j}.type`);
        if (type === undefined) break;
        if (String(type) === funcType) {
          result.push(String(name));
          break;
        }
      }
    }
  }
  return result;
}

/**
 * Does the board declare ANY per-pin `type:'pwm'` function entry anywhere?
 *
 * AVR-family boards (atmega328p, etc.) hardwire PWM to specific timer-output
 * pins, so their MCU descriptors list `{ type:'pwm', ... }` per pin and the
 * capability check correctly rejects PWM on non-timer pins. ESP32-family
 * boards route LEDC to ANY output GPIO via the GPIO matrix, so their MCU
 * descriptors carry zero `type:'pwm'` entries — PWM is a board-wide property
 * (the `pins.pwm` collection), not a per-pin function. On such boards the
 * per-pin capability check would false-positive on every pin, so the caller
 * skips it when this returns false. This distinguishes the two families
 * cleanly (AVR has entries, ESP32 has none) without special-casing arch names.
 */
function boardHasAnyPwmFunctionEntries(boardConstants: BoardConstants | undefined): boolean {
  if (!boardConstants) return false;
  for (let i = 0; i < 100; i++) {
    if (boardConstants.get(`pins.all.${i}.name`) === undefined) continue;
    for (let j = 0; j < 10; j++) {
      const type = boardConstants.get(`pins.all.${i}.functions.${j}.type`);
      if (type === undefined) break;
      if (String(type) === 'pwm') return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Capability check for a single HAL operation
// ---------------------------------------------------------------------------

function checkCapability(
  operation: HALOpIR,
  sourceLine: number | undefined,
  sourceCol: number | undefined,
  filePath: string | undefined,
  boardConstants: BoardConstants | undefined,
  diagnostics: Diagnostic[],
): void {
  // Only operations with a pin field are capability-checked.
  const op = operation.operation;
  if (!('pin' in operation)) return;

  const capability = operationToCapability(op);
  if (!capability) return; // GPIO/timing — always available.

  // ESP32-family boards route PWM (LEDC) to any output GPIO via the GPIO
  // matrix, so they carry zero per-pin `type:'pwm'` entries (unlike AVR,
  // which hardwires PWM to timer-output pins). On such boards the per-pin PWM
  // capability check would reject every pin; skip it and let the framework's
  // LEDC driver handle routing. This does NOT weaken AVR, which has entries.
  if (capability === 'pwm' && !boardHasAnyPwmFunctionEntries(boardConstants)) return;

  const pin = (operation as any).pin as number;
  if (typeof pin !== 'number' || pin < 0) return;

  // ADC channel reads (ADC.read(channel)) use channel numbers, not pin
  // numbers — skip capability checking for adc ops where the "pin" is
  // actually a channel index (0-7 range, below the first analog pin).
  if (capability === 'analogInput' && op.startsWith('adc.') && pin < 14) return;

  // Check the pin's capability via the board definition.
  // Try the capabilities flag first, then fall back to scanning the
  // functions array (functions.N.type === capability prefix).
  const capFlag = boardConstants?.get(`pins.all.${pin}.capabilities.${capability}`);
  if (capFlag === true || capFlag === 'true') return; // Capability confirmed.

  // Fallback: scan the functions array for a matching type.
  // PWM capability is indicated by functions[N].type === 'pwm',
  // ADC by 'adc', interrupts by 'interrupt' (external), DAC by 'dac'.
  const funcTypeMap: Record<string, string> = {
    pwm: 'pwm',
    analogInput: 'adc',
    analogOutput: 'dac',
    interrupt: 'interrupt',
  };
  const funcType = funcTypeMap[capability];
  if (funcType) {
    let hasCapabilityData = false;
    for (let i = 0; i < 10; i++) {
      const type = boardConstants?.get(`pins.all.${pin}.functions.${i}.type`);
      if (type === undefined) break;
      hasCapabilityData = true;
      if (String(type) === funcType) return; // Capability confirmed via functions.
    }
    // If the pin has NO functions entries at all AND the capability we're
    // checking is interrupt (which is stored in capabilities, not functions),
    // we can't determine support — skip to avoid false positives.
    if (!hasCapabilityData && capability === 'interrupt') return;
  }

  // Capability NOT supported — emit a diagnostic.
  const pinName = getPinName(pin, boardConstants);
  const validPins = findPinsWithCapability(capability, boardConstants);
  const capLabel = capability === 'analogInput' ? 'analog input'
    : capability === 'analogOutput' ? 'DAC output'
    : capability === 'interrupt' ? 'external interrupts'
    : capability.toUpperCase();

  const hint = validPins.length > 0
    ? `Use one of: ${validPins.join(', ')}`
    : `No pins on this board support ${capLabel}.`;

  diagnostics.push({
    severity: 'error',
    code: 'pin-capability-mismatch',
    message: `${pinName} does not support ${capLabel} on this board.`,
    hint,
    line: sourceLine,
    column: sourceCol,
    filePath,
    source: 'pin-capability-validation',
  } as Diagnostic);
}

// ---------------------------------------------------------------------------
// IR tree scanner
// ---------------------------------------------------------------------------

function scanExpression(
  expr: ExpressionIR,
  boardConstants: BoardConstants | undefined,
  parentLine: number | undefined,
  parentCol: number | undefined,
  parentFilePath: string | undefined,
  diagnostics: Diagnostic[],
): void {
  if (!expr || typeof expr !== 'object') return;

  switch (expr.kind) {
    case 'binary': {
      scanExpression(expr.left, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      scanExpression(expr.right, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'ternary': {
      scanExpression(expr.condition, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      scanExpression(expr.whenTrue, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      scanExpression(expr.whenFalse, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'property-access': {
      scanExpression(expr.object, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'unary': {
      scanExpression(expr.operand, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'paren': {
      scanExpression(expr.inner, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'array': {
      for (const el of expr.elements) {
        scanExpression(el, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      }
      break;
    }
    case 'object': {
      for (const field of expr.fields) {
        scanExpression(field.value, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      }
      break;
    }
    case 'callback': {
      for (const s of expr.statements) {
        scanStatement(s, boardConstants, diagnostics);
      }
      break;
    }
    case 'lambda': {
      for (const s of expr.body) {
        scanStatement(s, boardConstants, diagnostics);
      }
      break;
    }
    case 'method-call': {
      for (const arg of expr.args) {
        scanExpression(arg, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      }
      break;
    }
    case 'element-access': {
      scanExpression(expr.object, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      scanExpression(expr.index, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'string_concat': {
      for (const part of expr.parts) {
        scanExpression(part, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      }
      break;
    }
    case 'template_string': {
      scanExpression(expr.expression, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'spread_array': {
      scanExpression(expr.spreadExpr, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      for (const el of expr.additionalElements) {
        scanExpression(el, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      }
      break;
    }
    case 'instanceof': {
      scanExpression(expr.object, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'await': {
      scanExpression(expr.value, boardConstants, parentLine, parentCol, parentFilePath, diagnostics);
      break;
    }
    case 'hal-expr': {
      // Expression-form HAL operation (e.g. adc.read used as a value).
      checkCapability(expr.operation, parentLine, parentCol, parentFilePath, boardConstants, diagnostics);
      break;
    }
    case 'number':
    case 'string':
    case 'boolean':
    case 'identifier':
    case 'raw':
    case 'tuple-access':
    case 'call':
      break;
    default:
      assertNever(expr);
  }
}

function scanStatement(
  stmt: StatementIR,
  boardConstants: BoardConstants | undefined,
  diagnostics: Diagnostic[],
): void {
  if (!stmt || typeof stmt !== 'object') return;

  const line = stmt.sourceSpan?.startLine as number | undefined;
  const col = stmt.sourceSpan?.startColumn as number | undefined;
  const filePath = stmt.sourceSpan?.filePath as string | undefined;

  switch (stmt.kind) {
  case 'var_decl': {
    if (stmt.initializer) scanExpression(stmt.initializer, boardConstants, line, col, filePath, diagnostics);
    break;
  }

  case 'assign': {
    if (stmt.value) scanExpression(stmt.value, boardConstants, line, col, filePath, diagnostics);
    break;
  }

  case 'if': {
    if (stmt.condition) scanExpression(stmt.condition, boardConstants, line, col, filePath, diagnostics);
    for (const s of stmt.thenBranch) scanStatement(s, boardConstants, diagnostics);
    if (stmt.elseBranch) for (const s of stmt.elseBranch) scanStatement(s, boardConstants, diagnostics);
    break;
  }

  case 'while':
  case 'do_while': {
    if (stmt.condition) scanExpression(stmt.condition, boardConstants, line, col, filePath, diagnostics);
    for (const s of stmt.body) scanStatement(s, boardConstants, diagnostics);
    break;
  }

  case 'for': {
    if (stmt.condition) scanExpression(stmt.condition, boardConstants, line, col, filePath, diagnostics);
    if (stmt.initializer) scanStatement(stmt.initializer, boardConstants, diagnostics);
    if (stmt.increment) scanStatement(stmt.increment, boardConstants, diagnostics);
    for (const s of stmt.body) scanStatement(s, boardConstants, diagnostics);
    break;
  }

  case 'for_of':
  case 'for_in': {
    if (stmt.variable) scanStatement(stmt.variable, boardConstants, diagnostics);
    for (const s of stmt.body) scanStatement(s, boardConstants, diagnostics);
    break;
  }

  case 'return': {
    if (stmt.value) scanExpression(stmt.value, boardConstants, line, col, filePath, diagnostics);
    break;
  }

  case 'call': {
    for (const arg of stmt.args) {
      scanExpression(arg, boardConstants, line, col, filePath, diagnostics);
    }
    break;
  }

  case 'hal-op': {
    // Statement-form HAL operation — the primary capability check target.
    checkCapability(stmt.operation, line, col, filePath, boardConstants, diagnostics);
    break;
  }

  case 'switch': {
    if (stmt.expression) scanExpression(stmt.expression, boardConstants, line, col, filePath, diagnostics);
    for (const c of stmt.cases) {
      for (const s of c.body) scanStatement(s, boardConstants, diagnostics);
    }
    break;
  }

  case 'block': {
    for (const s of stmt.body) scanStatement(s, boardConstants, diagnostics);
    break;
  }

  case 'labeled': {
    for (const s of stmt.body) scanStatement(s, boardConstants, diagnostics);
    break;
  }

  case 'try': {
    for (const s of stmt.tryBlock) scanStatement(s, boardConstants, diagnostics);
    if (stmt.catchBlock) for (const s of stmt.catchBlock) scanStatement(s, boardConstants, diagnostics);
    if (stmt.finallyBlock) for (const s of stmt.finallyBlock) scanStatement(s, boardConstants, diagnostics);
    break;
  }

  case 'throw': {
    if (stmt.value) scanExpression(stmt.value, boardConstants, line, col, filePath, diagnostics);
    break;
  }

  case 'update':
  case 'break':
  case 'continue':
  case 'yield':
  case 'super_call':
    break;

  default:
    assertNever(stmt);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that capability-specific methods are only called on pins that support them.
 */
export function validatePinCapabilities(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const boardConstants = program.boardConstants;

  if (program.topLevelStatements) {
    for (const stmt of program.topLevelStatements) {
      scanStatement(stmt, boardConstants, diagnostics);
    }
  }

  if (program.functions) {
    for (const fn of program.functions) {
      if (fn.statements) {
        for (const stmt of fn.statements) {
          scanStatement(stmt, boardConstants, diagnostics);
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
              scanStatement(stmt, boardConstants, diagnostics);
            }
          }
        }
      }
      if (cls.constructor?.statements) {
        for (const stmt of cls.constructor.statements) {
          scanStatement(stmt, boardConstants, diagnostics);
        }
      }
    }
  }

  return diagnostics;
}
