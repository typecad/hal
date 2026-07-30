// ---------------------------------------------------------------------------
// @typecad/expect — AST Preprocessor
//
// Transforms fluent test syntax into flat Serial.print/println protocol
// calls that the cuttlefish transpiler handles correctly.
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
import { isDescribeChain, collectChainSegments } from './chain-collector.js';
import { emitSegments } from './protocol-emitter.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Describes how the test protocol emits output for a given framework.
 * Each framework provides its own shim so the preprocessor doesn't hardcode
 * Serial.* (which would force the Arduino core to be linked).
 */
export interface OutputShim {
  /** The init call emitted in the preamble, e.g. "Serial.begin(115200)". */
  begin: string;
  /** Print without newline — receives a fully-formed argument expression. */
  print: (expr: string) => string;
  /** Print with newline — receives a fully-formed argument expression. */
  println: (expr: string) => string;
  /** The idle-loop delay call after SUITE_END, e.g. "delay(1000)". */
  delay: string;
}

/** Default shim: Arduino HardwareSerial. */
export const serialShim: OutputShim = {
  begin: 'Serial.begin(115200)',
  print: (e) => `Serial.print(${e})`,
  println: (e) => `Serial.println(${e})`,
  delay: 'delay(1000)',
};

export interface PreprocessorOptions {
  /** Wrap string literals in Arduino F() macro to save SRAM on AVR. */
  isAvr?: boolean;
  /** Output shim — defaults to serialShim (Arduino HardwareSerial). */
  shim?: OutputShim;
}

/**
 * Preprocess a test file's TypeScript source.
 *
 * 1. Strips `import { ... } from '@typecad/expect'`
 * 2. Walks top-level expression-statements looking for `describe(...)...` chains
 * 3. Replaces `done()` with the suite-end sentinel + idle loop
 * 4. Hoists hardware expressions out of `expect()` into `const` declarations
 * 5. Wraps everything with Serial.initialize + SUITE_START preamble
 */
export function preprocess(source: string, fileName: string = 'test.ts', options?: PreprocessorOptions): string {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ctx = new PreprocessorContext(options?.isAvr ?? false, options?.shim);

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
      if (moduleSpecifier === '@typecad/expect') continue; // strip
      ctx.emit(stmt.getText(sf));
    } else if (ts.isExpressionStatement(stmt)) {
      processExpressionStatement(stmt, sf, ctx);
    } else {
      ctx.emit(stmt.getText(sf));
    }
  }

  return ctx.build();
}

// ---------------------------------------------------------------------------
// PreprocessorContext — shared state threaded through sub-modules
// ---------------------------------------------------------------------------

export class PreprocessorContext {
  private lines: string[] = [];
  private varCounter = 0;
  private fnCounter = 0;
  private preambleEmitted = false;
  readonly isAvr: boolean;
  readonly shim: OutputShim;

  constructor(isAvr: boolean, shim: OutputShim = serialShim) {
    this.isAvr = isAvr;
    this.shim = shim;
  }

  /** Wrap a string literal in F() on AVR to keep it in flash.
   *  Only applies when using the serialShim (Arduino core provides F()). */
  flash(s: string): string {
    return this.isAvr ? `F("${s}")` : `"${s}"`;
  }

  /** Emit a line of TypeScript output. */
  emit(line: string): void {
    if (!this.preambleEmitted) this.emitPreamble();
    this.lines.push(line);
  }

  /** Generate a unique temporary variable name. */
  nextVar(): string {
    return `__tc_v${++this.varCounter}`;
  }

  /** Generate a unique extracted function name. */
  nextFn(): string {
    return `__tc_fn${++this.fnCounter}`;
  }

  private emitPreamble(): void {
    this.preambleEmitted = true;
    this.lines.push(`${this.shim.begin};`);
    this.lines.push(`${this.shim.println(this.flash('[TC:SUITE_START]'))};`);
  }

  build(): string {
    return this.lines.join('\n') + '\n';
  }
}

// ---------------------------------------------------------------------------
// Statement processing
// ---------------------------------------------------------------------------

function processExpressionStatement(
  stmt: ts.ExpressionStatement,
  sf: ts.SourceFile,
  ctx: PreprocessorContext,
): void {
  const expr = stmt.expression;

  if (isDoneCall(expr)) {
    ctx.emit(`${ctx.shim.println(ctx.flash('[TC:SUITE_END]'))};`);
    ctx.emit(`while (true) { ${ctx.shim.delay}; }`);
    return;
  }

  if (isDescribeChain(expr)) {
    const segments = collectChainSegments(expr, sf, ctx);
    emitSegments(segments, ctx);
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

