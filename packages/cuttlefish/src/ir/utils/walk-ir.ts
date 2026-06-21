import type { StatementIR, ExpressionIR, ProgramIR } from "../../api/index.js";

export function walkNestedStatements(stmt: StatementIR, visitor: (s: StatementIR) => void): void {
  if (!stmt || typeof stmt !== "object") return;

  if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) {
    for (const s of stmt.thenBranch) visitor(s);
  }
  if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) {
    for (const s of stmt.elseBranch) visitor(s);
  }
  if ("body" in stmt && Array.isArray(stmt.body)) {
    for (const s of stmt.body) visitor(s);
  }
  if ("initializer" in stmt && stmt.initializer && typeof stmt.initializer === "object" && "sourceSpan" in (stmt.initializer as object)) visitor(stmt.initializer as StatementIR);
  if ("increment" in stmt && stmt.increment && typeof stmt.increment === "object" && "sourceSpan" in (stmt.increment as object)) visitor(stmt.increment as StatementIR);
  if ("cases" in stmt && Array.isArray(stmt.cases)) {
    for (const c of stmt.cases) {
      if (c.body && Array.isArray(c.body)) {
        for (const s of c.body) visitor(s);
      }
    }
  }
  if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) {
    for (const s of stmt.tryBlock) visitor(s);
  }
  if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) {
    for (const s of stmt.catchBlock) visitor(s);
  }
  if ("finallyBlock" in stmt && Array.isArray(stmt.finallyBlock)) {
    for (const s of stmt.finallyBlock) visitor(s);
  }
}

export function walkStatements(stmts: StatementIR[], visitor: (stmt: StatementIR) => void): void {
  for (const stmt of stmts) {
    visitor(stmt);
    walkNestedStatements(stmt, (s) => walkStatements([s], visitor));
  }
}

export function walkExpressionsInExpression(expr: ExpressionIR, visitor: (expr: ExpressionIR) => void): void {
  if (!expr || typeof expr !== "object") return;
  visitor(expr);

  if ("args" in expr && Array.isArray(expr.args)) {
    for (const arg of expr.args) walkExpressionsInExpression(arg, visitor);
  }
  if ("left" in expr) walkExpressionsInExpression(expr.left, visitor);
  if ("right" in expr) walkExpressionsInExpression(expr.right, visitor);
  if ("operand" in expr) walkExpressionsInExpression(expr.operand, visitor);
  if ("condition" in expr && typeof expr.condition === "object") walkExpressionsInExpression(expr.condition, visitor);
  if ("whenTrue" in expr) walkExpressionsInExpression(expr.whenTrue, visitor);
  if ("whenFalse" in expr) walkExpressionsInExpression(expr.whenFalse, visitor);
  if ("inner" in expr) walkExpressionsInExpression(expr.inner, visitor);
  if ("object" in expr && typeof expr.object === "object" && expr.kind !== "instanceof") {
    walkExpressionsInExpression(expr.object, visitor);
  }
  if ("value" in expr && expr.value && typeof expr.value === "object" && "kind" in (expr.value as object)) {
    walkExpressionsInExpression(expr.value, visitor);
  }
  if ("elements" in expr && Array.isArray(expr.elements)) {
    for (const e of expr.elements) walkExpressionsInExpression(e, visitor);
  }
  if ("fields" in expr && Array.isArray(expr.fields)) {
    for (const f of expr.fields) walkExpressionsInExpression(f.value, visitor);
  }
  if ("parts" in expr && Array.isArray(expr.parts)) {
    for (const p of expr.parts) walkExpressionsInExpression(p, visitor);
  }
  if ("expression" in expr && typeof expr.expression === "object" && "kind" in (expr.expression as object)) {
    walkExpressionsInExpression(expr.expression, visitor);
  }
  if ("statements" in expr && Array.isArray(expr.statements)) {
    for (const s of expr.statements as StatementIR[]) {
      if ("value" in s && s.value && typeof s.value === "object") walkExpressionsInExpression(s.value as ExpressionIR, visitor);
      if ("args" in s && Array.isArray(s.args)) {
        for (const a of s.args as ExpressionIR[]) walkExpressionsInExpression(a, visitor);
      }
      if ("initializer" in s && s.initializer) walkExpressionsInExpression(s.initializer as ExpressionIR, visitor);
      if ("condition" in s && typeof s.condition === "object") walkExpressionsInExpression(s.condition as ExpressionIR, visitor);
    }
  }
}

export function walkExpressions(stmts: StatementIR[], visitor: (expr: ExpressionIR) => void): void {
  for (const stmt of stmts) {
    if ("value" in stmt && stmt.value && typeof stmt.value === "object") {
      walkExpressionsInExpression(stmt.value as ExpressionIR, visitor);
    }
    if ("condition" in stmt && typeof stmt.condition === "object") {
      walkExpressionsInExpression(stmt.condition as ExpressionIR, visitor);
    }
    if ("args" in stmt && Array.isArray(stmt.args)) {
      for (const arg of stmt.args as ExpressionIR[]) walkExpressionsInExpression(arg, visitor);
    }
    if ("initializer" in stmt && stmt.initializer) {
      walkExpressionsInExpression(stmt.initializer as ExpressionIR, visitor);
    }
    if ("expression" in stmt && typeof stmt.expression === "object") {
      walkExpressionsInExpression(stmt.expression, visitor);
    }
    walkNestedStatements(stmt, (s) => walkExpressions([s], visitor));
  }
}

export function walkProgramIR(program: ProgramIR, visitor: (stmt: StatementIR) => void): void {
  walkStatements(program.topLevelStatements, visitor);
  for (const fn of program.functions) {
    walkStatements(fn.statements, visitor);
  }
  for (const cls of program.classes) {
    if (cls.constructor) walkStatements(cls.constructor.statements, visitor);
    for (const method of cls.methods) walkStatements(method.statements, visitor);
    for (const getter of cls.getters) walkStatements(getter.statements, visitor);
    for (const setter of cls.setters) walkStatements(setter.statements, visitor);
  }
  for (const ns of program.namespaces) {
    walkNamespaceStatements(ns, visitor);
  }
}

function walkNamespaceStatements(ns: import("../../api/index.js").NamespaceIR, visitor: (stmt: StatementIR) => void): void {
  for (const fn of ns.functions) walkStatements(fn.statements, visitor);
  for (const cls of ns.classes) {
    if (cls.constructor) walkStatements(cls.constructor.statements, visitor);
    for (const method of cls.methods) walkStatements(method.statements, visitor);
    for (const getter of cls.getters) walkStatements(getter.statements, visitor);
    for (const setter of cls.setters) walkStatements(setter.statements, visitor);
  }
  if (ns.children) {
    for (const child of ns.children) walkNamespaceStatements(child, visitor);
  }
}
