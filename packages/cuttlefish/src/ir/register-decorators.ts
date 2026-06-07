import ts from "typescript";

export function getRegisterAddress(node: ts.ClassDeclaration): number | undefined {
  const decorators = (ts as any).canHaveDecorators?.(node)
    ? (ts as any).getDecorators?.(node)
    : (node as any).decorators;
  if (!decorators) return undefined;

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
  const decorators = (ts as any).canHaveDecorators?.(node)
    ? (ts as any).getDecorators?.(node)
    : (node as any).decorators;
  if (!decorators) return undefined;

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