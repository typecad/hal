// ---------------------------------------------------------------------------
// cuttlefish test-runner — Protocol Emitter
//
// Converts collected chain segments into Serial.print/println protocol lines.
// All logic for the [TC:DESCRIBE:...], [TC:IT:...], [TC:EXPECT:...] wire
// format lives here.
// ---------------------------------------------------------------------------

import type { PreprocessorContext } from './preprocessor.js';
import type { ChainSegment } from './chain-collector.js';

// ---------------------------------------------------------------------------
// Segment emission
// ---------------------------------------------------------------------------

/**
 * Emit all Serial protocol lines for a collected chain.
 */
export function emitSegments(segments: ChainSegment[], ctx: PreprocessorContext): void {
  // First pass: emit any extracted function definitions before the protocol
  for (const seg of segments) {
    if (seg.kind === 'expect' && seg.extractedFn) {
      ctx.emit(seg.extractedFn);
    }
  }

  // Second pass: emit protocol lines
  for (const seg of segments) {
    switch (seg.kind) {
      case 'describe':
        ctx.emit(`${ctx.shim.println(ctx.quote(`[TC:DESCRIBE:${escapeProtocol(seg.name ?? '')}]`))};`);
        break;

      case 'it':
        ctx.emit(`${ctx.shim.println(ctx.quote(`[TC:IT:${escapeProtocol(seg.name ?? '')}]`))};`);
        break;

      case 'expect': {
        if (!seg.matcher) break; // expect() without matcher — skip

        const actualExpr = seg.actualExpr ?? '0';
        const isString = seg.isStringExpect || seg.matcher === 'toContain' || seg.matcher === 'toHaveLength'
          || (seg.matcher === 'toBe' && isStringExpression(actualExpr));
        const typeAnnotation = isString ? 'string' : 'number';

        if (isSimpleExpression(actualExpr)) {
          emitExpectProtocol(actualExpr, seg.matcher, seg.matcherArgs ?? [], ctx, isString);
        } else {
          // Hoist: const __tc_v1: number = A0.readAnalog();
          const tmpVar = ctx.nextVar();
          ctx.emit(`const ${tmpVar}: ${typeAnnotation} = ${actualExpr};`);
          emitExpectProtocol(tmpVar, seg.matcher, seg.matcherArgs ?? [], ctx, isString);
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Protocol line builder
// ---------------------------------------------------------------------------

/**
 * Emit the Serial.print sequence for one assertion.
 *
 * Numeric:  Serial.print("[TC:EXPECT:matcher:expected:");
 *           Serial.print(actual);
 *           Serial.println("]");
 *
 * String:   Serial.print("[TC:EXPECT:matcher:");
 *           Serial.print("expected");
 *           Serial.print(":");
 *           Serial.print(actual);
 *           Serial.println("]");
 */
export function emitExpectProtocol(
  actualVar: string,
  matcher: string,
  matcherArgs: string[],
  ctx: PreprocessorContext,
  isString: boolean = false,
): void {
  if (isString && matcher === 'toBe') {
    const rawExpected = (matcherArgs[0] ?? '').replace(/^["']|["']$/g, '');
    ctx.emit(`${ctx.shim.print(ctx.quote(`[TC:EXPECT:${matcher}:`))};`);
    ctx.emit(`${ctx.shim.print(`"${escapeProtocol(rawExpected)}"`)};`);
    ctx.emit(`${ctx.shim.print(ctx.quote(':'))};`);
    ctx.emit(`${ctx.shim.print(actualVar)};`);
    ctx.emit(`${ctx.shim.println(ctx.quote(']'))};`);
    return;
  }
  const expectedPart = matcherArgs.join(',');
  ctx.emit(`${ctx.shim.print(ctx.quote(`[TC:EXPECT:${matcher}:${expectedPart}:`))};`);
  ctx.emit(`${ctx.shim.print(actualVar)};`);
  ctx.emit(`${ctx.shim.println(ctx.quote(']'))};`);
}

// ---------------------------------------------------------------------------
// Expression classification helpers
// ---------------------------------------------------------------------------

/**
 * Is the expression "simple" enough to inline without hoisting?
 * Simple: identifiers, literals.  Complex: anything with method calls.
 */
export function isSimpleExpression(expr: string): boolean {
  return !/\.\w+\s*\(/.test(expr);
}

/** Heuristic: does this expression produce a string? */
export function isStringExpression(expr: string): boolean {
  if (/^["']/.test(expr)) return true;
  if (/\.readString|\.readLine/.test(expr)) return true;
  return false;
}

/** Escape characters that could break the protocol line format. */
export function escapeProtocol(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
