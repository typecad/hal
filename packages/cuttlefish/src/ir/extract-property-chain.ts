// ---------------------------------------------------------------------------
// Extract Property Chain
//
// Pure IR utility — recursively walks an ExpressionIR tree to produce a flat
// string array representing a left-to-right property chain.
//
// Example:  Board.definition.memory.flash
//           → ['Board', 'definition', 'memory', 'flash']
//
// Moved from framework-arduino (CP5 decoupling). This function has zero
// framework-specific logic; it only inspects the IR shape.
// ---------------------------------------------------------------------------

import type { ExpressionIR } from "../api/index.js";

/**
 * Walk a nested `property-access` ExpressionIR and return the flat chain of
 * identifiers, e.g. `Board.definition.memory.flash` →
 * `['Board', 'definition', 'memory', 'flash']`.
 *
 * Returns `undefined` when the expression cannot be represented as a simple
 * identifier chain (e.g. contains call expressions, computed indices, etc.).
 */
export function extractPropertyChain(expr: ExpressionIR): string[] | undefined {
  if (expr.kind === "identifier") return [expr.value];
  if (expr.kind === "property-access") {
    const base = extractPropertyChain(expr.object);
    if (base) return [...base, expr.property];
  }
  return undefined;
}
