import ts from "typescript";
import type { Diagnostic } from "../types.js";
import { canonicalize, cppTypeFromCanonicalType, TYPED_ARRAY_NAMES } from "./semantic-facts.js";
import type { FactStore } from "./semantic-facts.js";
import { makeDiagnostic } from "../ir/ast-node-utils.js";

// ---------------------------------------------------------------------------
// SemanticFacts completeness verifier (Phase 3).
//
// Design ref: docs/design-semantic-facts.md §6 Phase 3.
//
// The verifier runs after buildSemanticFacts and before gate rules. Its job is
// to assert invariants about the fact layer so the layer cannot silently decay
// back into a side-channel:
//
//   1. Every expression in user code has a CanonicalType other than "unknown".
//      A type that canonicalizes to "unknown" means either `any`/`unknown`
//      leaked past strict mode, or canonicalize() can't classify it — either is
//      a real hazard because the C++ lowering has no sound target type.
//   2. No fatal diagnostic is emitted after this boundary (i.e. the verifier is
//      the last producer of fatal *analysis* diagnostics; gates produce rule
//      diagnostics only). This check is structural — enforced by call order in
//      runSemanticGates, not re-checked here.
//
// Check #1 severity is configurable (see VerifierOptions). The default is
// "warning" rather than "error": per design doc §11.3, making `unknown`-typed
// expressions fatal may surface new errors in existing programs, so the
// severity is a policy decision deferred to the caller. runSemanticGates
// currently calls with the default (warning) to avoid breaking existing builds;
// callers that want strict enforcement pass { unknownTypeSeverity: "error" }.
//
// The verifier does NOT re-walk to check "no gate calls the TypeChecker"
// (design check #3) — that is a static module-boundary invariant, enforced by
// the gate-rule modules importing only from semantic-facts, and verified by
// review/lint rather than at runtime.
// ---------------------------------------------------------------------------

export type UnknownTypeSeverity = "error" | "warning" | "off";

export interface VerifierOptions {
  /** Severity for expressions whose canonical type is "unknown".
   *  Default "warning" — see module header. */
  unknownTypeSeverity?: UnknownTypeSeverity;
}

export interface VerifierResult {
  /** Diagnostics produced by the verifier (may be empty). */
  diagnostics: Diagnostic[];
  /** Counts for measurement/reporting. Use to size the blast radius before
   *  flipping unknownTypeSeverity to "error". */
  counts: {
    expressionsVisited: number;
    unknownTypeExpressions: number;
  };
}

/** Names of nodes that are not "expressions" we want to type-check — they're
 *  type-only or structural and would produce noise. */
function isSkippableForTyping(node: ts.Node): boolean {
  // Type-only constructs (isTypeNode covers TypeReference, TypeLiteral, etc.).
  return (
    ts.isTypeNode(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isHeritageClause(node) ||
    ts.isTypeParameterDeclaration(node) ||
    // Statements themselves aren't typed; their expressions are visited.
    ts.isStatement(node)
  );
}

/** A blank identifier (`_`) used as a deliberate discard isn't a value use. */
function isVoidOrNeverExpression(node: ts.Expression): boolean {
  return (
    node.kind === ts.SyntaxKind.VoidExpression ||
    node.kind === ts.SyntaxKind.DeleteExpression
  );
}

/**
 * Verify semantic-fact completeness across user files.
 *
 * Walks every expression, computes its CanonicalType, and emits a diagnostic
 * for each one that resolves to "unknown" (at the configured severity).
 *
 * If `facts` is passed, the walk also POPULATES the store with the computed
 * `type` (CanonicalType) and `cppType` for each expression. This is the single
 * place concrete per-expression type facts are recorded — Phase 3 of the type-
 * resolution consolidation — so gate rules can read them without re-deriving
 * from the ts.TypeChecker, and so a future pipeline reorder can populate the
 * same fields from the ProgramIR SymbolTable instead. See SemanticFacts.cppType.
 */
export function verifyFacts(
  program: ts.Program,
  userFiles: string[],
  options: VerifierOptions & { facts?: FactStore } = {},
): VerifierResult {
  const unknownSeverity: UnknownTypeSeverity = options.unknownTypeSeverity ?? "warning";
  const facts = options.facts;
  const checker = program.getTypeChecker();
  const userFileSet = new Set(userFiles.map((f) => f.replace(/\\/g, "/")));
  const diagnostics: Diagnostic[] = [];
  let expressionsVisited = 0;
  let unknownTypeExpressions = 0;

  for (const sourceFile of program.getSourceFiles()) {
    const filePath = sourceFile.fileName.replace(/\\/g, "/");
    if (!userFileSet.has(filePath)) continue;
    if (filePath.includes("/node_modules/") || filePath.includes("/packages/")) continue;

    const sourceText = sourceFile.getFullText();

    const visit = (node: ts.Node): void => {
      if (isSkippableForTyping(node)) {
        // Still recurse so nested expressions in non-skippable children are
        // visited, but don't type-check the skippable node itself.
        ts.forEachChild(node, visit);
        return;
      }

      if (ts.isExpression(node) && !isVoidOrNeverExpression(node)) {
        expressionsVisited++;
        const type = checker.getTypeAtLocation(node);
        const category = canonicalize(checker, type);
        // Record the concrete type facts on this expression node. `type` makes
        // the SemanticFacts.type field actually populated (it was previously
        // declared but only computed ephemerally here); `cppType` is the
        // Phase 3 addition. Both are no-ops when no store is passed.
        if (facts) {
          facts.merge(node, {
            type: category,
            ...(category !== "unknown"
              ? { cppType: cppTypeFromCanonicalType(checker, type, category) }
              : {}),
          });
        }
        if (category === "unknown") {
          unknownTypeExpressions++;
          if (unknownSeverity !== "off") {
            diagnostics.push(
              makeUnknownTypeDiagnostic(sourceText, node, checker, type),
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  // Apply severity to the collected unknown-type diagnostics.
  if (unknownSeverity === "warning") {
    for (const d of diagnostics) d.severity = "warning";
  } else if (unknownSeverity === "error") {
    for (const d of diagnostics) d.severity = "error";
  }

  return {
    diagnostics,
    counts: { expressionsVisited, unknownTypeExpressions },
  };
}

function makeUnknownTypeDiagnostic(
  sourceText: string,
  node: ts.Node,
  checker: ts.TypeChecker,
  type: ts.Type,
): Diagnostic {
  const message = describeUnknownType(type, checker, node);
  const diag = makeDiagnostic(sourceText, node.getStart(), message, "warning", "TS2CPP_UNCLASSIFIABLE_TYPE");
  diag.source = "semantic-facts-verifier";
  return diag;
}

/**
 * Produce a human-readable reason for why a type canonicalized to "unknown".
 * By the time this runs, `any` has already been classified to its own category
 * (not "unknown"), so the only remaining causes are `unknown`/`never` types
 * (which the lowering can't target) or a type canonicalize() doesn't yet
 * recognize (a classifier gap to report).
 */
function describeUnknownType(
  type: ts.Type,
  checker: ts.TypeChecker,
  node: ts.Node,
): string {
  const flags = type.flags;
  const typeStr = checker.typeToString(type);
  const exprText = node.getText().slice(0, 40);
  if (flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Never)) {
    return `Expression '${exprText}' has type '${typeStr}', which has no safe C++ target. Use an explicit type annotation.`;
  }
  // Not unknown/never but still unclassified — canonicalize() has a gap.
  return `Expression '${exprText}' has type '${typeStr}', which the type classifier does not yet recognize. This is a cuttlefish gap — please report it.`;
}

/** Re-export so callers can introspect the typed-array name set if needed. */
export { TYPED_ARRAY_NAMES };
