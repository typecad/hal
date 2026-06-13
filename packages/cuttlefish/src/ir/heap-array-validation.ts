// ---------------------------------------------------------------------------
// Heap Allocation Validator
//
// Validates that heap allocation via `new` is not used on architectures
// where it is unsafe. The platform strategy determines which architectures
// lack safe heap support (e.g. AVR with 2 KB SRAM, no heap manager).
//
// Arrays and class instances that are managed by the TypeCAD framework
// (StaticArray, peripheral objects created by board-init, compile-time-only
// strategy instances) are intentionally excluded from this check.
// ---------------------------------------------------------------------------

import type { Diagnostic } from '../types';
import type { BoardConstants } from './board-resolver';
import type { StatementIR, VariableDeclarationIR } from '../api';
import type { PlatformStrategy } from '../api/shared';
import { walkNestedStatements, walkProgramIR } from './utils/walk-ir';

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
  strategy?: PlatformStrategy,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const arch = boardConstants?.get('architecture') as string | undefined;
  if (!arch || !strategy?.isHeapAllocationUnsafe?.(arch)) {
    return diagnostics;
  }

  const checkStatement = (stmt: StatementIR): void => {
    if (stmt.kind === 'var_decl') {
      const decl = stmt as VariableDeclarationIR;
      const init = decl.initializer;
      if (
        init &&
        init.kind === 'raw' &&
        typeof init.value === 'string' &&
        /^new\s+\w/.test(init.value)
      ) {
        const match = init.value.match(/^new\s+(\w+)/);
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
          line: stmt.sourceSpan?.startLine,
          column: stmt.sourceSpan?.startColumn,
          source: 'heap-array-validation',
        });
      }
    }

    walkNestedStatements(stmt, checkStatement);
  };

  for (const stmt of program.topLevelStatements) checkStatement(stmt);
  for (const fn of program.functions) {
    for (const stmt of fn.statements) checkStatement(stmt);
  }
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      for (const stmt of method.statements) checkStatement(stmt);
    }
    if (cls.constructor) {
      for (const stmt of cls.constructor.statements) checkStatement(stmt);
    }
  }

  return diagnostics;
}
