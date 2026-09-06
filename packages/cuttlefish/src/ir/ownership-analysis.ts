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

import type { ProgramIR, StatementIR, ExpressionIR, VariableDeclarationIR } from '../api/index.js';
import type { Diagnostic, SourceSpan } from '../types.js';
import { parseCppType, parsedIsPointer } from '../api/shared/cpp-type-ir.js';

/** True for any `std::`-prefixed type (vector/map/set/tuple/variant/function/string).
 *  Replaces the historical `cppType.startsWith('std::')` check. */
function isStdContainerType(cppType: string): boolean {
  const ir = parseCppType(cppType);
  switch (ir.kind) {
    case "vector": case "map": case "set":
    case "tuple": case "variant": case "function":
    case "string": case "smartPointer":
      return true;
    default:
      return false;
  }
}

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

  /** By-value struct parameters — mutations on their fields are invisible to callers. */
  byValueStructParams = new Set<string>();

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
 * Checks for mutations on by-value struct parameters (no Mutable<T> annotation).
 * Emits ownership-mutate-copy warning — changes are local copies invisible to callers.
 */
function checkByValueParamMutations(program: ProgramIR, diagnostics: Diagnostic[]): void {
  for (const fn of program.functions) {
    const byValueParams = new Set<string>();
    for (const param of fn.parameters) {
      if (
        !param.ownershipKind &&
        param.cppType &&
        !isPrimitiveCppType(param.cppType) &&
        !parsedIsPointer(param.cppType) &&
        !isStdContainerType(param.cppType)
      ) {
        byValueParams.add(param.name);
      }
    }
    if (byValueParams.size === 0) continue;
    scanStatementsForByValueMutation(fn.statements, fn.originalName, byValueParams, diagnostics);
  }
}

/**
 * Recursively scans statement lists for assign/update to fields of by-value params.
 */
function scanStatementsForByValueMutation(
  stmts: StatementIR[],
  fnName: string,
  byValueParams: Set<string>,
  diagnostics: Diagnostic[],
): void {
  for (const stmt of stmts) {
    if (stmt.kind === 'assign' || stmt.kind === 'update') {
      const target: string = (stmt as any).target;
      if (target) {
        const dotIdx = target.indexOf('.');
        if (dotIdx > 0) {
          const baseName = target.substring(0, dotIdx);
          if (byValueParams.has(baseName)) {
            diagnostics.push({
              severity: 'warning',
              message: `Mutating '${target}' on by-value parameter '${baseName}' in '${fnName}()' — changes are invisible to the caller.`,
              hint: `Use '${baseName}: Mutable<T>' to pass by mutable reference (T&) instead of a copy.`,
              line: stmt.sourceSpan.startLine,
              column: stmt.sourceSpan.startColumn,
              filePath: stmt.sourceSpan.filePath,
              code: 'ownership-mutate-copy',
              source: 'ownership-analysis',
            });
          }
        }
      }
    }
    // Recurse into nested statement blocks
    if ('body' in stmt && Array.isArray(stmt.body)) scanStatementsForByValueMutation(stmt.body, fnName, byValueParams, diagnostics);
    if ('thenBranch' in stmt && Array.isArray(stmt.thenBranch)) scanStatementsForByValueMutation(stmt.thenBranch, fnName, byValueParams, diagnostics);
    if ('elseBranch' in stmt && Array.isArray(stmt.elseBranch)) scanStatementsForByValueMutation(stmt.elseBranch, fnName, byValueParams, diagnostics);
    if ('cases' in stmt && Array.isArray(stmt.cases)) {
      for (const c of stmt.cases) {
        if (c.body) scanStatementsForByValueMutation(c.body, fnName, byValueParams, diagnostics);
      }
    }
    if ('tryBlock' in stmt && Array.isArray(stmt.tryBlock)) scanStatementsForByValueMutation(stmt.tryBlock, fnName, byValueParams, diagnostics);
    if ('catchBlock' in stmt && Array.isArray(stmt.catchBlock)) scanStatementsForByValueMutation(stmt.catchBlock, fnName, byValueParams, diagnostics);
    if ('finallyBlock' in stmt && Array.isArray(stmt.finallyBlock)) scanStatementsForByValueMutation(stmt.finallyBlock, fnName, byValueParams, diagnostics);
  }
}

/**
 * Validates ownership rules across the entire program.
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

  // If no ownership types are used, skip full ownership validation (opt-in).
  // Still check for by-value struct param mutations — that diagnostic is
  // useful whether or not the user has adopted ownership annotations.
  checkByValueParamMutations(program, diagnostics);

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
    // Register parameters — those with explicit ownership annotations get full
    // borrow tracking; by-value non-primitive params are recorded so we can warn
    // when their fields are mutated (changes won't be visible to the caller).
    for (const param of fn.parameters) {
      const kind = param.ownershipKind;
      if (kind) {
        fnScope.declare(param.name, kind, false, undefined, param.cppType);
        fnScope.usesOwnershipTypes = true;
      } else if (
        param.cppType &&
        !isPrimitiveCppType(param.cppType) &&
        !parsedIsPointer(param.cppType) &&
        !isStdContainerType(param.cppType)
      ) {
        fnScope.byValueStructParams.add(param.name);
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
                  message: `Moving '${initName}' into '${stmt.name}' creates a C++ copy.`,
                  hint: `const ${stmt.name}: Shared = ${initName};  // borrow by reference instead of copying`,
                  line: span.startLine,
                  column: span.startColumn,
                  filePath: span.filePath,
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
                filePath: span.filePath,
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
              filePath: span.filePath,
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
          filePath: span.filePath,
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

      // ownership-mutate-copy: mutating a field on a by-value struct parameter.
      // Changes are local to the function and invisible to the caller.
      const dotIdx = stmt.target.indexOf('.');
      if (dotIdx > 0) {
        const baseName = stmt.target.substring(0, dotIdx);
        if (scope.byValueStructParams.has(baseName)) {
          diagnostics.push({
            severity: 'warning',
            message: `Mutating '${stmt.target}' on by-value parameter '${baseName}' — changes are invisible to the caller.`,
            hint: `Use '${baseName}: Mutable<T>' to pass by mutable reference (T&) instead of a copy.`,
            line: span.startLine,
            column: span.startColumn,
            filePath: span.filePath,
            code: 'ownership-mutate-copy',
            source: 'ownership-analysis',
          });
        }
      }

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
          filePath: span.filePath,
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
          filePath: span.filePath,
          code: 'ownership-use-after-move',
          source: 'ownership-analysis',
        });
      }

      scope.markAssigned(stmt.target);

      // ownership-mutate-copy (update path): same check as assign above
      const upDotIdx = stmt.target.indexOf('.');
      if (upDotIdx > 0) {
        const upBaseName = stmt.target.substring(0, upDotIdx);
        if (scope.byValueStructParams.has(upBaseName)) {
          diagnostics.push({
            severity: 'warning',
            message: `Mutating '${stmt.target}' on by-value parameter '${upBaseName}' — changes are invisible to the caller.`,
            hint: `Use '${upBaseName}: Mutable<T>' to pass by mutable reference (T&) instead of a copy.`,
            line: span.startLine,
            column: span.startColumn,
            filePath: span.filePath,
            code: 'ownership-mutate-copy',
            source: 'ownership-analysis',
          });
        }
      }

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
                filePath: span.filePath,
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
    case 'super_call':
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
          filePath: span.filePath,
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
              filePath: span.filePath,
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

    case 'tuple-access': {
      analyzeExpression(expr.object, scope, diagnostics, span);
      break;
    }

    case 'paren': {
      analyzeExpression(expr.inner, scope, diagnostics, span);
      break;
    }

    case 'call': {
      for (const arg of expr.args) {
        analyzeExpression(arg, scope, diagnostics, span);
      }
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
  // Methods whose C++ lowering mutates the receiver (so a `const` binding
  // mutated through them must be demoted to non-const).
  const MUTATING_METHODS = new Set([
    'push', 'push_back', 'pop', 'pop_back', 'shift', '__tc_shift',
    'unshift', '__tc_unshift', 'splice', '__tc_splice1', '__tc_splice2',
    'sort', '__tc_sort', '__tc_sort_fn', 'fill', '__tc_fill',
    '__tc_fill3', 'reverse', '__tc_reverse', 'clear',
    // Set.add() -> insert, Map/Set.delete() -> erase (demo #15 fix C)
    'insert', 'erase',
  ]);

  // Safety wrapper types (SafeVariable/SafeInt) mutate only through method
  // calls — the C++ members are non-const by design. Kept separate from
  // MUTATING_METHODS because these names ('set', 'add', ...) are matched
  // ONLY against receivers whose declared cppType is a safety wrapper, so
  // unrelated user classes with same-named methods are unaffected.
  const SAFETY_WRAPPER_MUTATING_METHODS = new Set([
    // SafeVariable<T>
    'set',
    // SafeInt<T> mutating chain
    'add', 'sub', 'mul', 'divide', 'mod', 'negate', 'absValue', 'reset',
  ]);
  const isSafetyWrapperCppType = (cppType: string | undefined): boolean =>
    typeof cppType === 'string' && (cppType.startsWith('SafeInt') || cppType.startsWith('SafeVariable'));

  type LetEntry = { name: string; everAssigned: boolean; stmt: VariableDeclarationIR; span: SourceSpan };
  type ConstEntry = { stmt: VariableDeclarationIR; span: SourceSpan };

  // Every lexical statement body in the program. Demotion (const-content-
  // mutated) and the suggest-const global-assignment scan must reach class
  // methods, getters, setters, constructors, and namespace-scoped functions —
  // not just top-level statements and free `function`s. Without this, a
  // `const`-bound loop variable (or collection) mutated inside a class method
  // is never demoted, so the emitter keeps `const T&` and g++ rejects the
  // mutation (demo #17). Each body is analyzed with its own scope-local maps
  // (see analyzeScope below), so this only enumerates the bodies; it does not
  // merge their scopes.
  const allStatementBodies: StatementIR[][] = [program.topLevelStatements];
  for (const fn of program.functions) allStatementBodies.push(fn.statements);
  for (const cls of program.classes) {
    for (const method of cls.methods) allStatementBodies.push(method.statements);
    for (const getter of cls.getters) allStatementBodies.push(getter.statements);
    for (const setter of cls.setters) allStatementBodies.push(setter.statements);
    if (cls.constructor) allStatementBodies.push(cls.constructor.statements);
  }
  // Namespaces are recursive (a namespace can nest classes/namespaces).
  const collectNamespaceBodies = (ns: typeof program.namespaces[number]): void => {
    for (const fn of ns.functions) allStatementBodies.push(fn.statements);
    for (const cls of ns.classes) {
      for (const method of cls.methods) allStatementBodies.push(method.statements);
      for (const getter of cls.getters) allStatementBodies.push(getter.statements);
      for (const setter of cls.setters) allStatementBodies.push(setter.statements);
      if (cls.constructor) allStatementBodies.push(cls.constructor.statements);
    }
    for (const child of ns.children ?? []) collectNamespaceBodies(child);
  };
  for (const ns of program.namespaces) collectNamespaceBodies(ns);
  // Callbacks registered out-of-band (interrupt handlers, Thread.start,
  // watchPin / drawCanvas bodies) carry their statements on the callback
  // expression rather than in a function body. A top-level `let` mutated
  // only inside one must not be const-suggested — the emitted `const`
  // makes g++ reject the assignment.
  for (const rc of program.registeredCallbacks ?? []) {
    allStatementBodies.push(rc.callbackIR.statements);
  }

  // Collect every plain-identifier assignment / update target across the whole
  // program. A `let` declared in one scope may be reassigned by a *different*
  // function that closes over it (e.g. a top-level `let counter` reassigned in
  // `main()`), so the suggest-const check must be suppressed for any name that
  // is assigned anywhere. Demotion (const-content-mutated), by contrast, is
  // resolved scope-locally below — a mutation in one function must not demote a
  // same-named `const` in a sibling function (demo #16 gap #2).
  const globallyAssignedNames = new Set<string>();
  const collectAssignedNames = (stmts: StatementIR[]): void => {
    for (const stmt of stmts) {
      if (stmt.kind === 'assign' || stmt.kind === 'update') {
        // Only a bare-identifier target counts as "this var is reassigned";
        // dotted/bracket targets (out.a, arr[i]) mutate contents, not the binding.
        if (/^[A-Za-z_$][\w$]*$/.test(stmt.target)) {
          globallyAssignedNames.add(stmt.target);
        }
      }
      const nested = getNestedStatements(stmt);
      if (nested) collectAssignedNames(nested);
    }
  };
  for (const body of allStatementBodies) collectAssignedNames(body);

  // Walk one lexical scope (a top-level or function body) in a single pass,
  // registering declarations and detecting mutations against the SAME
  // scope-local maps. This is critical: the previous implementation ran two
  // separate passes over all functions with flat name-keyed maps, so a
  // `const labels` in one function collided with a `let labels` in another
  // (demo #16 gap #2 — a read-only `const` Map was wrongly demoted because a
  // same-named binding in a sibling function was mutated). Scope-local maps
  // make declaration and mutation resolve within their own function.
  const analyzeScope = (stmts: StatementIR[]): void => {
    const letVars = new Map<string, LetEntry>();
    const constVars = new Map<string, ConstEntry>();

    const walk = (statements: StatementIR[]): void => {
      for (const stmt of statements) {
        if (stmt.kind === 'var_decl') {
          if (stmt.storage === 'let') {
            letVars.set(stmt.name, { name: stmt.name, everAssigned: false, stmt, span: stmt.sourceSpan });
          } else if (stmt.storage === 'const') {
            // Track const decls whose contents could be mutated via a method
            // or element/member assignment; the mutation checks below decide
            // whether to demote.
            constVars.set(stmt.name, { stmt, span: stmt.sourceSpan });
          }
        }
        if (stmt.kind === 'assign') {
          const entry = letVars.get(stmt.target);
          if (entry) entry.everAssigned = true;
          // Element assignment on a `const` array/map (e.g. `arr[i] = x` where
          // `arr` is `const`) compiles in TS but fails against the emitted
          // `const std::vector<T>` / `const std::map<K,V>`. Demote the binding.
          // The target string is the lowered C++ lvalue, e.g. `arr[0]`/`m[key]`.
          const bracket = stmt.target.indexOf('[');
          if (bracket > 0) {
            const baseName = stmt.target.slice(0, bracket);
            // A let array/map mutated via element assignment (arr[i] = x or
            // m.set(k,v), which lowers to m[k]=v) is effectively reassigned —
            // mark it so ownership-suggest-const does not wrongly recommend
            // making it const (which would then fail g++). (demo #15 fix C)
            const letEntry = letVars.get(baseName);
            if (letEntry) letEntry.everAssigned = true;
            const constEntry = constVars.get(baseName);
            if (constEntry && constEntry.stmt.storage === 'const') {
              constEntry.stmt.storage = 'let';
              diagnostics.push({
                severity: 'info',
                message: `'${baseName}' is declared 'const' but its contents are mutated via index assignment — demoted to non-const in C++ so the mutation compiles.`,
                line: constEntry.span.startLine,
                column: constEntry.span.startColumn,
                filePath: constEntry.span.filePath,
                code: 'ownership-const-content-mutated',
                source: 'ownership-analysis',
              });
            }
          }
          // Member assignment on a `const` struct local (e.g. `out.a = 5` where
          // `out` is `const Pair`) compiles in TS but fails against the emitted
          // `const Pair out` (read-only aggregate). Demote the binding. The
          // target is a dotted lvalue like `out.a` or `out->a`.
          const dot = stmt.target.indexOf('.');
          const arrow = stmt.target.indexOf('->');
          const sepIdx = dot >= 0 ? dot : arrow;
          if (sepIdx > 0) {
            const baseName = stmt.target.slice(0, sepIdx);
            const constEntry = constVars.get(baseName);
            if (constEntry && constEntry.stmt.storage === 'const') {
              constEntry.stmt.storage = 'let';
              diagnostics.push({
                severity: 'info',
                message: `'${baseName}' is declared 'const' but a field is mutated via member assignment — demoted to non-const in C++ so the mutation compiles.`,
                line: constEntry.span.startLine,
                column: constEntry.span.startColumn,
                filePath: constEntry.span.filePath,
                code: 'ownership-const-content-mutated',
                source: 'ownership-analysis',
              });
            }
          }
        }
        if (stmt.kind === 'update') {
          const entry = letVars.get(stmt.target);
          if (entry) entry.everAssigned = true;
          // A `++`/`--` on a member of a `const` local (e.g. `t.hits++` where
          // `t` is a const loop variable) is the UpdateExpression analogue of
          // the member-assignment demotion above. The target string is the
          // lowered lvalue, e.g. `t.hits` / `t->hits`. Demote the const base.
          const dot = stmt.target.indexOf('.');
          const arrow = stmt.target.indexOf('->');
          const sepIdx = dot >= 0 ? dot : arrow;
          if (sepIdx > 0) {
            const baseName = stmt.target.slice(0, sepIdx);
            const constEntry = constVars.get(baseName);
            if (constEntry && constEntry.stmt.storage === 'const') {
              constEntry.stmt.storage = 'let';
              diagnostics.push({
                severity: 'info',
                message: `'${baseName}' is declared 'const' but a field is mutated via ++/-- — demoted to non-const in C++ so the mutation compiles.`,
                line: constEntry.span.startLine,
                column: constEntry.span.startColumn,
                filePath: constEntry.span.filePath,
                code: 'ownership-const-content-mutated',
                source: 'ownership-analysis',
              });
            }
          }
        }
        // A `let`/`const` collection mutated via a mutating method call
        // (e.g. arr.push(x)) is effectively reassigned — the C++ emitter must
        // keep the binding non-const so push_back/splice/etc. compile. The
        // callee is the lowered C++ name, e.g. "arr.push_back".
        if (stmt.kind === 'call' && typeof (stmt as any).callee === 'string') {
          // Value-arg array methods (.push/.pop/.fill/...) are lowered in
          // call-statement.ts to a fully-formed raw C++ expression wrapped as
          // `__RAW_STMT__<receiver>.<method>(<args>)` (e.g. `__RAW_STMT__arr.push_back(1)`).
          // Strip the wrapper — and the trailing `(args)` when present — before
          // splitting, otherwise the dot parse yields a receiver of
          // `__RAW_STMT__arr` and a method of `push_back(1)` and the demotion
          // below never fires, leaving a non-compiling `const std::vector` +
          // push_back. Mirrors the __RAW_STMT__ handling in program-analysis.ts.
          const rawCallee: string = (stmt as any).callee;
          const unwrapped = rawCallee.startsWith('__RAW_STMT__')
            ? rawCallee.slice('__RAW_STMT__'.length)
            : rawCallee;
          const parenIdx = unwrapped.indexOf('(');
          const callee = parenIdx > 0 ? unwrapped.slice(0, parenIdx) : unwrapped;
          const dot = callee.lastIndexOf('.');
          if (dot > 0) {
            const receiver = callee.slice(0, dot);
            const method = callee.slice(dot + 1);
            if (MUTATING_METHODS.has(method)) {
              const entry = letVars.get(receiver);
              if (entry) entry.everAssigned = true;
              // Demote a `const` binding whose contents are mutated via a
              // method call: TS permits this, but the emitted
              // `const std::vector<T>` (or std::map/std::string) rejects
              // `.push_back`/etc. Flip the IR storage to `let` so the
              // emitter drops the `const` qualifier, and surface an
              // info-diagnostic so the rewrite isn't silent.
              const constEntry = constVars.get(receiver);
              if (constEntry && constEntry.stmt.storage === 'const') {
                constEntry.stmt.storage = 'let';
                diagnostics.push({
                  severity: 'info',
                  message: `'${receiver}' is declared 'const' but its contents are mutated via .${method}() — demoted to non-const in C++ so the mutation compiles.`,
                  line: constEntry.span.startLine,
                  column: constEntry.span.startColumn,
                  filePath: constEntry.span.filePath,
                  code: 'ownership-const-content-mutated',
                  source: 'ownership-analysis',
                });
              }
            }
            // Safety wrapper mutation: match on the LEADING identifier of the
            // callee — chained calls arrive as partially-rendered callees
            // (e.g. `count.add(5).mul`) whose receiver segment is not a bare
            // identifier — and gate on the receiver's declared safety cppType
            // so same-named methods on non-safety types are untouched.
            if (SAFETY_WRAPPER_MUTATING_METHODS.has(method)) {
              const baseDot = callee.indexOf('.');
              const base = baseDot > 0 ? callee.slice(0, baseDot) : receiver;
              const letEntry = letVars.get(base);
              if (letEntry && isSafetyWrapperCppType(letEntry.stmt.cppType)) {
                letEntry.everAssigned = true;
              }
              const constEntry = constVars.get(base);
              if (constEntry && constEntry.stmt.storage === 'const' && isSafetyWrapperCppType(constEntry.stmt.cppType)) {
                constEntry.stmt.storage = 'let';
                diagnostics.push({
                  severity: 'info',
                  message: `'${base}' is declared 'const' but is mutated via .${method}() — demoted to non-const in C++ so the mutation compiles.`,
                  line: constEntry.span.startLine,
                  column: constEntry.span.startColumn,
                  filePath: constEntry.span.filePath,
                  code: 'ownership-const-content-mutated',
                  source: 'ownership-analysis',
                });
              }
            }
          }
        }
        // Recurse into nested statements (shares this scope's maps — a nested
        // block can see and mutate the enclosing function's locals).
        const nested = getNestedStatements(stmt);
        if (nested) {
          walk(nested);
        }
      }
    };

    walk(stmts);

    // Promote `let` bindings that are never reassigned (in this scope or any
    // other) to `const` in the emitted C++. The transpiler's whole-program
    // reassignment analysis proves the binding is never written after init —
    // information the compiler cannot recover across translation units. Emitting
    // `const` lets the compiler place the value in flash/ROM and enables
    // constant folding. The inverse demotion (const→let when a member is
    // mutated) already mutates `.storage` the same way (see above), so the
    // emit path already handles both directions.
    for (const entry of letVars.values()) {
      if (entry.everAssigned || globallyAssignedNames.has(entry.name)) continue;
      // Safety wrapper declarations mutate exclusively through method calls
      // (.set/.add/...), and chained mutating calls render as callee text the
      // reassignment walk cannot fully parse — non-mutation cannot be proven
      // for these types, so they are never promoted (a promoted `const
      // SafeVariable` / `const SafeInt` rejects every mutating member in g++).
      if (isSafetyWrapperCppType(entry.stmt.cppType)) continue;
      // A typed-array buffer (`const id = new Uint8Array(N)`, forced to let at
      // IR build) lowers with a pointer cppType + array initializer. HAL fills
      // write through it opaquely — the lowered C++ embeds the buffer name in
      // hal-op text (e.g. spi.transceive's rx), which the reassignment walk
      // above cannot see. Promoting it to const would make the HAL fill
      // undefined behavior and disagree with the array-shaped definition.
      const bufferInit = entry.stmt.initializer;
      if (bufferInit?.kind === 'array' && /\*\s*$/.test(entry.stmt.cppType ?? '')) continue;
      entry.stmt.storage = 'const';
      diagnostics.push({
        severity: 'info',
        message: `'${entry.name}' is never reassigned — emitted as \`const\` so the C++ compiler can place it in ROM and fold it.`,
        line: entry.span.startLine,
        column: entry.span.startColumn,
        filePath: entry.span.filePath,
        code: 'ownership-suggest-const',
        source: 'ownership-analysis',
      });
    }
  };

  for (const body of allStatementBodies) analyzeScope(body);
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
                  filePath: stmt.sourceSpan.filePath,
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
          filePath: span.filePath,
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
    case 'super_call':
      return undefined;
    default:
      assertNever(stmt);
  }
}
