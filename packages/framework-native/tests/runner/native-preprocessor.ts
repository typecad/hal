// ---------------------------------------------------------------------------
// Native test preprocessor
//
// Rewrites describe/it/expect/done fluent chains into console.log("[TC:...]")
// protocol lines for native executable testing. The transpiler maps console.log
// to std::cout, so the exe prints protocol lines to stdout for parsing.
// ---------------------------------------------------------------------------

import ts from 'typescript';
import { isDescribeChain, collectChainSegments } from '@typecad/expect/chain-collector';
import type { ChainSegment } from '@typecad/expect/chain-collector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeProtocol(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ---------------------------------------------------------------------------
// NativePreprocessorContext
// ---------------------------------------------------------------------------

class NativePreprocessorContext {
  private lines: string[] = [];
  private fnCounter = 0;
  private varCounter = 0;
  private preambleEmitted = false;

  nextFn(): string {
    return `__tc_fn${++this.fnCounter}`;
  }

  nextVar(): string {
    return `__tc_v${++this.varCounter}`;
  }

  emit(line: string): void {
    if (!this.preambleEmitted) {
      this.preambleEmitted = true;
      this.lines.push(`console.log("[TC:SUITE_START]");`);
    }
    this.lines.push(line);
  }

  build(): string {
    return this.lines.join('\n') + '\n';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function nativePreprocess(source: string, fileName: string = 'test.ts'): string {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ctx = new NativePreprocessorContext();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const mod = (stmt.moduleSpecifier as ts.StringLiteral).text;
      if (mod === '@typecad/expect') continue;
      ctx.emit(stmt.getText(sf));
    } else if (ts.isExpressionStatement(stmt)) {
      processStatement(stmt, sf, ctx);
    } else {
      ctx.emit(stmt.getText(sf));
    }
  }

  return ctx.build();
}

// ---------------------------------------------------------------------------
// Statement processing
// ---------------------------------------------------------------------------

function processStatement(
  stmt: ts.ExpressionStatement,
  sf: ts.SourceFile,
  ctx: NativePreprocessorContext,
): void {
  const expr = stmt.expression;

  if (isDoneCall(expr)) {
    ctx.emit(`console.log("[TC:SUITE_END]");`);
    return;
  }

  if (isDescribeChain(expr)) {
    const segments = collectChainSegments(expr, sf, ctx as any);
    emitNativeSegments(segments, ctx);
    return;
  }

  ctx.emit(stmt.getText(sf));
}

function isDoneCall(expr: ts.Expression): boolean {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'done'
  );
}

// ---------------------------------------------------------------------------
// Native protocol emission
// ---------------------------------------------------------------------------

function isSimpleExpression(expr: string): boolean {
  return !/\.\w+\s*\(/.test(expr);
}

function isStringExpression(expr: string): boolean {
  if (/^["']/.test(expr)) return true;
  if (/\.readString|\.readLine/.test(expr)) return true;
  return false;
}

function emitNativeSegments(segments: ChainSegment[], ctx: NativePreprocessorContext): void {
  // First pass: emit extracted function definitions
  for (const seg of segments) {
    if (seg.kind === 'expect' && seg.extractedFn) {
      ctx.emit(seg.extractedFn);
    }
  }

  // Second pass: emit protocol lines via console.log
  for (const seg of segments) {
    switch (seg.kind) {
      case 'describe':
        ctx.emit(`console.log("[TC:DESCRIBE:${escapeProtocol(seg.name ?? '')}]");`);
        break;

      case 'it':
        ctx.emit(`console.log("[TC:IT:${escapeProtocol(seg.name ?? '')}]");`);
        break;

      case 'expect': {
        if (!seg.matcher) break;
        const actualExpr = seg.actualExpr ?? '0';
        const isString =
          seg.isStringExpect ||
          seg.matcher === 'toContain' ||
          seg.matcher === 'toHaveLength' ||
          (seg.matcher === 'toBe' && isStringExpression(actualExpr));
        const typeAnnotation = isString ? 'string' : 'number';

        if (isSimpleExpression(actualExpr)) {
          emitExpectLine(actualExpr, seg.matcher, seg.matcherArgs ?? [], ctx, isString);
        } else {
          const tmpVar = ctx.nextVar();
          ctx.emit(`const ${tmpVar}: ${typeAnnotation} = ${actualExpr};`);
          emitExpectLine(tmpVar, seg.matcher, seg.matcherArgs ?? [], ctx, isString);
        }
        break;
      }
    }
  }
}

function emitExpectLine(
  actualVar: string,
  matcher: string,
  matcherArgs: string[],
  ctx: NativePreprocessorContext,
  isString: boolean,
): void {
  if (isString && matcher === 'toBe') {
    const rawExpected = (matcherArgs[0] ?? '').replace(/^["']|["']$/g, '');
    ctx.emit(
      `console.log("[TC:EXPECT:${matcher}:${escapeProtocol(rawExpected)}:" + String(${actualVar}) + "]");`,
    );
    return;
  }
  const expectedPart = matcherArgs.join(',');
  ctx.emit(
    `console.log("[TC:EXPECT:${matcher}:${expectedPart}:" + String(${actualVar}) + "]");`,
  );
}
