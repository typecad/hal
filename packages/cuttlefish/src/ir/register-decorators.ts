import ts from "typescript";

export function getRegisterAddress(node: ts.ClassDeclaration): number | undefined {
  let decorators: readonly ts.Decorator[] | undefined = (ts as any).canHaveDecorators?.(node)
    ? (ts as any).getDecorators?.(node)
    : (node as any).decorators;
  if (!decorators || decorators.length === 0) {
    // A STANDARD-mode parse (no experimentalDecorators in the parse context —
    // the raw buildProgramIR/test path) stores decorators in `modifiers`
    // instead of the legacy `decorators` slot. The register machinery reads
    // them syntactically, so accept either shape.
    decorators = node.modifiers?.filter(
      (m): m is ts.Decorator => m.kind === ts.SyntaxKind.Decorator,
    );
  }
  if (!decorators || decorators.length === 0) return undefined;

  for (const dec of decorators as ts.NodeArray<ts.Decorator>) {
    if (!ts.isCallExpression(dec.expression)) continue;
    const callee = dec.expression.expression;
    if (!ts.isIdentifier(callee) || callee.text !== "register") continue;
    const args = dec.expression.arguments;
    if (args.length < 1) continue;
    const arg = args[0];
    if (ts.isNumericLiteral(arg) || ts.isBigIntLiteral?.(arg)) {
      return Number(arg.text);
    }
    if (ts.isPrefixUnaryExpression(arg) && arg.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(arg.operand)) {
      return -Number(arg.operand.text);
    }
  }
  return undefined;
}

export function getBitsRange(node: ts.PropertyDeclaration): { hi: number; lo: number } | undefined {
  let decorators: readonly ts.Decorator[] | undefined = (ts as any).canHaveDecorators?.(node)
    ? (ts as any).getDecorators?.(node)
    : (node as any).decorators;
  if (!decorators || decorators.length === 0) {
    decorators = node.modifiers?.filter(
      (m): m is ts.Decorator => m.kind === ts.SyntaxKind.Decorator,
    );
  }
  if (!decorators || decorators.length === 0) return undefined;

  for (const dec of decorators as ts.NodeArray<ts.Decorator>) {
    if (!ts.isCallExpression(dec.expression)) continue;
    const callee = dec.expression.expression;
    if (!ts.isIdentifier(callee) || callee.text !== "bits") continue;
    const args = dec.expression.arguments;
    if (args.length < 2) continue;
    const hiArg = args[0];
    const loArg = args[1];
    if (ts.isNumericLiteral(hiArg) && ts.isNumericLiteral(loArg)) {
      return { hi: Number(hiArg.text), lo: Number(loArg.text) };
    }
  }
  return undefined;
}