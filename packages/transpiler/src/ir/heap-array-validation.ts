// ---------------------------------------------------------------------------
// Heap Allocation Validator
//
// On AVR (Arduino Uno, Mega, etc.) dynamic heap allocation via `new` is
// unsafe: the AVR has very limited SRAM (typically 2 KB), no OS to reclaim
// fragmented heap, and the C++ runtime provides no protection against
// malloc() failures.  Emits a compile-time error when a `new` expression is
// detected in a variable initializer so the developer gets an early,
// actionable message rather than a silent runtime crash.
//
// Arrays and class instances that are managed by the TypeCode framework
// (StaticArray, peripheral objects created by board-init, compile-time-only
// strategy instances) are intentionally excluded from this check.
// ---------------------------------------------------------------------------

import type { Diagnostic } from '../types';
import type { BoardConstants } from './board-resolver';
import type { StatementIR } from './model';

/**
 * Architectures where heap allocation via `operator new` is unsafe.
 */
const NO_HEAP_ARCHS = new Set(['avr', 'megaavr']);

/**
 * Validate that user-written `new ClassName(...)` expressions are not used on
 * architectures that lack safe heap support.
 *
 * @param program - The program IR to validate
 * @param boardConstants - Board constants containing architecture info
 * @returns Array of error diagnostics for heap-allocation usage
 */
export function validateHeapArrayUsage(
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
  if (!arch || !NO_HEAP_ARCHS.has(arch)) {
    return diagnostics;
  }

  const scanStatements = (stmts: StatementIR[]): void => {
    for (const stmt of stmts) {
      scanStatement(stmt);
    }
  };

  const scanStatement = (stmt: StatementIR): void => {
    if (!stmt || typeof stmt !== 'object') return;

    if (stmt.kind === 'var_decl') {
      const decl = stmt as any;
      const init = decl.initializer;
      if (
        init &&
        init.kind === 'raw' &&
        typeof init.value === 'string' &&
        /^new\s+\w/.test(init.value)
      ) {
        // Extract the class name for a more helpful message
        const match = (init.value as string).match(/^new\s+(\w+)/);
        const className = match ? match[1] : 'unknown';
        diagnostics.push({
          severity: 'error',
          code: 'heap-allocation-avr',
          message:
            `Heap allocation (\`new ${className}()\`) is unsafe on ${arch.toUpperCase()} targets. ` +
            `AVR has only 2 KB of SRAM and no heap manager; \`operator new\` will corrupt memory or ` +
            `silently fail. Declare the object as a local or global variable instead.`,
          hint:
            `// Instead of:\n` +
            `// const obj = new ${className}(args);\n` +
            `// Use a global or local struct/object:\n` +
            `// ${className} obj(args);  // stack-allocated in C++`,
          line: (stmt as any).sourceSpan?.startLine,
          column: (stmt as any).sourceSpan?.startColumn,
          source: 'heap-array-validation',
        });
      }
    }

    // Recurse into nested statement containers
    scanNested(stmt, scanStatement);
  };

  scanStatements(program.topLevelStatements);

  for (const fn of program.functions) {
    scanStatements(fn.statements);
  }

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
 */
function scanNested(stmt: StatementIR, visitor: (s: StatementIR) => void): void {
  const s = stmt as any;

  if (s.thenBranch) {
    for (const child of s.thenBranch) visitor(child);
  }
  if (s.elseBranch) {
    for (const child of s.elseBranch) visitor(child);
  }

  if (s.body && Array.isArray(s.body)) {
    for (const child of s.body) visitor(child);
  }

  if (s.tryBlock && Array.isArray(s.tryBlock)) {
    for (const child of s.tryBlock) visitor(child);
  }
  if (s.catchBlock && Array.isArray(s.catchBlock)) {
    for (const child of s.catchBlock) visitor(child);
  }
  if (s.finallyBlock && Array.isArray(s.finallyBlock)) {
    for (const child of s.finallyBlock) visitor(child);
  }

  if (s.cases && Array.isArray(s.cases)) {
    for (const c of s.cases) {
      if (c.statements && Array.isArray(c.statements)) {
        for (const child of c.statements) visitor(child);
      }
    }
  }
}
