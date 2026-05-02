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

import type { ProgramIR, StatementIR, ExpressionIR, VariableDeclarationIR, FunctionIR, ParameterIR } from './model';
import type { Diagnostic, SourceSpan } from '../types';

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
      const v = stmt as VariableDeclarationIR;
      if (v.ownershipKind) {
        usesOwnershipTypes = true;
      }
      if (checkTypeForOwnership(v.cppType)) {
        usesOwnershipTypes = true;
      }
    }
  }

  // Check function parameters and bodies
  for (const fn of program.functions) {
    for (const param of fn.parameters) {
      if ((param as any).ownershipKind) {
        usesOwnershipTypes = true;
      }
    }
    for (const stmt of fn.statements) {
      if (stmt.kind === 'var_decl') {
        const v = stmt as VariableDeclarationIR;
        if (v.ownershipKind) {
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
      const kind = (param as any).ownershipKind as OwnershipKind | undefined;
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
      const v = stmt as VariableDeclarationIR;
      // Only variables explicitly annotated with Owned<T>, Shared<T>, or Mutable<T>
      // get an ownershipKind. Unannotated variables get undefined (no tracking).
      const ownershipKind = (v as any).ownershipKind as OwnershipKind | undefined;

      // Detect borrow source from initializer
      let borrowSource: string | undefined;
      if (v.initializer && ownershipKind && ownershipKind !== 'owned') {
        borrowSource = extractBorrowSource(v.initializer);
      }

      // Check initializer for use-after-move and detect moves from Owned variables.
      // Order matters: analyzeExpression runs FIRST to detect pre-existing moves,
      // then we register the new move. This avoids a false positive where we move
      // the variable and then immediately check it again in analyzeExpression.
      if (v.initializer) {
        analyzeExpression(v.initializer, scope, diagnostics, span);

        // If the initializer is a plain identifier referencing an explicitly Owned variable
        // that hasn't already been moved, check whether this is a move or a borrow.
        // Shared<T> and Mutable<T> destinations are borrows — the source stays alive.
        // Only untyped or Owned<T> destinations trigger a move (ownership transfer).
        const initName = extractIdentifier(v.initializer);
        if (initName) {
          const sourceVar = scope.resolve(initName);
          if (sourceVar && sourceVar.ownershipKind === 'owned' && !scope.isMoved(initName)) {
            const isBorrow = ownershipKind === 'shared' || ownershipKind === 'mutable';
            if (!isBorrow) {
              // Move ownership from source to this new variable
              scope.move(initName);
              // ownership-owned-copy: moving a non-primitive is a C++ copy, not a true move
              if (!isPrimitiveCppType(v.cppType)) {
                diagnostics.push({
                  severity: 'info',
                  message: `Moving '${initName}' into '${v.name}' creates a C++ copy — ownership types do not emit std::move().`,
                  hint: `const ${v.name}: Shared = ${initName};  // borrow by reference instead of copying`,
                  line: span.startLine,
                  column: span.startColumn,
                  code: 'ownership-owned-copy',
                  source: 'ownership-analysis',
                });
              }
            }
          }
          // ownership-implicit-copy: unannotated non-primitive copied from a non-Owned variable
          else if (!ownershipKind && !isPrimitiveCppType(v.cppType)) {
            const srcVar = scope.resolve(initName);
            if (srcVar && srcVar.ownershipKind !== 'owned') {
              diagnostics.push({
                severity: 'info',
                message: `'${v.name}' silently copies '${initName}' — no borrow annotation.`,
                hint: `const ${v.name}: Shared = ${initName};  // borrow by const reference, zero copy`,
                line: span.startLine,
                column: span.startColumn,
                code: 'ownership-implicit-copy',
                source: 'ownership-analysis',
              });
            }
          }
        }

        // ownership-temp-ref-warn: Shared/Mutable assigned from a non-identifier non-primitive
        if (ownershipKind && ownershipKind !== 'owned' && !isPrimitiveCppType(v.cppType)) {
          if (v.initializer.kind !== 'identifier') {
            const annotLabel = ownershipKind === 'shared' ? 'Shared' : 'Mutable';
            const storageKw = ownershipKind === 'shared' ? 'const' : 'let';
            diagnostics.push({
              severity: 'warning',
              message: `'${v.name}: ${annotLabel}' borrows a temporary — C++ cannot bind a reference to an rvalue. The emitter will fall back to a copy.`,
              hint: `${storageKw} _tmp: Owned = ...;\nconst ${v.name}: ${annotLabel} = _tmp;`,
              line: span.startLine,
              column: span.startColumn,
              code: 'ownership-temp-ref-warn',
              source: 'ownership-analysis',
            });
          }
        }
      }

      if (ownershipKind) {
        scope.declare(v.name, ownershipKind, v.storage === 'let', borrowSource, v.cppType);
      }
      break;
    }

    case 'assign': {
      const a = stmt as any;

      // Check: assignment to Shared variable
      const targetKind = scope.getOwnershipKind(a.target);
      if (targetKind === 'shared') {
        const targetVar = scope.resolve(a.target);
        const typeAnnotation = (targetVar?.cppType && targetVar.cppType !== 'auto') ? `: Shared<${targetVar.cppType}>` : ': Shared';
        diagnostics.push({
          severity: 'error',
          message: `Cannot assign to '${a.target}' — it is an immutable borrow.`,
          hint: `change '${a.target}${typeAnnotation}' → '${a.target}: Mutable'  // Mutable allows mutation`,
          line: span.startLine,
          column: span.startColumn,
          code: 'ownership-assign-to-ref',
          source: 'ownership-analysis',
        });
      }

      // Check: assignment from Owned variable (move).
      // Order matters: analyzeExpression runs FIRST to detect pre-existing moves,
      // then we register the new move. This avoids a false positive.
      if (a.value && a.operator === '=') {
        analyzeExpression(a.value, scope, diagnostics, span);

        // If the value is a plain identifier referencing an Owned variable that
        // hasn't already been moved, register the move — but only if the target
        // is not a borrow (Shared/Mutable). Borrows don't transfer ownership.
        const sourceName = extractIdentifier(a.value);
        if (sourceName) {
          const sourceVar = scope.resolve(sourceName);
          const targetOwnership = scope.getOwnershipKind(a.target);
          const isTargetBorrow = targetOwnership === 'shared' || targetOwnership === 'mutable';
          if (sourceVar && sourceVar.ownershipKind === 'owned' && !scope.isMoved(sourceName) && sourceVar.isLet && !isTargetBorrow) {
            // Moving from a let Owned variable
            scope.move(sourceName);
          }
          // If target is a borrow variable, update its borrowSource so lifetime
          // tracking can detect dangling references when the source goes out of scope.
          if (isTargetBorrow && sourceVar && sourceVar.ownershipKind === 'owned') {
            const targetVar = scope.resolve(a.target);
            if (targetVar) {
              targetVar.borrowSource = sourceName;
            }
          }
        }
      } else if (a.value) {
        analyzeExpression(a.value, scope, diagnostics, span);
      }

      // Mark target as assigned
      scope.markAssigned(a.target);
      break;
    }

    case 'update': {
      const u = stmt as any;

      // Check: update to Shared variable
      const updateTargetKind = scope.getOwnershipKind(u.target);
      if (updateTargetKind === 'shared') {
        const updateTargetVar = scope.resolve(u.target);
        const typeAnnotation = (updateTargetVar?.cppType && updateTargetVar.cppType !== 'auto') ? `: Shared<${updateTargetVar.cppType}>` : ': Shared';
        diagnostics.push({
          severity: 'error',
          message: `Cannot update '${u.target}' — it is an immutable borrow.`,
          hint: `change '${u.target}${typeAnnotation}' → '${u.target}: Mutable'  // Mutable allows mutation`,
          line: span.startLine,
          column: span.startColumn,
          code: 'ownership-assign-to-ref',
          source: 'ownership-analysis',
        });
      }

      // Check: update to moved variable
      if (scope.isMoved(u.target)) {
        const movedVar = scope.resolve(u.target);
        diagnostics.push({
          severity: 'error',
          message: `'${u.target}' was moved and cannot be used again.`,
          hint: `const ${u.target}_ref: Shared = ${u.target};  // add this before the move`,
          line: span.startLine,
          column: span.startColumn,
          code: 'ownership-use-after-move',
          source: 'ownership-analysis',
        });
      }

      scope.markAssigned(u.target);
      break;
    }

    case 'call': {
      const c = stmt as any;
      // Check arguments for use-after-move
      for (const arg of (c.args ?? [])) {
        analyzeExpression(arg, scope, diagnostics, span);
      }
      break;
    }

    case 'typehal-call': {
      const tc = stmt as any;
      // Check arguments for use-after-move
      for (const arg of (tc.args ?? [])) {
        analyzeExpression(arg, scope, diagnostics, span);
      }
      break;
    }

    case 'return': {
      const r = stmt as any;
      if (r.value) {
        analyzeExpression(r.value, scope, diagnostics, span);
        // Check: returning a borrow whose source is an Owned variable — dangling reference
        const retName = extractIdentifier(r.value);
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
      const ifStmt = stmt as any;
      if (ifStmt.condition) analyzeExpression(ifStmt.condition, scope, diagnostics, span);
      const thenScope = new OwnershipScope(scope);
      analyzeStatements(ifStmt.thenBranch ?? [], thenScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(thenScope, diagnostics, span);
      if (ifStmt.elseBranch) {
        const elseScope = new OwnershipScope(scope);
        analyzeStatements(ifStmt.elseBranch, elseScope, diagnostics);
        checkDanglingBorrowsOnScopeExit(elseScope, diagnostics, span);
      }
      break;
    }

    case 'while':
    case 'do_while': {
      const w = stmt as any;
      if (w.condition) analyzeExpression(w.condition, scope, diagnostics, span);
      const loopScope = new OwnershipScope(scope);
      analyzeStatements(w.body ?? [], loopScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(loopScope, diagnostics, span);
      break;
    }

    case 'for': {
      const f = stmt as any;
      const forScope = new OwnershipScope(scope);
      if (f.initializer) analyzeStatement(f.initializer, forScope, diagnostics);
      if (f.condition) analyzeExpression(f.condition, forScope, diagnostics, span);
      if (f.increment) analyzeStatement(f.increment, forScope, diagnostics);
      analyzeStatements(f.body ?? [], forScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(forScope, diagnostics, span);
      break;
    }

    case 'for_of':
    case 'for_in': {
      const f = stmt as any;
      const forScope = new OwnershipScope(scope);
      if (f.variable) analyzeStatement(f.variable, forScope, diagnostics);
      if (f.iterable) analyzeExpression(f.iterable, forScope, diagnostics, span);
      if (f.object) analyzeExpression(f.object, forScope, diagnostics, span);
      analyzeStatements(f.body ?? [], forScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(forScope, diagnostics, span);
      break;
    }

    case 'switch': {
      const s = stmt as any;
      if (s.expression) analyzeExpression(s.expression, scope, diagnostics, span);
      for (const c of (s.cases ?? [])) {
        const caseScope = new OwnershipScope(scope);
        if (c.value) analyzeExpression(c.value, caseScope, diagnostics, span);
        analyzeStatements(c.body ?? [], caseScope, diagnostics);
        checkDanglingBorrowsOnScopeExit(caseScope, diagnostics, span);
      }
      break;
    }

    case 'block': {
      const b = stmt as any;
      const blockScope = new OwnershipScope(scope);
      analyzeStatements(b.body ?? [], blockScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(blockScope, diagnostics, span);
      break;
    }

    case 'labeled': {
      const l = stmt as any;
      const labelScope = new OwnershipScope(scope);
      analyzeStatements(l.body ?? [], labelScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(labelScope, diagnostics, span);
      break;
    }

    case 'try': {
      const t = stmt as any;
      const tryScope = new OwnershipScope(scope);
      analyzeStatements(t.tryBlock ?? [], tryScope, diagnostics);
      checkDanglingBorrowsOnScopeExit(tryScope, diagnostics, span);
      if (t.catchBlock) {
        const catchScope = new OwnershipScope(scope);
        analyzeStatements(t.catchBlock, catchScope, diagnostics);
        checkDanglingBorrowsOnScopeExit(catchScope, diagnostics, span);
      }
      if (t.finallyBlock) {
        const finallyScope = new OwnershipScope(scope);
        analyzeStatements(t.finallyBlock, finallyScope, diagnostics);
        checkDanglingBorrowsOnScopeExit(finallyScope, diagnostics, span);
      }
      break;
    }

    case 'throw': {
      const t = stmt as any;
      if (t.value) analyzeExpression(t.value, scope, diagnostics, span);
      break;
    }

    default:
      // Unknown statement kind — skip
      break;
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

  // Use the expression's own sourceSpan if available (e.g. callback), else fallback
  const span = (expr as any).sourceSpan ?? fallbackSpan;

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

    case 'typehal-call': {
      for (const arg of expr.args) {
        analyzeExpression(arg, scope, diagnostics, span);
      }
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
      // Extract identifiers from raw expressions and check for moves
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

    // number, string, boolean — no identifiers to check
    default:
      break;
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
        const v = stmt as VariableDeclarationIR;
        if (v.storage === 'let') {
          letVars.set(v.name, { name: v.name, everAssigned: false, span: stmt.sourceSpan });
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
        const a = stmt as any;
        const entry = letVars.get(a.target);
        if (entry) entry.everAssigned = true;
      }
      if (stmt.kind === 'update') {
        const u = stmt as any;
        const entry = letVars.get(u.target);
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
    fnParamKinds.set(fn.originalName, fn.parameters.map(p => (p as any).ownershipKind as OwnershipKind | undefined));
  }

  // Build a flat varName → ownershipKind map from a list of statements (shallow, no nested)
  const buildVarKinds = (stmts: StatementIR[], seed?: Map<string, OwnershipKind>): Map<string, OwnershipKind> => {
    const map = seed ?? new Map<string, OwnershipKind>();
    for (const stmt of stmts) {
      if (stmt.kind === 'var_decl') {
        const v = stmt as any;
        if (v.ownershipKind) map.set(v.name, v.ownershipKind as OwnershipKind);
      }
    }
    return map;
  };

  // Scan statements for call sites and check ownership mismatch on arguments
  const scanCalls = (stmts: StatementIR[], varKinds: Map<string, OwnershipKind>): void => {
    for (const stmt of stmts) {
      if (stmt.kind === 'call') {
        const c = stmt as any;
        const paramKinds = fnParamKinds.get(c.callee);
        if (paramKinds) {
          const args: any[] = c.args ?? [];
          for (let i = 0; i < args.length; i++) {
            const paramKind = paramKinds[i];
            if (paramKind === 'mutable' && args[i]?.kind === 'identifier') {
              const argKind = varKinds.get(args[i].value);
              if (argKind === 'shared') {
                diagnostics.push({
                  severity: 'error',
                  message: `Cannot pass '${args[i].value}' (immutable Shared) to '${c.callee}' which expects a mutable borrow.`,
                  hint: `change '${args[i].value}: Shared = ...' → '${args[i].value}: Mutable = ...'`,
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
      const kind = (param as any).ownershipKind as OwnershipKind | undefined;
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
      const s = stmt as any;
      return [...(s.thenBranch ?? []), ...(s.elseBranch ?? [])];
    }
    case 'while':
    case 'do_while': {
      const s = stmt as any;
      return s.body;
    }
    case 'for': {
      const s = stmt as any;
      const result: StatementIR[] = [];
      if (s.initializer) result.push(s.initializer);
      if (s.increment) result.push(s.increment);
      result.push(...(s.body ?? []));
      return result;
    }
    case 'for_of':
    case 'for_in': {
      const s = stmt as any;
      const result: StatementIR[] = [];
      if (s.variable) result.push(s.variable);
      result.push(...(s.body ?? []));
      return result;
    }
    case 'switch': {
      const s = stmt as any;
      const result: StatementIR[] = [];
      for (const c of (s.cases ?? [])) {
        result.push(...(c.body ?? []));
      }
      return result;
    }
    case 'block':
    case 'labeled': {
      const s = stmt as any;
      return s.body;
    }
    case 'try': {
      const s = stmt as any;
      return [
        ...(s.tryBlock ?? []),
        ...(s.catchBlock ?? []),
        ...(s.finallyBlock ?? []),
      ];
    }
    case 'typehal-call':
    case 'call': {
      const s = stmt as any;
      const result: StatementIR[] = [];
      for (const arg of (s.args ?? [])) {
        if (arg.kind === 'callback' && arg.statements) {
          result.push(...arg.statements);
        }
      }
      return result.length > 0 ? result : undefined;
    }
    default:
      return undefined;
  }
}
