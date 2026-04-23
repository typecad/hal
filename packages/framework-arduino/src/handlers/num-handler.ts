// ---------------------------------------------------------------------------
// Num namespace handler — maps TypeCode Num.* calls to Arduino C++ math
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typecode/core/shared';

/**
 * Render Num namespace direct function calls to Arduino C++.
 */
export function renderNumCall(
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  switch (method) {
    case 'abs':
      return `abs(${a(0)})`;
    case 'min':
      return `min(${a(0)}, ${a(1)})`;
    case 'max':
      return `max(${a(0)}, ${a(1)})`;
    case 'constrain':
    case 'clamp':
      return `constrain(${a(0)}, ${a(1)}, ${a(2)})`;
    case 'inRange':
      return `((${a(0)}) >= (${a(1)}) && (${a(0)}) <= (${a(2)}))`;
    case 'toPercent':
      return `map(${a(0)}, ${a(1)}, ${a(2)}, 0, 100)`;
    case 'toByte':
      return `map(${a(0)}, ${a(1)}, ${a(2)}, 0, 255)`;
  }

  return undefined;
}

/**
 * Render Num fluent chain calls to Arduino C++.
 *
 * Fluent chains:
 * - Num.map(value).from(fL, fH).to(tL, tH)  → map(value, fL, fH, tL, tH)
 * - Num.map(value).from(fL, fH).toPercent()  → map(value, fL, fH, 0, 100)
 * - Num.map(value).from(fL, fH).toByte()     → map(value, fL, fH, 0, 255)
 * - Num.constrain(value).between(low, high)  → constrain(value, low, high)
 */
export function renderFluentNum(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  if (parts[1] === 'map') {
    if (parts.length === 2) {
      return `/* Num.map(${a(0)}) chain */`;
    }
    if (parts.length === 3 && parts[2] === 'from') {
      return `/* Num.map chain: from(${a(0)}, ${a(1)}) */`;
    }
    if (parts.length === 4) {
      if (parts[2] === 'from' && parts[3] === 'to') return undefined;
      if (parts[2] === 'from' && parts[3] === 'toPercent') return undefined;
      if (parts[2] === 'from' && parts[3] === 'toByte') return undefined;
      if (parts[2] === 'from' && parts[3] === 'constrain') return undefined;
    }
  }

  if (parts[1] === 'constrain') {
    if (parts.length === 2) {
      return `/* Num.constrain(${a(0)}) chain */`;
    }
    if (parts.length === 3 && parts[2] === 'between') {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Handle all Num.* call-statement patterns, including direct calls, fluent
 * chains and the 5-arg map() shorthand.
 */
export function renderNumNamespace(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  if (parts.length === 2) {
    return renderNumCall(parts[1], args, renderArg);
  }

  if (parts.length === 3) {
    // Num.map(v, fL, fH, tL, tH) — callable-interface 5-arg variant
    if (parts[1] === 'map' && parts[2] !== 'from' && parts[2] !== 'to' && args.length === 5) {
      return `map(${a(0)}, ${a(1)}, ${a(2)}, ${a(3)}, ${a(4)})`;
    }
    return renderNumCall(parts[1], args, renderArg);
  }

  if (parts.length === 4) {
    // Num.map(value).from(fL, fH).to(tL, tH)
    if (parts[1] === 'map' && parts[2] === 'from') {
      if (parts[3] === 'to')        return `/* Num.map chain - requires chain tracking */`;
      if (parts[3] === 'toPercent') return `/* Num.map().toPercent() chain */`;
      if (parts[3] === 'toByte')    return `/* Num.map().toByte() chain */`;
    }
    // Num.constrain(value).between(low, high)
    if (parts[1] === 'constrain' && parts[2] === 'between') {
      return `/* Num.constrain().between() chain */`;
    }
  }

  return renderFluentNum(parts, args, renderArg);
}
