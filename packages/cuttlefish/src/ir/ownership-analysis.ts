// ---------------------------------------------------------------------------
// Ownership & Borrowing Safety Analysis
//
// Validates Rust-inspired ownership rules at transpile time:
//   1. Use-after-move: error when reading a moved Owned variable
//   2. Assign-to-shared: error when assigning to a Shared (immutable borrow)
//   3. Mutable exclusivity: warning when multiple Mutable borrows exist
//   4. Borrow mismatch: error passing Shared where Mutable is expected
//   5. Const suggestion: warning for let variables never reassigned
//
// Opt-in: if no ownership types (Shared, Mutable, Owned) are used anywhere
// in the program, no diagnostics are generated.
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR } from '../api';
import type { Diagnostic, SourceSpan } from '../types';

/** Compile-time exhaustiveness check for switch statements on IR kinds. */
function assertNever(x: never): never {
  throw new Error(`Unhandled IR kind: ${JSON.stringify(x)}`);
}

/**
 * Returns true for C++ scalar/primitive types passed cheaply by value.
 * Non-primitives (std::vector, String, structs) should be passed by C++ reference
 * when borrowed via Shared<T> or Mutable<T>.
 */
function isPrimitiveCppType(cppType: string): boolean {
  const t = cppType.trim();
  const primitives = new Set([
    'int', 'float', 'double', 'bool', 'char', 'long', 'void',
    'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'size_t', 'byte', 'word',
    'unsigned int', 'unsigned long', 'unsigned char',
    'signed int', 'signed long', 'signed char',
  ]);
  return primitives.has(t);
}

/** Ownership kind for a variable or parameter. */
type OwnershipKind = 'owned' | 'shared' | 'mutable';

/** Tracked state for a variable in a scope. */
interface VariableState {
  name: string;
  ownershipKind: OwnershipKind;
  /** True after the variable has been moved (ownership transferred). */
  moved: boolean;
  /** True if this is a `let` variable (for const-suggestion check). */
  isLet: boolean;
  /** True if this variable has been the target of an assignment or update. */
  everAssigned: boolean;
  /** Source variable name for borrow tracking (e.g., the original array). */
  borrowSource?: string;
  /** C++ type string for constructing concrete hint messages. */
  cppType?: string;
}

/** Scope tracker for ownership analysis. */
class OwnershipScope {
  /** Variables declared in this scope, keyed by name. */
  vars = new Map<string, VariableState>();

  /** Set of variable names that have been moved. */
  movedVars = new Set<string>();

  /** Track Mutable variables and their sources for exclusivity checking. */
  mutRefSources = new Map<string, string[]>();  // source -> [mutRefVarName, ...]

  /** Track parameter ownership kinds for the current function. */
  paramKinds = new Map<string, OwnershipKind>();

  /** Whether any ownership type is used in this scope. */
  usesOwnershipTypes = false;

  constructor(public parent?: OwnershipScope) {}

  /** Declare a variable in this scope. */
  declare(name: string, ownershipKind: OwnershipKind, isLet: boolean, borrowSource?: string, cppType?: string): void {
    if (ownershipKind !== 'owned' || borrowSource) {
      this.usesOwnershipTypes = true;
    }
    this.vars.set(name, {
      name,
      ownershipKind,
      moved: false,
      isLet,
      everAssigned: false,
      borrowSource,
      cppType,
    });

    // Track Mutable sources for exclusivity checking
    if (ownershipKind === 'mutable' && borrowSource) {
      const existing = this.mutRefSources.get(borrowSource) ?? [];
      existing.push(name);
      this.mutRefSources.set(borrowSource, existing);
    }
  }

  /** Mark a variable as moved. */
  move(name: string): void {
    this.movedVars.add(name);
    const v = this.resolve(name);
    if (v) {
      v.moved = true;
    }
  }

  /** Mark a variable as having been assigned to. */
  markAssigned(name: string): void {
    const v = this.resolve(name);
    if (v) {
      v.everAssigned = true;
    }
  }

  /** Resolve a variable in this scope or parent scopes. */
  resolve(name: string): VariableState | undefined {
    const v = this.vars.get(name);
    if (v) return v;
    if (this.parent) return this.parent.resolve(name);
    return undefined;
  }

  /** Check if a variable has been moved. */
  isMoved(name: string): boolean {
    if (this.movedVars.has(name)) return true;
    if (this.parent) return this.parent.isMoved(name);
    return false;
  }

  /** Get the ownership kind for a variable. */
  getOwnershipKind(name: string): OwnershipKind | undefined {
    const v = this.resolve(name);
    return v?.ownershipKind;
  }

  /** Collect all let variables in this scope (for const suggestion). */
  collectLetVariables(): VariableState[] {
    const result: VariableState[] = [];
    for (const v of this.vars.values()) {
      if (v.isLet && v.ownershipKind === 'owned') {
        result.push(v);
      }
    }
    return result;
  }
}

/**
 * Validate ownership and borrowing rules for the entire program.
 *
 * @param program - The program IR to analyze
 * @returns Array of diagnostics for ownership violations
 */
export function validateOwnership(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // First pass: check if any ownership types are used anywhere
  let usesOwnershipTypes = false;

  const checkTypeForOwnership = (cppType: string): boolean => {
    return /\b(Shared|Mutable|Owned)</.test(cppType);
  };

  // Check top-level variable declarations
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === 'var_decl') {
      if (stmt.ownershipKind) {
        usesOwnershipTypes = true;
      }
      if (checkTypeForOwnership(stmt.cppType)) {
        usesOwnershipTypes = true;
      }
    }
  }

  // Check function parameters and bodies
  for (const fn of program.functions) {
    for (const param of fn.parameters) {
      if (param.ownershipKind) {
        usesOwnershipTypes = true;
      }
    }
    for (const stmt of fn.statements) {
      if (stmt.kind === 'var_decl') {
        if (stmt.ownershipKind) {
          usesOwnershipTypes = true;
        }
      }
    }
  }

  // If no ownership types are used, skip all validation (opt-in)
  if (!usesOwnershipTypes) {
    // Still do const suggestion for all let variables
    validateConstSuggestions(program, diagnostics);
    return diagnostics;
  }

  // Second pass: full ownership validation

  // Validate top-level statements
  const globalScope = new OwnershipScope();
  analyzeStatements(program.topLevelStatements, globalScope, diagnostics);

  // Validate each function
  for (const fn of program.functions) {
    const fnScope = new OwnershipScope(globalScope);
    // Register parameters — only track those with explicit ownership annotations
    for (const param of fn.parameters) {
      const kind = param.ownershipKind;
      if (kind) {
        fnScope.declare(param.name, kind, false, undefined, param.cppType);
        fnScope.usesOwnershipTypes = true;
      }
    }
    analyzeStatements(fn.statements, fnScope, diagnostics);
  }

  // Const suggestions for ownership-aware code
  validateConstSuggestions(program, diagnostics);

  // Borrow mismatch: Shared<T> arg passed to Mutable<T> param
  checkBorrowMismatch(program, diagnostics);

  return diagnostics;
}

/**
 * Analyze a list of statements for ownership violations.
 */
function analyzeStatements(
  stmts: StatementIR[],
  scope: OwnershipScope,
  diagnostics: Diagnostic[],
): void {
  for (const stmt of stmts) {
    analyzeStatement(stmt, scope, diagnostics);
  }
}

/**
 * Analyze a single statement for ownership violations.
 */
function analyzeStatement(
  stmt: StatementIR,
  scope: OwnershipScope,
  diagnostics: Diagnostic[],
): void {
  const span = stmt.sourceSpan;

  switch (stmt.kind) {
    case 'var_decl': {
      const ownershipKind = stmt.ownershipKind;

      // Detect borrow source from initializer
      let borrowSource: string | undefined;
      if (stmt.initializer && ownershipKind && ownershipKind !== 'owned') {
        borrowSource = extractBorrowSource(stmt.initializer);
      }

      // Check initializer for use-after-move and detect moves from Owned variables.
      // Order matters: analyzeExpression runs FIRST to detect pre-existing moves,
      // then we register the new move. This avoids a false positive where we move
      // the variable and then immediately check it again in analyzeExpression.
      if (stmt.initializer) {
        analyzeExpression(stmt.initializer, scope, diagnostics, span);

        // If the initializer is a plain identifier referencing an explicitly Owned variable
        // that hasn't already been moved, check whether this is a move or a borrow.
        // Shared<T> and Mutable<T> destinations are borrows — the source stays alive.
        // Only untyped or Owned<T> destinations trigger a move (ownership transfer).
        const initName = extractIdentifier(stmt.initializer);
        if (initName) {
          const sourceVar = scope.resolve(initName);
          if (sourceVar && sourceVar.ownershipKind === 'owned' && !scope.isMoved(initName)) {
            const isBorrow = ownershipKind === 'shared' || ownershipKind === 'mutable';
            if (!isBorrow) {
              // Move ownership from source to this new variable
              scope.move(initName);
              // ownership-owned-copy: moving a non-primitive is a C++ copy, not a true move
              if (!isPrimitiveCppType(stmt.cppType)) {
                diagnostics.push({
                  severity: 'info',
                  message: `Moving '${initName}' into '${stmt.name}' creates a C++ copy — ownership types do not emit std::move().`,
                  hint: `const ${stmt.name}: Shared = ${initName};  // borrow by reference instead of copying`,
                  line: span.startLine,
                  column: span.startColumn,
                  code: 'ownership-owned-copy',
                  source: 'ownership-analysis',
                });
              }
            }
          }
          // ownership-implicit-copy: unannotated non-primitive copied from a non-Owned variable
          else if (!ownershipKind && !isPrimitiveCppType(stmt.cppType)) {
            const srcVar = scope.resolve(initName);
            if (srcVar && srcVar.ownershipKind !== 'owned') {
              diagnostics.push({
                severity: 'info',
                message: `'${stmt.name}' silently copies '${initName}' — no borrow annotation.`,
                hint: `const ${stmt.name}: Shared = ${initName};  // borrow by const reference, zero copy`,
                line: span.startLine,
                column: span.startColumn,
                code: 'ownership-implicit-copy',
                source: 'ownership-analysis',
              });
            }
          }
        }

        // ownership-temp-ref-warn: Shared/Mutable assigned from a non-identifier non-primitive
        if (ownershipKind && ownershipKind !== 'owned' && !isPrimitiveCppType(stmt.cppType)) {
          if (stmt.initializer.kind !== 'identifier') {
            const annotLabel = ownershipKind === 'shared' ? 'Shared' : 'Mutable';
            const storageKw = ownershipKind === 'shared' ? 'const' : 'let';
            diagnostics.push({
              severity: 'warning',
              message: `'${stmt.name}: ${annotLabel}' borrows a temporary — C++ cannot bind a reference to an rvalue. The emitter will fall back to a copy.`,
              hint: `${storageKw} _tmp: Owned = ...;\nconst ${stmt.name}: ${annotLabel} = _tmp;`,
              line: span.startLine,
              column: span.startColumn,
              code: 'ownership-temp-ref-warn',
              source: 'ownership-analysis',
            });
          }
        }
      }

      if (ownershipKind) {
        scope.declare(stmt.name, ownershipKind, stmt.storage === 'let', borrowSource, stmt.cppType);
      }
      break;
    }

    case 'assign': {
      // Check: assignment to Shared variable
      const targetKind = scope.getOwnershipKind(stmt.target);
      if (targetKind === 'shared') {
        const targetVar = scope.resolve(stmt.target);
        const typeAnnotation = (targetVar?.cppType && targetVar.cppType !== 'auto') ? `: Shared<${targetVar.cppType}>` : ': Shared';
        diagnostics.push({
          severity: 'error',
          message: `Cannot assign to '${stmt.target}' — it is an immutable borrow.`,
          hint: `change '${stmt.target}${typeAnnotation}' → '${stmt.target}: Mutable'  // Mutable allows mutation`,
          line: span.startLine,
          column: span.startColumn,
          code: 'ownership-assign-to-ref',
          source: 'ownership-analysis',
        });
      }

      // Check: assignment from Owned variable (move).
      // Order matters: analyzeExpression runs FIRST to detect pre-existing moves,
      // then we register the new move. This avoids a false positive.
      if (stmt.value && stmt.operator === '=') {
        analyzeExpression(stmt.value, scope, diagnostics, span);

        // If the value is a plain identifier referencing an Owned variable that
        // hasn't already been moved, register the move — but only if the target
        // is not a borrow (Shared/Mutable). Borrows don't transfer ownership.
        const sourceName = extractIdentifier(stmt.value);
        if (sourceName) {
          const sourceVar = scope.resolve(sourceName);
          const targetOwnership = scope.getOwnershipKind(stmt.target);
          const isTargetBorrow = targetOwnership === 'shared' || targetOwnership === 'mutable';
          if (sourceVar && sourceVar.ownershipKind === 'owned' && !scope.isMoved(sourceName) && sourceVar.isLet && !isTargetBorrow) {
            scope.move(sourceName);
          }
          if (isTargetBorrow && sourceVar && sourceVar.ownershipKind === 'owned') {
            const targetVar = scope.resolve(stmt.target);
            if (targetVar) {
              targetVar.borrowSource = sourceName;
            }
          }
        }
      } else if (stmt.value) {
        analyzeExpression(stmt.value, scope, diagnostics, span);
      }

      scope.markAssigned(stmt.target);
      break;
    }

    case 'update': {
      // Check: update to Shared variable
      const updateTargetKind = scope.getOwnershipKind(stmt.target);
      if (updateTargetKind === 'shared') {
        const updateTargetVar = scope.resolve(stmt.target);
        const typeAnnotation = (updateTargetVar?.cppType && updateTargetVar.cppType !== 'auto') ? `: Shared<${updateTargetVar.cppType}>` : ': Shared';
        diagnostics.push({
          severity: 'error',
          message: `Cannot update '${stmt.target}' — it is an immutable borrow.`,
          hint: `change '${stmt.target}${typeAnnotation}' → '${stmt.target}: Mutable'  // Mutable allows mutation`,
          line: span.startLine,
          column: span.startColumn,
          code: 'ownership-assign-to-ref',
          source: 'ownership-analysis',
        });
      }

      // Check: update to moved variable
      if (scope.isMoved(stmt.target)) {
        diagnostics.push({
          severity: 'error',
          message: `'${stmt.target}' was moved and cannot be used again.`,
          hint: `const ${stmt.target}_ref: Shared = ${stmt.target};  // add this before the move`,
          line: span.startLine,
          column: span.startColumn,
          code: 'ownership-use-after-move',
          source: 'ownership-analysis',
        });
      }

      scope.markAssigned(stmt.target);
      break;
    }

    case 'call': {
      // Check arguments for use-after-move
      for (const arg of stmt.args) {
        analyzeExpression(arg, scope, diagnostics, span);
      }
      break;
    }

    case 'return': {
      if (stmt.value) {
        analyzeExpression(stmt.value, scope, diagnostics, span);
        // Check: returning a borrow whose source is an Owned variable — dangling reference
        const retName = extractIdentifier(stmt.value);
        if (retName) {
          const retVar = scope.resolve(retName);
          if (retVar && (retVar.ownershipKind === 'shared' || retVar.ownershipKind === 'mutable') && retVar.borrowSource) {
            const source = scope.resolve(retVar.borrowSource);
            if (source && source.ownershipKind === 'owned') {
              diagnostics.push({
                severity: 'error',
                message: `Returning '${retName}' borrows '${retVar.borrowSource}' which will be destroyed when this function returns — dangling reference.`,
                hint: `return ${retVar.borrowSource} directly as Owned, or change the function to accept '${retVar.borrowSource}: Shared' as a parameter`,
                line: span.startLine,
                column: span.startColumn,
                code: 'ownership-return-local-ref',
                source: 'ownership-analysis',
              });
            }
          }
        }
      }
      break;
    }

    case 'if': {
      if (stmt.condition) analyzeExpression(stmt.condition, scope, diagnostics, span);
      const thenScope = new OwnershipScope(scope);
      analyzeStatements(stmt.thenBranch, thenScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(thenScope, diagnostics, span);
      if (stmt.elseBranch) {
        const elseScope = new OwnershipScope(scope);
        analyzeStatements(stmt.elseBranch, elseScope, diagnostics);
        checkDanglingBorrowsOnScopeExit(elseScope, diagnostics, span);
      }
      break;
    }

    case 'while':
    case 'do_while': {
      if (stmt.condition) analyzeExpression(stmt.condition, scope, diagnostics, span);
      const loopScope = new OwnershipScope(scope);
      analyzeStatements(stmt.body, loopScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(loopScope, diagnostics, span);
      break;
    }

    case 'for': {
      const forScope = new OwnershipScope(scope);
      if (stmt.initializer) analyzeStatement(stmt.initializer, forScope, diagnostics);
      if (stmt.condition) analyzeExpression(stmt.condition, forScope, diagnostics, span);
      if (stmt.increment) analyzeStatement(stmt.increment, forScope, diagnostics);
      analyzeStatements(stmt.body, forScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(forScope, diagnostics, span);
      break;
    }

    case 'for_of':
    case 'for_in': {
      const forScope = new OwnershipScope(scope);
      if (stmt.variable) analyzeStatement(stmt.variable, forScope, diagnostics);
      if ('iterable' in stmt && stmt.iterable) analyzeExpression(stmt.iterable, forScope, diagnostics, span);
      if ('object' in stmt && stmt.object) analyzeExpression(stmt.object, forScope, diagnostics, span);
      analyzeStatements(stmt.body, forScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(forScope, diagnostics, span);
      break;
    }

    case 'switch': {
      if (stmt.expression) analyzeExpression(stmt.expression, scope, diagnostics, span);
      for (const c of stmt.cases) {
        const caseScope = new OwnershipScope(scope);
        if (c.value) analyzeExpression(c.value, caseScope, diagnostics, span);
        analyzeStatements(c.body, caseScope, diagnostics);
        checkDanglingBorrowsOnScopeExit(caseScope, diagnostics, span);
      }
      break;
    }

    case 'block': {
      const blockScope = new OwnershipScope(scope);
      analyzeStatements(stmt.body, blockScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(blockScope, diagnostics, span);
      break;
    }

    case 'labeled': {
      const labelScope = new OwnershipScope(scope);
      analyzeStatements(stmt.body, labelScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(labelScope, diagnostics, span);
      break;
    }

    case 'try': {
      const tryScope = new OwnershipScope(scope);
      analyzeStatements(stmt.tryBlock, tryScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(tryScope, diagnostics, span);
      if (stmt.catchBlock) {
        const catchScope = new OwnershipScope(scope);
        analyzeStatements(stmt.catchBlock, catchScope, diagnostics);
        checkDanglingBorrowsOnScopeExit(catchScope, diagnostics, span);
      }
      if (stmt.finallyBlock) {
        const finallyScope = new OwnershipScope(scope);
        analyzeStatements(stmt.finallyBlock, finallyScope, diagnostics);
        checkDanglingBorrowsOnScopeExit(finallyScope, diagnostics, span);
      }
      break;
    }

    case 'throw': {
      if (stmt.value) analyzeExpression(stmt.value, scope, diagnostics, span);
      break;
    }

    case 'break':
    case 'continue':
    case 'hal-op':
    case 'yield':
      break;

    default:
      assertNever(stmt);
  }
}

/**
 * Analyze an expression for ownership violations (use-after-move).
 *
 * @param expr - The expression to analyze
 * @param scope - The current ownership scope
 * @param diagnostics - Accumulator for diagnostics
 * @param fallbackSpan - SourceSpan from the enclosing statement, used when
 *                       the expression itself doesn't carry location info
 */
function analyzeExpression(
  expr: ExpressionIR | null | undefined,
  scope: OwnershipScope,
  diagnostics: Diagnostic[],
  fallbackSpan: SourceSpan,
): void {
  if (!expr || typeof expr !== 'object' || !expr.kind) return;

  const span = expr.kind === 'callback' ? expr.sourceSpan : fallbackSpan;

  switch (expr.kind) {
    case 'identifier': {
      const name = expr.value;
      if (scope.isMoved(name)) {
        diagnostics.push({
          severity: 'error',
          message: `'${name}' was moved and cannot be used again.`,
          hint: `const ${name}_ref: Shared = ${name};  // add this before the move`,
          line: span.startLine,
          column: span.startColumn,
          code: 'ownership-use-after-move',
          source: 'ownership-analysis',
        });
      }
      break;
    }

    case 'binary': {
      analyzeExpression(expr.left, scope, diagnostics, span);
      analyzeExpression(expr.right, scope, diagnostics, span);
      break;
    }

    case 'unary': {
      analyzeExpression(expr.operand, scope, diagnostics, span);
      break;
    }

    case 'ternary': {
      analyzeExpression(expr.condition, scope, diagnostics, span);
      analyzeExpression(expr.whenTrue, scope, diagnostics, span);
      analyzeExpression(expr.whenFalse, scope, diagnostics, span);
      break;
    }

    case 'await': {
      analyzeExpression(expr.value, scope, diagnostics, span);
      break;
    }

    case 'array': {
      for (const el of expr.elements) {
        analyzeExpression(el, scope, diagnostics, span);
      }
      break;
    }

    case 'object': {
      for (const field of expr.fields) {
        analyzeExpression(field.value, scope, diagnostics, span);
      }
      break;
    }

    case 'string_concat': {
      for (const part of expr.parts) {
        analyzeExpression(part, scope, diagnostics, span);
      }
      break;
    }

    case 'template_string': {
      analyzeExpression(expr.expression, scope, diagnostics, span);
      break;
    }

    case 'property-access': {
      analyzeExpression(expr.object, scope, diagnostics, span);
      break;
    }

    case 'instanceof': {
      analyzeExpression(expr.object, scope, diagnostics, span);
      break;
    }

    case 'spread_array': {
      analyzeExpression(expr.spreadExpr, scope, diagnostics, span);
      for (const el of expr.additionalElements) {
        analyzeExpression(el, scope, diagnostics, span);
      }
      break;
    }

    case 'raw': {
      const matches = expr.value.match(/[A-Za-z_][A-Za-z0-9_]*/g);
      if (matches) {
        for (const match of matches) {
          if (scope.isMoved(match)) {
            diagnostics.push({
              severity: 'error',
              message: `'${match}' was moved and cannot be used again.`,
              hint: `const ${match}_ref: Shared = ${match};  // add this before the move`,
              line: span.startLine,
              column: span.startColumn,
              code: 'ownership-use-after-move',
              source: 'ownership-analysis',
            });
          }
        }
      }
      break;
    }

    case 'callback': {
      for (const s of expr.statements) {
        analyzeStatement(s, scope, diagnostics);
      }
      break;
    }

    case 'lambda': {
      for (const s of expr.body) {
        analyzeStatement(s, scope, diagnostics);
      }
      break;
    }

    case 'method-call': {
      for (const arg of expr.args) {
        analyzeExpression(arg, scope, diagnostics, span);
      }
      break;
    }

    case 'element-access': {
      analyzeExpression(expr.object, scope, diagnostics, span);
      analyzeExpression(expr.index, scope, diagnostics, span);
      break;
    }

    case 'paren': {
      analyzeExpression(expr.inner, scope, diagnostics, span);
      break;
    }

    case 'number':
    case 'string':
    case 'boolean':
    case 'hal-expr':
      break;

    default:
      assertNever(expr);
  }
}

/**
 * Extract the identifier name from a simple expression.
 * Returns undefined for complex expressions.
 */
function extractIdentifier(expr: ExpressionIR): string | undefined {
  if (expr.kind === 'identifier') return expr.value;
  return undefined;
}

/**
 * Extract the borrow source from an initializer expression.
 * For `let ref: Shared<T> = source`, returns "source".
 */
function extractBorrowSource(expr: ExpressionIR): string | undefined {
  return extractIdentifier(expr);
}

/**
 * Validate const suggestions: warn about `let` variables that are never reassigned.
 * This runs regardless of whether ownership types are used.
 */
function validateConstSuggestions(program: ProgramIR, diagnostics: Diagnostic[]): void {
  // Collect all let variable declarations and track assignments
  const letVars = new Map<string, { name: string; everAssigned: boolean; span: SourceSpan }>();

  const scanStmtsForLetDecls = (stmts: StatementIR[]): void => {
    for (const stmt of stmts) {
      if (stmt.kind === 'var_decl') {
        if (stmt.storage === 'let') {
          letVars.set(stmt.name, { name: stmt.name, everAssigned: false, span: stmt.sourceSpan });
        }
      }
      // Recurse into nested statements
      scanNestedForLetDecls(stmt);
    }
  };

  const scanNestedForLetDecls = (stmt: StatementIR): void => {
    const nested = getNestedStatements(stmt);
    if (nested) {
      scanStmtsForLetDecls(nested);
    }
  };

  // Scan for assignments to mark let vars as assigned
  const scanStmtsForAssignments = (stmts: StatementIR[]): void => {
    for (const stmt of stmts) {
      if (stmt.kind === 'assign') {
        const entry = letVars.get(stmt.target);
        if (entry) entry.everAssigned = true;
      }
      if (stmt.kind === 'update') {
        const entry = letVars.get(stmt.target);
        if (entry) entry.everAssigned = true;
      }
      // Recurse
      const nested = getNestedStatements(stmt);
      if (nested) {
        scanStmtsForAssignments(nested);
      }
    }
  };

  scanStmtsForLetDecls(program.topLevelStatements);
  for (const fn of program.functions) {
    scanStmtsForLetDecls(fn.statements);
  }

  scanStmtsForAssignments(program.topLevelStatements);
  for (const fn of program.functions) {
    scanStmtsForAssignments(fn.statements);
  }

  // Generate suggestions for let vars that were never assigned
  for (const entry of letVars.values()) {
    if (!entry.everAssigned) {
      diagnostics.push({
        severity: 'warning',
        message: `'${entry.name}' is never reassigned.`,
        hint: `const ${entry.name} = ...;  // or annotate with Shared to also enforce const T& at the C++ level`,
        line: entry.span.startLine,
        column: entry.span.startColumn,
        code: 'ownership-suggest-const',
        source: 'ownership-analysis',
      });
    }
  }
}

/**
 * Check for borrow mismatch: a Shared<T>-annotated variable passed as a Mutable<T> parameter.
 * Runs as a separate top-level pass so it doesn't need to thread state through the main
 * recursive analysis.
 */
function checkBorrowMismatch(program: ProgramIR, diagnostics: Diagnostic[]): void {
  // Build function parameter ownership map
  const fnParamKinds = new Map<string, Array<OwnershipKind | undefined>>();
  for (const fn of program.functions) {
    fnParamKinds.set(fn.originalName, fn.parameters.map(p => p.ownershipKind));
  }

  // Build a flat varName → ownershipKind map from a list of statements (shallow, no nested)
  const buildVarKinds = (stmts: StatementIR[], seed?: Map<string, OwnershipKind>): Map<string, OwnershipKind> => {
    const map = seed ?? new Map<string, OwnershipKind>();
    for (const stmt of stmts) {
      if (stmt.kind === 'var_decl') {
        if (stmt.ownershipKind) map.set(stmt.name, stmt.ownershipKind);
      }
    }
    return map;
  };

  // Scan statements for call sites and check ownership mismatch on arguments
  const scanCalls = (stmts: StatementIR[], varKinds: Map<string, OwnershipKind>): void => {
    for (const stmt of stmts) {
      if (stmt.kind === 'call') {
        const paramKinds = fnParamKinds.get(stmt.callee);
        if (paramKinds) {
          for (let i = 0; i < stmt.args.length; i++) {
            const paramKind = paramKinds[i];
            const arg = stmt.args[i];
            if (paramKind === 'mutable' && arg?.kind === 'identifier') {
              const argKind = varKinds.get(arg.value);
              if (argKind === 'shared') {
                diagnostics.push({
                  severity: 'error',
                  message: `Cannot pass '${arg.value}' (immutable Shared) to '${stmt.callee}' which expects a mutable borrow.`,
                  hint: `change '${arg.value}: Shared = ...' → '${arg.value}: Mutable = ...'`,
                  line: stmt.sourceSpan.startLine,
                  column: stmt.sourceSpan.startColumn,
                  code: 'ownership-borrow-mismatch',
                  source: 'ownership-analysis',
                });
              }
            }
          }
        }
      }
      // Recurse into nested blocks
      const nested = getNestedStatements(stmt);
      if (nested) scanCalls(nested, varKinds);
    }
  };

  // Check top-level statements
  scanCalls(program.topLevelStatements, buildVarKinds(program.topLevelStatements));

  // Check each function (include parameters in the varKinds map)
  for (const fn of program.functions) {
    const varKinds = buildVarKinds(fn.statements);
    for (const param of fn.parameters) {
      const kind = param.ownershipKind;
      if (kind) varKinds.set(param.name, kind);
    }
    scanCalls(fn.statements, varKinds);
  }
}

/**
 * After a child scope exits, check whether any variable in an ancestor scope borrows
 * an owned variable that was declared only in the exiting child scope.  Those borrows
 * are now dangling references in the generated C++.
 */
function checkDanglingBorrowsOnScopeExit(
  exitingScope: OwnershipScope,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): void {
  // Collect the names of owned variables that are being destroyed
  const exitingOwnedNames = new Set<string>();
  for (const v of exitingScope.vars.values()) {
    if (v.ownershipKind === 'owned') {
      exitingOwnedNames.add(v.name);
    }
  }
  if (exitingOwnedNames.size === 0) return;

  // Walk up ancestor scopes looking for borrows whose source is one of those variables
  let ancestor = exitingScope.parent;
  while (ancestor) {
    for (const v of ancestor.vars.values()) {
      if (
        (v.ownershipKind === 'shared' || v.ownershipKind === 'mutable') &&
        v.borrowSource &&
        exitingOwnedNames.has(v.borrowSource)
      ) {
        diagnostics.push({
          severity: 'error',
          message: `'${v.name}' borrows '${v.borrowSource}' which goes out of scope here — potential dangling reference.`,
          hint: `move '${v.borrowSource}' to the outer scope, or ensure '${v.name}' does not outlive it`,
          line: span.startLine,
          column: span.startColumn,
          code: 'ownership-dangling-borrow',
          source: 'ownership-analysis',
        });
      }
    }
    ancestor = ancestor.parent;
  }
}

/**
 * Get nested statements from a compound statement.
 */
function getNestedStatements(stmt: StatementIR): StatementIR[] | undefined {
  switch (stmt.kind) {
    case 'if': {
      return [...stmt.thenBranch, ...(stmt.elseBranch ?? [])];
    }
    case 'while':
    case 'do_while': {
      return stmt.body;
    }
    case 'for': {
      const result: StatementIR[] = [];
      if (stmt.initializer) result.push(stmt.initializer);
      if (stmt.increment) result.push(stmt.increment);
      result.push(...stmt.body);
      return result;
    }
    case 'for_of':
    case 'for_in': {
      const result: StatementIR[] = [];
      result.push(stmt.variable);
      result.push(...stmt.body);
      return result;
    }
    case 'switch': {
      const result: StatementIR[] = [];
      for (const c of stmt.cases) {
        result.push(...c.body);
      }
      return result;
    }
    case 'block':
    case 'labeled': {
      return stmt.body;
    }
    case 'try': {
      return [
        ...stmt.tryBlock,
        ...(stmt.catchBlock ?? []),
        ...(stmt.finallyBlock ?? []),
      ];
    }
    case 'call': {
      const result: StatementIR[] = [];
      for (const arg of stmt.args) {
        if (arg.kind === 'callback' && arg.statements) {
          result.push(...arg.statements);
        }
      }
      return result.length > 0 ? result : undefined;
    }
    case 'var_decl':
    case 'assign':
    case 'update':
    case 'return':
    case 'break':
    case 'continue':
    case 'throw':
    case 'hal-op':
    case 'yield':
      return undefined;
    default:
      assertNever(stmt);
  }
}
