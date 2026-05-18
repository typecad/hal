import type { StatementIR } from "@typehal/core";
import { cloneEmissionScopeState, recordVariableType } from "../snprintf-helpers";
import { emitCommentLines } from "../utils";
import { escapeCppKeyword } from "../../utils/strings";
import type { EmitterContext } from "./emitter-context";

export function appendSourceLine(
  ctx: EmitterContext,
  line: string,
  entry?: { tsSpan: any; nodeKind: string; symbolName?: string },
): void {
  ctx.sourceLines.push(line);
  if (!entry) return;

  const generatedLine = ctx.sourceLines.length;
  ctx.sourceMapEntries.push({
    generatedStartLine: generatedLine,
    generatedStartColumn: 1,
    generatedEndLine: generatedLine,
    generatedEndColumn: Math.max(1, line.length + 1),
    tsSpan: entry.tsSpan,
    nodeKind: entry.nodeKind,
    symbolName: entry.symbolName,
  });
}

export function appendHeaderLine(
  ctx: EmitterContext,
  line: string,
  entry?: { tsSpan: any; nodeKind: string; symbolName?: string },
): void {
  ctx.headerLines.push(line);
  if (!entry) return;

  const generatedLine = ctx.headerLines.length;
  ctx.headerMapEntries.push({
    generatedStartLine: generatedLine,
    generatedStartColumn: 1,
    generatedEndLine: generatedLine,
    generatedEndColumn: Math.max(1, line.length + 1),
    tsSpan: entry.tsSpan,
    nodeKind: entry.nodeKind,
    symbolName: entry.symbolName,
  });
}

export function appendRenderedStatement(
  ctx: EmitterContext,
  statement: StatementIR,
  indent: string,
  scopeState: any,
): void {
  const { statementRenderer, exprRenderer, fixPointerFieldAccess, platformReservedNames } = ctx;

  emitCommentLines(statement.leadingComments, indent, (line) => appendSourceLine(ctx, line));

  if (statement.kind === "while") {
    const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
    for (const line of prelude) appendSourceLine(ctx, `${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}{`);
    const nestedScope = cloneEmissionScopeState(scopeState);
    for (const nested of statement.body) appendRenderedStatement(ctx, nested, `${indent}  `, nestedScope);
    appendSourceLine(ctx, `${indent}}`);
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    return;
  }

  if (statement.kind === "if") {
    const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
    for (const line of prelude) appendSourceLine(ctx, `${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}{`);
    const thenScope = cloneEmissionScopeState(scopeState);
    for (const nested of statement.thenBranch) appendRenderedStatement(ctx, nested, `${indent}  `, thenScope);
    appendSourceLine(ctx, `${indent}}`);
    if (statement.elseBranch && statement.elseBranch.length > 0) {
      appendSourceLine(ctx, `${indent}else {`);
      const elseScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.elseBranch) appendRenderedStatement(ctx, nested, `${indent}  `, elseScope);
      appendSourceLine(ctx, `${indent}}`);
    }
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    return;
  }

  if (statement.kind === "for" || statement.kind === "for_of" || statement.kind === "for_in") {
    const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
    for (const line of prelude) appendSourceLine(ctx, `${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}{`);
    const nestedScope = cloneEmissionScopeState(scopeState);
    if (statement.kind === "for_in" && statement.keys && statement.keys.length > 0 && statement.variable.kind === "var_decl") {
      const objName = statement.object.kind === "identifier" ? statement.object.value : "_obj";
      const idxVar = `_ki_${objName}`;
      const safeName = escapeCppKeyword(statement.variable.name, platformReservedNames);
      appendSourceLine(ctx, `${indent}  const char* ${safeName} = ${idxVar}_keys[${idxVar}];`);
    }
    for (const nested of statement.body) appendRenderedStatement(ctx, nested, `${indent}  `, nestedScope);
    appendSourceLine(ctx, `${indent}}`);
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    return;
  }

  if (statement.kind === "do_while") {
    appendSourceLine(ctx, `${indent}do`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}{`);
    const nestedScope = cloneEmissionScopeState(scopeState);
    for (const nested of statement.body) appendRenderedStatement(ctx, nested, `${indent}  `, nestedScope);
    const renderedCondition = exprRenderer.render(statement.condition, undefined, scopeState.knownVariableTypes);
    appendSourceLine(ctx, `${indent}} while (${renderedCondition});`);
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    return;
  }

  if (statement.kind === "switch") {
    const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
    for (const line of prelude) appendSourceLine(ctx, `${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}{`);
    for (const caseClause of statement.cases) {
      emitCommentLines(caseClause.leadingComments, `${indent}  `, (line) => appendSourceLine(ctx, line));
      if (caseClause.value !== undefined) {
        const renderedValue = exprRenderer.render(caseClause.value, undefined, scopeState.knownVariableTypes);
        appendSourceLine(ctx, `${indent}  case ${renderedValue}:`);
      } else {
        appendSourceLine(ctx, `${indent}  default:`);
      }
      const nestedScope = cloneEmissionScopeState(scopeState);
      for (const nested of caseClause.body) appendRenderedStatement(ctx, nested, `${indent}    `, nestedScope);
      emitCommentLines(caseClause.trailingComments, `${indent}  `, (line) => appendSourceLine(ctx, line));
    }
    appendSourceLine(ctx, `${indent}}`);
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    return;
  }

  if (statement.kind === "block") {
    appendSourceLine(ctx, `${indent}{`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    const nestedScope = cloneEmissionScopeState(scopeState);
    for (const nested of statement.body) appendRenderedStatement(ctx, nested, `${indent}  `, nestedScope);
    appendSourceLine(ctx, `${indent}}`);
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    return;
  }

  if (statement.kind === "try") {
    appendSourceLine(ctx, `${indent}try`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}{`);
    const tryScope = cloneEmissionScopeState(scopeState);
    for (const nested of statement.tryBlock) appendRenderedStatement(ctx, nested, `${indent}  `, tryScope);
    appendSourceLine(ctx, `${indent}}`);
    if (statement.catchBlock) {
      appendSourceLine(ctx, `${indent}catch (...) {`);
      const catchScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.catchBlock) appendRenderedStatement(ctx, nested, `${indent}  `, catchScope);
      appendSourceLine(ctx, `${indent}}`);
    }
    if (statement.finallyBlock) {
      appendSourceLine(ctx, `${indent}{ // finally`);
      const finallyScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.finallyBlock) appendRenderedStatement(ctx, nested, `${indent}  `, finallyScope);
      appendSourceLine(ctx, `${indent}}`);
    }
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    return;
  }

  const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(
    statement,
    false,
    fixPointerFieldAccess,
    scopeState.knownVariableTypes,
  );

  for (const preludeLine of prelude) {
    appendSourceLine(ctx, `${indent}${preludeLine}`, {
      tsSpan: statement.sourceSpan,
      nodeKind: statement.kind,
    });
  }

  appendSourceLine(ctx, `${indent}${rendered}`, {
    tsSpan: statement.sourceSpan,
    nodeKind: statement.kind,
  });
  if (statement.kind === "var_decl") {
    recordVariableType(statement, scopeState);
  }
  emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
}
