// ---------------------------------------------------------------------------
// cuttlefish test-runner — Chain Collector
//
// Pure functions for detecting and extracting the fluent describe().it().expect()
// chain segments from a TypeScript AST.  No I/O or protocol emission.
// ---------------------------------------------------------------------------

import ts from 'typescript';
import type { PreprocessorContext } from './preprocessor.js';

// ---------------------------------------------------------------------------
// Chain segment types
// ---------------------------------------------------------------------------

/**
 * Represents a single segment of a fluent describe().it().expect().matcher() chain.
 */
export interface ChainSegment {
  kind: 'describe' | 'it' | 'expect';
  /** For describe/it: the label string. */
  name?: string;
  /** For expect: the actual-value expression text. */
  actualExpr?: string;
  /** For expect: the matcher name (toBe, toBeLessThan, etc.). */
  matcher?: string;
  /** For expect: matcher argument texts. */
  matcherArgs?: string[];
  /** True when the chain used .expectString() rather than .expect(). */
  isStringExpect?: boolean;
  /** For expect with function arg: named function definition to emit before the chain. */
  extractedFn?: string;
}

// ---------------------------------------------------------------------------
// Chain detection
// ---------------------------------------------------------------------------

/**
 * Does this expression root in a `describe(...)` call?
 */
export function isDescribeChain(expr: ts.Expression): boolean {
  return findDescribeRoot(expr) !== undefined;
}

/**
 * Walk a method chain to find the bottommost `describe(name)` call.
 */
export function findDescribeRoot(expr: ts.Expression): ts.CallExpression | undefined {
  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression) && expr.expression.text === 'describe') {
      return expr;
    }
    if (ts.isPropertyAccessExpression(expr.expression)) {
      return findDescribeRoot(expr.expression.expression);
    }
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return findDescribeRoot(expr.expression);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Chain walking
// ---------------------------------------------------------------------------

/**
 * Flatten a fluent chain AST into an ordered list of segments.
 * Segments are collected bottom-up (describe → it → expect → matcher).
 */
export function collectChainSegments(
  expr: ts.Expression,
  sf: ts.SourceFile,
  ctx: PreprocessorContext,
): ChainSegment[] {
  const segments: ChainSegment[] = [];
  collectSegmentsRecursive(expr, sf, segments, ctx);
  return segments;
}

function collectSegmentsRecursive(
  expr: ts.Expression,
  sf: ts.SourceFile,
  segments: ChainSegment[],
  ctx: PreprocessorContext,
): void {
  if (!ts.isCallExpression(expr)) return;

  // Case 1: `describe("name")`
  if (ts.isIdentifier(expr.expression) && expr.expression.text === 'describe') {
    const name = extractStringArg(expr, 0, sf);
    segments.push({ kind: 'describe', name: name ?? 'unnamed' });
    return;
  }

  // Case 2: `receiver.method(args)` — a method in the chain
  if (ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    const receiver = expr.expression.expression;

    if (methodName === 'it') {
      collectSegmentsRecursive(receiver, sf, segments, ctx);
      const name = extractStringArg(expr, 0, sf);
      segments.push({ kind: 'it', name: name ?? 'unnamed' });
    } else if (methodName === 'expect' || methodName === 'expectString') {
      collectSegmentsRecursive(receiver, sf, segments, ctx);
      const argNode = expr.arguments[0];
      const isString = methodName === 'expectString';
      const fnInfo = argNode ? tryExtractFunction(argNode, sf, ctx, isString) : null;
      if (fnInfo) {
        segments.push({
          kind: 'expect',
          actualExpr: fnInfo.fnCall,
          isStringExpect: isString,
          extractedFn: fnInfo.fnDef,
        });
      } else {
        const actualExpr = argNode ? argNode.getText(sf) : '0';
        segments.push({ kind: 'expect', actualExpr, isStringExpect: isString });
      }
    } else {
      // This is a matcher: toBe, toBeLessThan, etc.
      collectSegmentsRecursive(receiver, sf, segments, ctx);
      const last = segments[segments.length - 1];
      if (last && last.kind === 'expect') {
        last.matcher = methodName;
        last.matcherArgs = [];
        for (const arg of expr.arguments) {
          last.matcherArgs.push(arg.getText(sf));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the string literal value from argument at `index`, or `undefined`. */
function extractStringArg(
  call: ts.CallExpression,
  index: number,
  sf: ts.SourceFile,
): string | undefined {
  const arg = call.arguments[index];
  if (!arg) return undefined;
  if (ts.isStringLiteral(arg)) return arg.text;
  if (ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return arg.getText(sf);
}

// ---------------------------------------------------------------------------
// Function extraction
// ---------------------------------------------------------------------------

/** Result of extracting a function passed to expect(). */
interface ExtractedFnInfo {
  fnDef: string;
  fnCall: string;
}

/**
 * Detect an arrow/function expression or IIFE passed to expect() and
 * convert it into a named function definition + call.
 *
 * Handles both:
 *   `.expect(() => { ... })`       — direct function
 *   `.expect((() => { ... })())`   — IIFE
 */
export function tryExtractFunction(
  node: ts.Expression,
  sf: ts.SourceFile,
  ctx: PreprocessorContext,
  isStringExpect?: boolean,
): ExtractedFnInfo | null {
  // Unwrap IIFE
  let fnNode: ts.Expression = node;
  if (ts.isCallExpression(node)) {
    let callee: ts.Node = node.expression;
    while (ts.isParenthesizedExpression(callee)) {
      callee = callee.expression;
    }
    if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
      fnNode = callee as ts.Expression;
    } else {
      return null;
    }
  }

  if (ts.isParenthesizedExpression(fnNode)) {
    fnNode = fnNode.expression;
  }

  if (!ts.isArrowFunction(fnNode) && !ts.isFunctionExpression(fnNode)) return null;
  if (fnNode.parameters.length > 0) return null;

  const fnName = ctx.nextFn();
  const body = fnNode.body;

  let fnBody: string;
  if (ts.isBlock(body)) {
    fnBody = body.getText(sf);
  } else {
    fnBody = `{ return ${body.getText(sf)}; }`;
  }

  const returnType = isStringExpect ? 'string' : 'number';
  const fnDef = `function ${fnName}(): ${returnType} ${fnBody}`;
  const fnCall = `${fnName}()`;

  return { fnDef, fnCall };
}
