/**
 * TypeCode SDK method mapping utilities.
 * Shared between the framework strategy and the emitter.
 */

import type { ExpressionIR } from "../ir/model";

/**
 * Extracts a property access chain from a nested property-access expression.
 * Returns undefined if the expression is not a valid chain of identifiers.
 * 
 * E.g., Board.definition.pin.A0 -> ["Board", "definition", "pin", "A0"]
 */
export function extractPropertyChain(expr: ExpressionIR): string[] | undefined {
  const chain: string[] = [];
  let current: ExpressionIR = expr;
  while (true) {
    if (current.kind === "identifier") {
      chain.unshift(current.value);
      return chain;
    }
    if (current.kind === "property-access") {
      chain.unshift(current.property);
      current = current.object;
      continue;
    }
    // Not a property chain
    return undefined;
  }
}