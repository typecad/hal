// ---------------------------------------------------------------------------
// Pin Capability Validation
//
// Detects calls to capability-specific methods on pins that don't support them.
// E.g. D12.readAnalog() — D12 is a digital-only pin, use A0-A5 instead.
// Produces diagnostics with actionable hints listing the correct pins.
// ---------------------------------------------------------------------------

import type { ProgramIR, ExpressionIR, StatementIR } from './model';
import type { Diagnostic } from '../types';
import type { TypehalReceiverKind } from '@typehal/core';
import { pinsWithKind } from '@typehal/core';

// ---------------------------------------------------------------------------
// Method-to-capability mapping
// ---------------------------------------------------------------------------

const ANALOG_METHODS = new Set(['readAnalog', 'readVoltage', 'setAnalogReference', 'getAnalogResolution']);
const PWM_METHODS = new Set(['pwm', 'getPwmFrequency', 'getPwmResolution']);
const INTERRUPT_METHODS = new Set(['onRising', 'onFalling', 'onChange', 'offInterrupts']);

interface CapabilityRule {
  methods: Set<string>;
  requiredKind: TypehalReceiverKind;
  label: string;
  description: (method: string) => string;
}

const RULES: CapabilityRule[] = [
  {
    methods: ANALOG_METHODS,
    requiredKind: 'analog-input',
    label: 'analog reading',
    description: (m) => `${m}() is an analog-only method`,
  },
  {
    methods: PWM_METHODS,
    requiredKind: 'pwm',
    label: 'PWM output',
    description: (m) => `${m}() is a PWM-only method`,
  },
  {
    methods: INTERRUPT_METHODS,
    requiredKind: 'interrupt',
    label: 'interrupts',
    description: (m) => `${m}() is an interrupt-only method`,
  },
];

function describeKind(kind: TypehalReceiverKind): string {
  switch (kind) {
  case 'digital': return 'digital-only';
  case 'pwm': return 'PWM-capable';
  case 'analog-input': return 'analog-capable';
  case 'interrupt': return 'interrupt-capable';
  default: return kind;
  }
}

// ---------------------------------------------------------------------------
// IR walker — mirrors the pattern in adc-range-validation.ts
// ---------------------------------------------------------------------------

function checkTypehalCall(
  receiver: string,
  receiverKind: string,
  method: string,
  sourceLine: number | undefined,
  sourceColumn: number | undefined,
  diagnostics: Diagnostic[],
): void {
  for (const rule of RULES) {
    if (!rule.methods.has(method)) continue;
    if (receiverKind === rule.requiredKind) continue;

    diagnostics.push({
      severity: 'error',
      code: 'pin-capability-mismatch',
      message: `${receiver}.${method}() — ${rule.description(method)}, but ${receiver} is a ${describeKind(receiverKind as TypehalReceiverKind)} pin.`,
      hint: `Use a pin that supports ${rule.label}: ${pinsWithKind(rule.requiredKind).join(', ')}.`,
      source: 'pin-capability-validation',
      line: sourceLine,
      column: sourceColumn,
    });
  }
}

function scanExpression(expr: ExpressionIR, parentLine: number | undefined, parentCol: number | undefined, diagnostics: Diagnostic[]): void {
  if (!expr || typeof expr !== 'object') return;

  if (expr.kind === 'typehal-call') {
    const tc = expr as any;
    checkTypehalCall(tc.receiver, tc.receiverKind, tc.method, parentLine, parentCol, diagnostics);
    if (tc.args) {
      for (const arg of tc.args) {
        scanExpression(arg, parentLine, parentCol, diagnostics);
      }
    }
  } else if (expr.kind === 'binary') {
    const bin = expr as any;
    scanExpression(bin.left, parentLine, parentCol, diagnostics);
    scanExpression(bin.right, parentLine, parentCol, diagnostics);
  } else if (expr.kind === 'ternary') {
    const t = expr as any;
    scanExpression(t.condition, parentLine, parentCol, diagnostics);
    scanExpression(t.consequent, parentLine, parentCol, diagnostics);
    scanExpression(t.alternate, parentLine, parentCol, diagnostics);
  } else if (expr.kind === 'property-access') {
    scanExpression((expr as any).object, parentLine, parentCol, diagnostics);
  } else if (expr.kind === 'unary') {
    scanExpression((expr as any).operand, parentLine, parentCol, diagnostics);
  } else if (expr.kind === 'paren') {
    scanExpression((expr as any).inner, parentLine, parentCol, diagnostics);
  }
}

function scanStatement(stmt: StatementIR, diagnostics: Diagnostic[]): void {
  if (!stmt || typeof stmt !== 'object') return;

  const line = (stmt as any).sourceSpan?.startLine as number | undefined;
  const col = (stmt as any).sourceSpan?.startColumn as number | undefined;

  switch (stmt.kind) {
  case 'typehal-call': {
    const tc = stmt as any;
    checkTypehalCall(tc.receiver, tc.receiverKind, tc.method, line, col, diagnostics);
    if (tc.args) {
      for (const arg of tc.args) {
        scanExpression(arg, line, col, diagnostics);
      }
    }
    break;
  }

  case 'var_decl': {
    const v = stmt as any;
    if (v.initializer) scanExpression(v.initializer, line, col, diagnostics);
    break;
  }

  case 'assign': {
    const a = stmt as any;
    if (a.value) scanExpression(a.value, line, col, diagnostics);
    break;
  }

  case 'if': {
    const i = stmt as any;
    if (i.condition) scanExpression(i.condition, line, col, diagnostics);
    if (i.thenBranch) for (const s of i.thenBranch) scanStatement(s, diagnostics);
    if (i.elseBranch) for (const s of i.elseBranch) scanStatement(s, diagnostics);
    break;
  }

  case 'while': {
    const w = stmt as any;
    if (w.condition) scanExpression(w.condition, line, col, diagnostics);
    if (w.body) for (const s of w.body) scanStatement(s, diagnostics);
    break;
  }

  case 'do_while': {
    const dw = stmt as any;
    if (dw.condition) scanExpression(dw.condition, line, col, diagnostics);
    if (dw.body) for (const s of dw.body) scanStatement(s, diagnostics);
    break;
  }

  case 'for': {
    const f = stmt as any;
    if (f.condition) scanExpression(f.condition, line, col, diagnostics);
    if (f.body) for (const s of f.body) scanStatement(s, diagnostics);
    break;
  }

  case 'for_of':
  case 'for_in': {
    const fi = stmt as any;
    if (fi.body) for (const s of fi.body) scanStatement(s, diagnostics);
    break;
  }

  case 'return': {
    const r = stmt as any;
    if (r.value) scanExpression(r.value, line, col, diagnostics);
    break;
  }

  case 'call': {
    const c = stmt as any;
    if (c.args) {
      for (const arg of c.args) {
        scanExpression(arg, line, col, diagnostics);
      }
    }
    break;
  }

  case 'switch': {
    const sw = stmt as any;
    if (sw.discriminant) scanExpression(sw.discriminant, line, col, diagnostics);
    if (sw.cases) for (const c of sw.cases) {
      if (c.statements) for (const s of c.statements) scanStatement(s, diagnostics);
    }
    break;
  }

  case 'block': {
    const b = stmt as any;
    if (b.statements) for (const s of b.statements) scanStatement(s, diagnostics);
    break;
  }

  case 'update': {
    const u = stmt as any;
    if (u.value) scanExpression(u.value, line, col, diagnostics);
    break;
  }

  default:
    break;
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
