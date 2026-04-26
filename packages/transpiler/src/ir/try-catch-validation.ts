// ---------------------------------------------------------------------------
// Try/Catch Validation
//
// Validates that try/catch and throw statements are not used on architectures
// that do not support C++ exceptions (e.g., AVR). AVR-GCC compiles with
// -fno-exceptions by default, so generated try/catch blocks will fail to
// compile. Emits a compile-time error with an actionable hint.
// ---------------------------------------------------------------------------

import type { Diagnostic } from '../types';
import type { BoardConstants } from './board-resolver';
import type { StatementIR } from './model';

/**
 * Architectures that do NOT support C++ exceptions.
 * AVR and megaAVR compile with -fno-exceptions by default.
 */
const NO_EXCEPTIONS_ARCHS = new Set(['avr', 'megaavr']);

/**
 * Validate that try/catch and throw statements are not used on
 * architectures without C++ exception support.
 *
 * @param program - The program IR to validate
 * @param boardConstants - Board constants containing architecture info
 * @returns Array of error diagnostics for try/catch/throw usage
 */
export function validateTryCatch(
  program: {
    topLevelStatements: StatementIR[];
    functions: Array<{ statements: StatementIR[] }>;
    classes: Array<{
      methods: Array<{ statements: StatementIR[] }>;
      constructor?: { statements: StatementIR[] };
    }>;
  },
  boardConstants: BoardConstants | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const arch = boardConstants?.get('architecture') as string | undefined;
  if (!arch || !NO_EXCEPTIONS_ARCHS.has(arch)) {
    // Architecture supports exceptions or is unknown — allow without diagnostic
    return diagnostics;
  }

  // Scan all statements for try/catch and throw
  const scanStatements = (stmts: StatementIR[]): void => {
    for (const stmt of stmts) {
      scanStatement(stmt);
    }
  };

  const scanStatement = (stmt: StatementIR): void => {
    if (!stmt || typeof stmt !== 'object') return;

    if (stmt.kind === 'try') {
      const tryStmt = stmt as any;
      diagnostics.push({
        severity: 'error',
        code: 'try-catch-unsupported',
        message: `try/catch is not supported on ${arch.toUpperCase()} targets. ` +
                 `AVR-GCC disables C++ exceptions (-fno-exceptions) and the generated ` +
                 `code will not compile. Use return-code error checking instead.`,
        hint: `function readSensor(): number | null {\n  const data = sensor.read();\n  if (!data) return null;  // error path\n  return data.value;       // success path\n}`,
        line: (stmt as any).sourceSpan?.startLine,
        column: (stmt as any).sourceSpan?.startColumn,
        source: 'try-catch-validation',
      });
      // Still recurse into nested blocks to find other try/catch
      scanStatements(tryStmt.tryBlock ?? []);
      scanStatements(tryStmt.catchBlock ?? []);
      scanStatements(tryStmt.finallyBlock ?? []);
      return;
    }

    if (stmt.kind === 'throw') {
      diagnostics.push({
        severity: 'error',
        code: 'try-catch-unsupported',
        message: `throw is not supported on ${arch.toUpperCase()} targets. ` +
                 `AVR-GCC disables C++ exceptions (-fno-exceptions). ` +
                 `Use return codes or error flags instead.`,
        hint: `return null;  // or return an error code`,
        line: (stmt as any).sourceSpan?.startLine,
        column: (stmt as any).sourceSpan?.startColumn,
        source: 'try-catch-validation',
      });
      return;
    }

    // Recurse into nested statement containers
    scanNested(stmt, scanStatement);
  };

  // Scan top-level statements
  scanStatements(program.topLevelStatements);

  // Scan function bodies
  for (const fn of program.functions) {
    scanStatements(fn.statements);
  }

  // Scan class methods and constructors
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      scanStatements(method.statements);
    }
    if (cls.constructor) {
      scanStatements(cls.constructor.statements);
    }
  }

  return diagnostics;
}

/**
 * Recurse into nested statement containers of a given statement.
 * Calls the visitor for each nested statement found.
 */
function scanNested(stmt: StatementIR, visitor: (s: StatementIR) => void): void {
  const s = stmt as any;

  // if
  if (s.thenBranch) {
    for (const child of s.thenBranch) visitor(child);
  }
  if (s.elseBranch) {
    for (const child of s.elseBranch) visitor(child);
  }

  // while, do_while
  if (s.body && Array.isArray(s.body)) {
    for (const child of s.body) visitor(child);
  }

  // for, for_of, for_in
  if (s.body && Array.isArray(s.body)) {
    for (const child of s.body) visitor(child);
  }

  // switch
  if (s.cases && Array.isArray(s.cases)) {
    for (const c of s.cases) {
      if (c.body && Array.isArray(c.body)) {
        for (const child of c.body) visitor(child);
      }
    }
  }

  // block
  if (s.statements && Array.isArray(s.statements) && stmt.kind === 'block') {
    for (const child of s.statements) visitor(child);
  }

  // labeled
  if (s.body && Array.isArray(s.body) && stmt.kind === 'labeled') {
    for (const child of s.body) visitor(child);
  }
}
