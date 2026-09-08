// ---------------------------------------------------------------------------
// cuttlefish test-runner — AST Preprocessor
//
// Transforms fluent test syntax into flat Serial.print/println protocol
// calls that the typecad-hal transpiler handles correctly.
//
// INPUT (user test file):
//   describe("A0 analog read")
//     .it("reads zero").expect(A0.readAnalog()).toBe(0);
//   done();
//
// OUTPUT (preprocessed — fed to transpiler):
//   __tc_println("[TC:SUITE_START]");
//   __tc_println("[TC:DESCRIBE:A0 analog read]");
//   __tc_println("[TC:IT:reads zero]");
//   const __tc_v1: number = A0.readAnalog();
//   __tc_print("[TC:EXPECT:toBe:0:");
//   __tc_print(__tc_v1);
//   __tc_println("]");
//   __tc_println("[TC:SUITE_END]");
//   while (true) { k_msleep(1000); }
// ---------------------------------------------------------------------------

import ts from 'typescript';
import { isDescribeChain, collectChainSegments } from './chain-collector.js';
import { emitSegments } from './protocol-emitter.js';
import type { TestPinsSubstitutions } from './test-pins.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Describes how the test protocol emits output for a given framework.
 * Each framework provides its own shim so the preprocessor doesn't hardcode
 * a specific console API.
 */
export interface OutputShim {
  /** The init call emitted in the preamble, e.g. "Serial.begin(115200)". Empty when the console self-initializes. */
  begin: string;
  /** Print without newline — receives a fully-formed argument expression. */
  print: (expr: string) => string;
  /** Print with newline — receives a fully-formed argument expression. */
  println: (expr: string) => string;
  /** The idle-loop delay call after SUITE_END, e.g. "k_msleep(1000)". */
  delay: string;
}

/**
 * Zephyr shim (the default): uses overloaded __tc_print/__tc_println helpers
 * that handle both string and numeric (double) output via printf. The Zephyr
 * strategy's shimLines emits these helper definitions. k_msleep replaces
 * delay().
 */
export const zephyrShim: OutputShim = {
  begin: '',  // Zephyr console auto-initializes via DT; no explicit begin needed
  print: (e) => `__tc_print(${e})`,
  println: (e) => `__tc_println(${e})`,
  delay: 'k_msleep(1000)',
};

export interface PreprocessorOptions {
  /** Output shim — defaults to the Zephyr __tc_print helpers. */
  shim?: OutputShim;
  /**
   * Board test-pins substitutions (role const -> replacement text). When
   * present, every role identifier in the source is replaced with the
   * board's real pin symbol (or numeric fact), and a synthesized
   * `import { <used pins> } from '@typecad/hal'` is prepended. The
   * '@typecad/test-pins' import itself is stripped — the transpiler never
   * sees the virtual specifier.
   */
  testPins?: TestPinsSubstitutions;
}

/**
 * Preprocess a test file's TypeScript source.
 *
 * 1. Strips `import { ... } from '@typecad/hal/testing'` and
 *    `import { ... } from '@typecad/test-pins'`
 * 2. Walks top-level expression-statements looking for `describe(...)...` chains
 * 3. Replaces `done()` with the suite-end sentinel + idle loop
 * 4. Hoists hardware expressions out of `expect()` into `const` declarations
 * 5. Wraps everything with the console init + SUITE_START preamble
 * 6. Substitutes test-pin role identifiers with the board's real pin symbols
 */
export function preprocess(source: string, fileName: string = 'test.ts', options?: PreprocessorOptions): string {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ctx = new PreprocessorContext(options?.shim, options?.testPins);

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
      if (moduleSpecifier === '@typecad/hal/testing') continue; // strip — stubs are type-level only
      if (moduleSpecifier === '@typecad/test-pins') continue; // stripped; roles are substituted inline
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
  readonly shim: OutputShim;
  /** Role const -> replacement text (board pin symbols / numeric facts). */
  private readonly substitutions?: TestPinsSubstitutions;
  /** Pin symbols seen in substitutions that actually replaced something. */
  private readonly usedPins = new Set<string>();

  constructor(shim: OutputShim = zephyrShim, substitutions?: TestPinsSubstitutions) {
    this.shim = shim;
    this.substitutions = substitutions;
  }

  /** Quote a protocol string literal for the active shim. */
  quote(s: string): string {
    return `"${s}"`;
  }

  /** Emit a line of TypeScript output. */
  emit(line: string): void {
    if (!this.preambleEmitted) this.emitPreamble();
    this.lines.push(this.substitute(line));
  }

  /** Generate a unique temporary variable name. */
  nextVar(): string {
    return `__tc_v${++this.varCounter}`;
  }

  /** Generate a unique extracted function name. */
  nextFn(): string {
    return `__tc_fn${++this.fnCounter}`;
  }

  /**
   * Replace whole-word role identifiers with their board-specific text.
   * Role const names are SCREAMING_SNAKE and never appear in protocol
   * strings, so a word-boundary replace over the emitted statement text is
   * safe. Pin symbols referenced by a used replacement are recorded so the
   * synthesized board import covers them.
   */
  private substitute(line: string): string {
    if (!this.substitutions || this.substitutions.size === 0) return line;

    let result = line;
    for (const [role, replacement] of this.substitutions) {
      const pattern = new RegExp(`\\b${role}\\b`, 'g');
      if (!pattern.test(result)) continue;
      result = result.replace(pattern, replacement);
      for (const pin of replacement.matchAll(/[A-Za-z_$][\w$]*/g)) {
        if (!/^\d/.test(pin[0])) this.usedPins.add(pin[0]);
      }
    }
    return result;
  }

  private emitPreamble(): void {
    this.preambleEmitted = true;
    // Shims whose console self-initializes (Zephyr DT) have an empty begin.
    if (this.shim.begin) this.lines.push(`${this.shim.begin};`);
    this.lines.push(`${this.shim.println(this.quote('[TC:SUITE_START]'))};`);
  }

  build(): string {
    const parts: string[] = [];
    // Synthesized import for the substituted pins — must be a top-level
    // statement; placed first so the (untype-checked) source reads naturally.
    if (this.usedPins.size > 0) {
      parts.push(`import { ${[...this.usedPins].join(', ')} } from '@typecad/hal';`);
    }
    parts.push(...this.lines);
    return parts.join('\n') + '\n';
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
    ctx.emit(`${ctx.shim.println(ctx.quote('[TC:SUITE_END]'))};`);
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

