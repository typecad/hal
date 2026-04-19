import ts from "typescript";

/**
 * Extract the root identifier and property chain from a property-access expression.
 * e.g., UART0.write.line → { root: "UART0", chain: ["write", "line"] }
 *       D13             → { root: "D13", chain: [] }
 *
 * Returns undefined if the expression is not a simple identifier/property-access chain
 * (e.g., if it contains intermediate call expressions).
 */
export function extractRootAndChain(node: ts.Expression): { root: string; chain: string[] } | undefined {
  if (ts.isIdentifier(node)) {
    return { root: node.text, chain: [] };
  }
  if (ts.isPropertyAccessExpression(node)) {
    const inner = extractRootAndChain(node.expression);
    if (inner) {
      return { root: inner.root, chain: [...inner.chain, node.name.text] };
    }
  }
  return undefined;
}
