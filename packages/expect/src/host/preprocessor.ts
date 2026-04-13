// ---------------------------------------------------------------------------
// @typecode/expect — AST Preprocessor
//
// Transforms fluent test syntax into flat Serial.print/println protocol
// calls that the typecode transpiler handles correctly.
//
// INPUT (user test file):
//   describe("A0 analog read")
//     .it("reads zero").expect(A0.readAnalog()).toBe(0);
//   done();
//
// OUTPUT (preprocessed — fed to transpiler):
//   Serial.begin(115200);
//   Serial.println("[TC:SUITE_START]");
//   Serial.println("[TC:DESCRIBE:A0 analog read]");
//   Serial.println("[TC:IT:reads zero]");
//   const __tc_v1: number = A0.readAnalog();
//   Serial.print("[TC:EXPECT:toBe:0:");
//   Serial.print(__tc_v1);
//   Serial.println("]");
//   Serial.println("[TC:SUITE_END]");
//   while (true) { delay(1000); }
// ---------------------------------------------------------------------------

import ts from 'typescript';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Preprocess a test file's TypeScript source.
 *
 * 1. Strips `import { ... } from '@typecode/expect'`
 * 2. Walks top-level expression-statements looking for `describe(...)...` chains
 * 3. Replaces `done()` with the suite-end sentinel + idle loop
 * 4. Hoists hardware expressions out of `expect()` into `const` declarations
 * 5. Wraps everything with Serial.initialize + SUITE_START preamble
 *
 * @param source  The raw TypeScript source of a `.test.ts` file.
 * @param fileName  Used for diagnostics.
 * @returns Preprocessed TypeScript source ready for the typecode transpiler.
 */
export function preprocess(source: string, fileName: string = 'test.ts'): string {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const ctx = new PreprocessorContext();

  // Collect non-expect imports to preserve
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
      if (moduleSpecifier === '@typecode/expect') {
        // Strip — the preprocessor replaces these calls with Serial protocol
        continue;
      }
      ctx.emit(stmt.getText(sf));
    } else if (ts.isExpressionStatement(stmt)) {
      processExpressionStatement(stmt, sf, ctx);
    } else {
      // Preserve other top-level statements as-is (variable decls, functions, etc.)
      ctx.emit(stmt.getText(sf));
    }
  }

  return ctx.build();
}

// ---------------------------------------------------------------------------
// Internal — Preprocessor context
// ---------------------------------------------------------------------------

class PreprocessorContext {
  private lines: string[] = [];
  private varCounter = 0;
  private preambleEmitted = false;
  private baudRate = 115200;

  /** Emit a line of TypeScript output. */
  emit(line: string): void {
    if (!this.preambleEmitted) {
      this.emitPreamble();
    }
    this.lines.push(line);
  }

  /** Generate a unique temporary variable name. */
  nextVar(): string {
    return `__tc_v${++this.varCounter}`;
  }

  /** Emit the Serial.begin + SUITE_START preamble (once). */
  private emitPreamble(): void {
    this.preambleEmitted = true;
    this.lines.push(`Serial.begin(${this.baudRate});`);
    this.lines.push(`Serial.println("[TC:SUITE_START]");`);
  }

  /** Build the final output source. */
  build(): string {
    return this.lines.join('\n') + '\n';
  }
}

// ---------------------------------------------------------------------------
// Internal — Statement processing
// ---------------------------------------------------------------------------

function processExpressionStatement(
  stmt: ts.ExpressionStatement,
  sf: ts.SourceFile,
  ctx: PreprocessorContext,
): void {
  const expr = stmt.expression;

  // Check for `done()` call
  if (isDoneCall(expr)) {
    ctx.emit(`Serial.println("[TC:SUITE_END]");`);
    ctx.emit(`while (true) { delay(1000); }`);
    return;
  }

  // Check for describe chain
  if (isDescribeChain(expr)) {
    walkChain(expr, sf, ctx);
    return;
  }

  // Fallthrough: emit as-is
  ctx.emit(stmt.getText(sf));
}

// ---------------------------------------------------------------------------
// Internal — Chain detection
// ---------------------------------------------------------------------------

/** Is this a `done()` call? */
function isDoneCall(expr: ts.Expression): boolean {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'done'
  );
}

/**
 * Does this expression root in a `describe(...)` call?
 * Walk through `.method()` chains looking for a `describe` identifier at the
 * bottom of the call chain.
 */
function isDescribeChain(expr: ts.Expression): boolean {
  return findDescribeRoot(expr) !== undefined;
}

/**
 * Walk a method chain to find the bottommost `describe(name)` call.
 */
function findDescribeRoot(expr: ts.Expression): ts.CallExpression | undefined {
  if (ts.isCallExpression(expr)) {
    // Direct `describe("name")` call
    if (ts.isIdentifier(expr.expression) && expr.expression.text === 'describe') {
      return expr;
    }
    // `something.method(args)` — recurse into the object
    if (ts.isPropertyAccessExpression(expr.expression)) {
      return findDescribeRoot(expr.expression.expression);
    }
  }
  // Property-access without call (shouldn't happen in valid code, but be safe)
  if (ts.isPropertyAccessExpression(expr)) {
    return findDescribeRoot(expr.expression);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal — Chain walking
//
// The fluent chain is a deeply nested AST:
//   outerCall( .matcher(args) )
//     └─ propertyAccess( .matcher )
//        └─ innerCall( .expect(actualExpr) )  [or .it(name)]
//           └─ propertyAccess( .expect )
//              └─ call/propertyAccess...
//                 └─ describe("name")
//
// We flatten it by recursively descending to the describe root, then
// emitting protocol statements in top-down order on the way back up.
// ---------------------------------------------------------------------------

/**
 * Represents a segment of the fluent chain to emit.
 */
interface ChainSegment {
  kind: 'describe' | 'it' | 'expect';
  /** For describe/it: the name string. */
  name?: string;
  /** For expect: the actual-value expression text. */
  actualExpr?: string;
  /** For expect: the matcher name (toBe, toBeLessThan, etc.). */
  matcher?: string;
  /** For expect: matcher argument texts. */
  matcherArgs?: string[];
}

function walkChain(expr: ts.Expression, sf: ts.SourceFile, ctx: PreprocessorContext): void {
  const segments = collectSegments(expr, sf);
  emitSegments(segments, ctx);
}

/**
 * Recursively collect chain segments from bottom (describe) to top (last matcher).
 */
function collectSegments(expr: ts.Expression, sf: ts.SourceFile): ChainSegment[] {
  const segments: ChainSegment[] = [];
  collectSegmentsRecursive(expr, sf, segments);
  return segments;
}

function collectSegmentsRecursive(
  expr: ts.Expression,
  sf: ts.SourceFile,
  segments: ChainSegment[],
): void {
  if (!ts.isCallExpression(expr)) {
    return;
  }

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
      // Recurse into the receiver first (process everything before this `.it()`)
      collectSegmentsRecursive(receiver, sf, segments);
      const name = extractStringArg(expr, 0, sf);
      segments.push({ kind: 'it', name: name ?? 'unnamed' });
    } else if (methodName === 'expect' || methodName === 'expectString') {
      // Recurse into the receiver first
      collectSegmentsRecursive(receiver, sf, segments);
      // The actual-value expression is the first argument
      const actualExpr = expr.arguments.length > 0
        ? expr.arguments[0].getText(sf)
        : '0';
      segments.push({ kind: 'expect', actualExpr });
    } else {
      // This is a matcher: toBe, toBeLessThan, etc.
      // The receiver should be an `.expect(...)` call — process it first
      // which will push the 'expect' segment.  Then we augment with matcher info.
      collectSegmentsRecursive(receiver, sf, segments);

      // The last segment should be an 'expect' — attach matcher info to it
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
// Internal — Segment emission
// ---------------------------------------------------------------------------

function emitSegments(segments: ChainSegment[], ctx: PreprocessorContext): void {
  for (const seg of segments) {
    switch (seg.kind) {
      case 'describe':
        ctx.emit(`Serial.println("[TC:DESCRIBE:${escapeProtocol(seg.name ?? '')}]");`);
        break;

      case 'it':
        ctx.emit(`Serial.println("[TC:IT:${escapeProtocol(seg.name ?? '')}]");`);
        break;

      case 'expect': {
        if (!seg.matcher) {
          // expect() without matcher — shouldn't happen in valid code, skip
          break;
        }
        // Hoist the actual-value expression into a const
        const tmpVar = ctx.nextVar();
        const isString = seg.matcher === 'toContain' || seg.matcher === 'toHaveLength'
          || (seg.matcher === 'toBe' && isStringExpression(seg.actualExpr ?? ''));
        const typeAnnotation = isString ? 'string' : 'number';

        // Determine if actual expression is simple (identifier/literal) or complex
        const actualExpr = seg.actualExpr ?? '0';
        const isSimple = isSimpleExpression(actualExpr);

        if (isSimple) {
          // No hoisting needed — can inline directly
          emitExpectProtocol(actualExpr, seg.matcher, seg.matcherArgs ?? [], ctx);
        } else {
          // Hoist: const __tc_v1: number = A0.readAnalog();
          ctx.emit(`const ${tmpVar}: ${typeAnnotation} = ${actualExpr};`);
          emitExpectProtocol(tmpVar, seg.matcher, seg.matcherArgs ?? [], ctx);
        }
        break;
      }
    }
  }
}

/**
 * Emit the Serial.print sequence for an assertion.
 *
 * Produces:  Serial.print("[TC:EXPECT:matcher:expected:");
 *            Serial.print(actual);
 *            Serial.println("]");
 */
function emitExpectProtocol(
  actualVar: string,
  matcher: string,
  matcherArgs: string[],
  ctx: PreprocessorContext,
): void {
  const expectedPart = matcherArgs.join(',');
  ctx.emit(`Serial.print("[TC:EXPECT:${matcher}:${expectedPart}:");`);
  ctx.emit(`Serial.print(${actualVar});`);
  ctx.emit(`Serial.println("]");`);
}

// ---------------------------------------------------------------------------
// Internal — Helpers
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
  // Fallthrough: use the raw text (may include quotes)
  return arg.getText(sf);
}

/**
 * Is the expression "simple" enough to inline (no method calls that need
 * hoisting for correct typecode translation)?
 *
 * Simple: identifiers, number literals, string literals.
 * Complex: anything with `.` method calls (e.g. `A0.readAnalog()`).
 */
function isSimpleExpression(expr: string): boolean {
  // If it contains a dot followed by a word and parens, it's a method call
  return !/\.\w+\s*\(/.test(expr);
}

/** Heuristic: is this an expression that produces a string? */
function isStringExpression(expr: string): boolean {
  // Starts with a quote → string literal
  if (/^["']/.test(expr)) return true;
  // Contains .readString or .readLine → string
  if (/\.readString|\.readLine/.test(expr)) return true;
  return false;
}

/** Escape characters that could break the protocol line format. */
function escapeProtocol(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
