import type { StatementIR } from "../../api";
import type { SourceSpan } from "../../types";
import { cloneEmissionScopeState, recordVariableType } from "../snprintf-helpers";
import type { EmissionScopeState } from "../snprintf-helpers";
import { emitCommentLines } from "../utils";
import { escapeCppKeyword } from "../../utils/strings";
import type { EmitterContext } from "./emitter-context";

export function appendSourceLine(
  ctx: EmitterContext,
  line: string,
  entry?: { tsSpan: SourceSpan; nodeKind: string; symbolName?: string },
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
  entry?: { tsSpan: SourceSpan; nodeKind: string; symbolName?: string },
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
  scopeState: EmissionScopeState,
): void {
  const { statementRenderer, exprRenderer, fixPointerFieldAccess, reservedNames } = ctx;

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
    if (statement.kind === "for" && statement.initializer?.kind === "var_decl" && statement.initializer.storage === "var") {
      recordVariableType(statement.initializer, scopeState);
    }
    const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
    for (const line of prelude) appendSourceLine(ctx, `${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}{`);
    const nestedScope = cloneEmissionScopeState(scopeState);
    // Register the loop variable's type in the nested scope so the body can
    // infer property-access types on it (e.g. for-of element field types).
    if ((statement.kind === "for_of" || statement.kind === "for_in") && statement.variable.kind === "var_decl") {
      recordVariableType(statement.variable, nestedScope);
    }
    if (statement.kind === "for_in" && statement.keys && statement.keys.length > 0 && statement.variable.kind === "var_decl") {
      const objName = statement.object.kind === "identifier" ? statement.object.value : "_obj";
      const idxVar = `_ki_${objName}`;
      const safeName = escapeCppKeyword(statement.variable.name, reservedNames);
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
    const renderedCondition = exprRenderer.render(statement.condition, ctx.fixPointerFieldAccess, scopeState.knownVariableTypes);
    appendSourceLine(ctx, `${indent}} while (${renderedCondition});`);
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
    return;
  }

  if (statement.kind === "switch") {
    const switchExpr = statement.expression;
    const isStringSwitch =
      (switchExpr.kind === "identifier" &&
        scopeState.knownVariableTypes?.get(switchExpr.value) != null &&
        ctx.strategy.isStringLikeType(scopeState.knownVariableTypes!.get(switchExpr.value)!.cppType)) ||
      statement.cases.some(c => c.value?.kind === "string");

    const isBooleanSwitch = switchExpr.kind === "boolean" && switchExpr.value === true;
    const hasNonConstantCase = statement.cases.some(c =>
      c.value !== undefined &&
      c.value.kind !== "number" &&
      c.value.kind !== "boolean" &&
      c.value.kind !== "string"
    );

    if (isStringSwitch || isBooleanSwitch || hasNonConstantCase) {
      let switchVar = exprRenderer.render(switchExpr, undefined, scopeState.knownVariableTypes);
      const needsStringWrap = switchExpr.kind === "identifier"
        ? (() => { const vi = scopeState.knownVariableTypes?.get(switchExpr.value); return vi && vi.cppType === "const char*"; })()
        : switchExpr.kind === "property-access";
      if (needsStringWrap) {
        switchVar = `std::string(${switchVar})`;
      }
      let isFirst = true;
      for (const caseClause of statement.cases) {
        emitCommentLines(caseClause.leadingComments, `${indent}  `, (line) => appendSourceLine(ctx, line));
        const bodyWithoutBreak = caseClause.body.filter((s) => s.kind !== "break");
        if (caseClause.value !== undefined) {
          const renderedValue = exprRenderer.render(caseClause.value, undefined, scopeState.knownVariableTypes);
          const keyword = isFirst ? "if" : "} else if";
          const condition = isBooleanSwitch
            ? renderedValue
            : `${switchVar} == ${renderedValue}`;
          appendSourceLine(ctx, `${indent}${keyword} (${condition})`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
          appendSourceLine(ctx, `${indent}{`);
          isFirst = false;
        } else {
          appendSourceLine(ctx, `${indent}} else`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
          appendSourceLine(ctx, `${indent}{`);
        }
        const nestedScope = cloneEmissionScopeState(scopeState);
        for (const nested of bodyWithoutBreak) appendRenderedStatement(ctx, nested, `${indent}  `, nestedScope);
        emitCommentLines(caseClause.trailingComments, `${indent}  `, (line) => appendSourceLine(ctx, line));
      }
      if (!isFirst) {
        appendSourceLine(ctx, `${indent}}`);
      }
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(ctx, line));
      return;
    }

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

  if (statement.kind === "labeled") {
    emitCommentLines(statement.leadingComments, indent, (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, `${indent}${statement.label}:`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    const nestedScope = cloneEmissionScopeState(scopeState);
    for (let i = 0; i < statement.body.length; i++) {
      appendRenderedStatement(ctx, statement.body[i], indent, nestedScope);
    }
    // Emit a no-op statement (`;`) after the label so it is never the last
    // token before a closing brace. Without this, g++ warns "label at end of
    // compound statement only available with '-std=c++23'" and (when the label
    // is unused in a particular code path) "label defined but not used".
    // The __attribute__((unused)) suppresses the -Wunused-label false
    // positive (the label IS a goto target from the labelled break, but the
    // compiler may prove the goto unreachable on some code paths).
    appendSourceLine(ctx, `${indent}__attribute__((unused)) __break_${statement.label}: ;`);
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

  if (statement.kind === "yield") {
    const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
    for (const line of prelude) appendSourceLine(ctx, `${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    return;
  }

  if (statement.kind === "try") {
    appendSourceLine(ctx, `${indent}try`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
    appendSourceLine(ctx, `${indent}{`);
    const tryScope = cloneEmissionScopeState(scopeState);
    for (const nested of statement.tryBlock) appendRenderedStatement(ctx, nested, `${indent}  `, tryScope);
    appendSourceLine(ctx, `${indent}}`);
    if (statement.catchBlock) {
      // TS `catch (e)` catches ANY thrown value (not just std::exception).
      // Emit `catch (...)` (catch-all) so thrown pointers/values of non-
      // std::exception types are caught. If the catch param is named, bind it
      // via a rethrow-and-cast pattern OR just use catch(...) and leave the
      // param unbound (accessing `.message` on an `unknown` catch value isn't
      // type-safe in C++ anyway). Demo #11 Finding E — was `catch (const
      // std::exception& e)` which missed a thrown `RegionError*`.
      const catchDecl = `catch (...) {`;
      appendSourceLine(ctx, `${indent}${catchDecl}`);
      const catchScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.catchBlock) appendRenderedStatement(ctx, nested, `${indent}  `, catchScope);
      appendSourceLine(ctx, `${indent}}`);
    }
    // Render finally block inline immediately after catch (matching TypeScript semantics),
    // instead of using an RAII guard that would defer execution to scope exit.
    if (statement.finallyBlock && statement.finallyBlock.length > 0) {
      const finallyScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.finallyBlock) appendRenderedStatement(ctx, nested, `${indent}`, finallyScope);
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
