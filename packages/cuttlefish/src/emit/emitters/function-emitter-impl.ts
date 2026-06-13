import { emitCommentLines, isRuntimeExpression, collectNestedStructDefs, inferObjectFieldType } from "../utils";
import { appendSourceLine, appendHeaderLine, appendRenderedStatement } from "./line-appender";
import { createChildEmissionScope } from "../snprintf-helpers";
import { escapeCppKeyword } from "../../utils/strings";
import type { EmitterContext } from "./emitter-context";

export function emitPostClassDeclarations(ctx: EmitterContext): void {
  const { strategy, effectiveEmitMode, mappedFunctions, isEntryFile, topLevelScope } = ctx;
  const platformReservedNames = strategy.reservedNames();
  const normalizeCppTypeForTarget = (cppType: string) => strategy.normalizeCppType(cppType);

  // Runtime variable declarations AFTER classes (for non-entry files)
  if (!isEntryFile) {
    for (const statement of ctx.emittedTopLevelStatements) {
      if (statement.kind === "var_decl" && statement.initializer && isRuntimeExpression(statement.initializer)) {
        appendRenderedStatement(ctx, statement, "", topLevelScope);
      }
    }
  }

  // Forward declarations for promoted runtime var_decls
  if (ctx.promotedVarDecls.size > 0) {
    for (const [varName, info] of ctx.promotedVarDecls) {
      const defaultInit = info.cppType.includes('*') ? 'nullptr' : '0';
      appendSourceLine(ctx, `${info.cppType} ${escapeCppKeyword(varName, platformReservedNames)} = ${defaultInit};`);
    }
    appendSourceLine(ctx, "");
  }

  // Object literal struct definitions (split mode)
  const { program, exprRenderer } = ctx;
  const renderExpression = (expr: any, calleeTransformer?: (callee: string) => string) =>
    exprRenderer.render(expr, calleeTransformer);

  for (const statement of ctx.emittedTopLevelStatements) {
    if (
      effectiveEmitMode === "split" &&
      statement.kind === "var_decl" &&
      statement.initializer?.kind === "object"
    ) {
      const structName = `_${statement.name}_t`;
      const nestedStructs = collectNestedStructDefs(
        statement.initializer, statement.name,
        ctx.globalPointerVarTypes, ctx.knownFunctionReturnTypes,
        ctx.knownTopLevelObjectTypes, ctx.knownTopLevelObjectFields, ctx.largeEnumNames,
      );
      for (const ns of nestedStructs) {
        const nestedFieldDefs = ns.fields
          .map((f) => `${f.type} ${strategy.renameStructField(f.name)};`)
          .join(" ");
        appendHeaderLine(ctx, `struct ${ns.structName} { ${nestedFieldDefs} };`);
      }

      const fieldTypeEntries = statement.initializer.fields.map((field) => {
        const inferred = inferObjectFieldType(
          field.value,
          ctx.globalPointerVarTypes,
          ctx.knownFunctionReturnTypes,
          ctx.knownTopLevelObjectTypes,
          ctx.knownTopLevelObjectFields,
          ctx.largeEnumNames,
          statement.name,
          field.name,
          strategy.defaultNumericType(),
          (o, n) => strategy.resolvePinType?.(o, n),
        );
        return [field.name, inferred] as const;
      });
      const fieldDefs = fieldTypeEntries
        .map(([fieldName, inferredType]) => {
          const safeFieldName = strategy.renameStructField(fieldName);
          return `${inferredType} ${safeFieldName};`;
        })
        .join(" ");
      const initValues = statement.initializer.fields
        .map((field) => {
          const renderExpr = (e: any) => renderExpression(e, ctx.fixPointerFieldAccess);
          const overridden = strategy.objectFieldInitializer(field.value, renderExpr);
          if (overridden !== undefined) return overridden;
          const structInit = strategy.structFieldInitializer(field.value, ctx.compiletimeVarNames, renderExpr);
          if (structInit !== undefined) return structInit;
          return renderExpression(field.value, ctx.fixPointerFieldAccess);
        })
        .join(", ");

      ctx.knownTopLevelObjectTypes.set(statement.name, structName);
      ctx.knownTopLevelObjectFields.set(statement.name, new Map(fieldTypeEntries));

      emitCommentLines(statement.leadingComments, "", (line) => appendHeaderLine(ctx, line));
      appendHeaderLine(ctx, `struct ${structName} { ${fieldDefs} };`);
      appendHeaderLine(ctx, `extern ${structName} ${statement.name};`);
      emitCommentLines(statement.trailingComments, "", (line) => appendHeaderLine(ctx, line));

      emitCommentLines(statement.leadingComments, "", (line) => appendSourceLine(ctx, line));
      appendSourceLine(ctx, `${structName} ${statement.name} = { ${initValues} };`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      emitCommentLines(statement.trailingComments, "", (line) => appendSourceLine(ctx, line));
    }
  }
  if (ctx.emittedTopLevelStatements.some(s => s.kind === "var_decl" && (s as any).initializer?.kind === "object")) {
    appendSourceLine(ctx, "");
  }
}

export function emitCallbackFunctions(ctx: EmitterContext): void {
  const { strategy, effectiveEmitMode, topLevelScope } = ctx;

  // Forward declarations (non-split mode)
  if (effectiveEmitMode !== "split") {
    const excludedNames = new Set(strategy.forwardDeclarationExclusions?.() ?? []);
    for (const callback of ctx.callbackFunctions) {
      appendSourceLine(ctx, `${strategy.isrFunctionAttribute?.() ?? ""}void ${callback.name}();`);
    }
    for (const fn of ctx.mappedFunctions) {
      if (excludedNames.has(fn.name)) continue;
      const fnExported = fn.isExported === true;
      const fnEntrypoint = fn.name === strategy.entrypointFunctionName();
      const fnNeedsStatic = !fnExported && !fnEntrypoint;
      const declarationParameterList = ctx.statementRenderer.renderParameters(fn.parameters, true);
      const fwdLinkagePrefix = fnNeedsStatic ? "static " : "";
      if (fn.typeParameters && fn.typeParameters.length > 0) {
        appendSourceLine(ctx, `template<typename ${fn.typeParameters.join(", typename ")}>`);
      }
      appendSourceLine(ctx, `${fwdLinkagePrefix}${ctx.statementRenderer.mapTypeForEmit(fn.returnType)} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
    }
    if (ctx.callbackFunctions.length > 0 || ctx.mappedFunctions.some((fn) => !new Set(strategy.forwardDeclarationExclusions?.() ?? []).has(fn.name))) {
      appendSourceLine(ctx, "");
    }
  }

  // Emit callback functions
  for (const callback of ctx.callbackFunctions) {
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendSourceLine(ctx, `volatile unsigned long ${callback.name}_lastTime = 0;`);
      appendSourceLine(ctx, `const unsigned long ${callback.name}_debounce = ${callback.debounceMs};`);
      appendSourceLine(ctx, "");
    }
    appendSourceLine(ctx, `${strategy.isrFunctionAttribute?.() ?? ""}void ${callback.name}() {`);
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendSourceLine(ctx, `  volatile unsigned long now = ${strategy.currentTimeMillis()};`);
      appendSourceLine(ctx, `  if (now - ${callback.name}_lastTime < ${callback.name}_debounce) return;`);
      appendSourceLine(ctx, `  ${callback.name}_lastTime = now;`);
    }
    const callbackScope = createChildEmissionScope(topLevelScope);
    for (const stmt of callback.statements) {
      appendRenderedStatement(ctx, stmt, "  ", callbackScope);
    }
    appendSourceLine(ctx, "}");
    appendSourceLine(ctx, "");
  }

  // Split-mode ISR callback forward declarations in header
  if (effectiveEmitMode === "split") {
    for (const callback of ctx.callbackFunctions) {
      appendHeaderLine(ctx, `${strategy.isrFunctionAttribute?.() ?? ""}void ${callback.name}();`);
    }
  }
}

export function emitFunctions(ctx: EmitterContext): void {
  const { strategy, effectiveEmitMode, mappedFunctions, topLevelScope, hasPromiseRuntime, asyncTaskClasses, usesTimers } = ctx;

  // Emit forward declarations for static (non-exported) functions in source file.
  // In non-split mode, this is handled by emitCallbackFunctions. In split mode,
  // we need to do it here because static functions don't go in the header.
  if (effectiveEmitMode === "split") {
    const excludedNames = new Set(strategy.forwardDeclarationExclusions?.() ?? []);
    for (const fn of mappedFunctions) {
      if (excludedNames.has(fn.name)) continue;
      const isExported = fn.isExported === true;
      const isEntrypoint = fn.name === strategy.entrypointFunctionName();
      if (isExported || isEntrypoint) continue;
      const declarationParameterList = ctx.statementRenderer.renderParameters(fn.parameters, true);
      const readonlyPrefix = fn.isReadonlyReturnType ? "const " : "";
      if (fn.typeParameters && fn.typeParameters.length > 0) {
        appendSourceLine(ctx, `template<typename ${fn.typeParameters.join(", typename ")}>`);
      }
      const fnReturnType = fn.isGenerator ? `__tc_Generator<${fn.returnType === "void" ? "void" : ctx.statementRenderer.mapTypeForEmit(fn.returnType)}>` : `${readonlyPrefix}${ctx.statementRenderer.mapTypeForEmit(fn.returnType)}`;
      appendSourceLine(ctx, `static ${fnReturnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
    }
    const hasStaticFns = mappedFunctions.some(fn => {
      const isExp = fn.isExported === true;
      const isEp = fn.name === strategy.entrypointFunctionName();
      return !isExp && !isEp && !new Set(strategy.forwardDeclarationExclusions?.() ?? []).has(fn.name);
    });
    if (hasStaticFns) {
      appendSourceLine(ctx, "");
    }
  }

  for (let fi = 0; fi < mappedFunctions.length; fi++) {
    const fn = mappedFunctions[fi];
    const declarationParameterList = ctx.statementRenderer.renderParameters(fn.parameters, true);
    const definitionParameterList = ctx.statementRenderer.renderParameters(fn.parameters, false);
    const readonlyPrefix = fn.isReadonlyReturnType ? "const " : "";
    const isExported = fn.isExported === true;
    const isEntrypoint = fn.name === strategy.entrypointFunctionName();
    const needsStatic = !isExported && !isEntrypoint;

    if (effectiveEmitMode === "split") {
      if (isExported) {
        emitCommentLines(fn.leadingComments, "", (line) => appendHeaderLine(ctx, line));
        if (fn.typeParameters && fn.typeParameters.length > 0) {
          appendHeaderLine(ctx, `template<typename ${fn.typeParameters.join(", typename ")}>`);
        }
        appendHeaderLine(ctx, `${readonlyPrefix}${ctx.statementRenderer.mapTypeForEmit(fn.returnType)} ${fn.name}(${declarationParameterList});`, {
          tsSpan: fn.sourceSpan,
          nodeKind: "function_declaration",
          symbolName: fn.name,
        });
        emitCommentLines(fn.trailingComments, "", (line) => appendHeaderLine(ctx, line));
      }
    }

    emitCommentLines(fn.leadingComments, "", (line) => appendSourceLine(ctx, line));
    if (fn.typeParameters && fn.typeParameters.length > 0) {
      appendSourceLine(ctx, `template<typename ${fn.typeParameters.join(", typename ")}>`);
    }
    const fnReturnType = fn.isGenerator ? `__tc_Generator<${fn.returnType === "void" ? "void" : ctx.statementRenderer.mapTypeForEmit(fn.returnType)}>` : `${readonlyPrefix}${ctx.statementRenderer.mapTypeForEmit(fn.returnType)}`;
    const linkagePrefix = needsStatic ? "static " : "";
    appendSourceLine(ctx, `${linkagePrefix}${fnReturnType} ${fn.name}(${definitionParameterList})`, {
      tsSpan: fn.sourceSpan,
      nodeKind: "function_definition",
      symbolName: fn.name,
    });
    appendSourceLine(ctx, "{");

    const asyncDriverFn = strategy.asyncDriverFunctionName();
    if (hasPromiseRuntime && fn.name === asyncDriverFn) {
      appendSourceLine(ctx, "  cuttlefish_pump_microtasks();");
    }
    if (fn.isAsync && ctx.hasAsyncRuntime) {
      appendSourceLine(ctx, `  // driven as cooperative task in ${asyncDriverFn}()`);
    } else {
      if (fn.typeParameterConstraints) {
        for (const [param, expr] of fn.typeParameterConstraints) {
          appendSourceLine(ctx, `  static_assert(${expr}, "${param} constraint violated");`);
        }
      }
      const functionScope = createChildEmissionScope(topLevelScope, fn.parameters);
      ctx.cArrayVarNames = ctx.fnCArrayVarNames.get(String(fi)) ?? new Set();

      const isLoopDriver = fn.name === asyncDriverFn;
      const lastStmt = fn.statements.length > 0 ? fn.statements[fn.statements.length - 1] : null;
      const lastIsReturn = lastStmt?.kind === "return";
      const stmtsToEmit = (isLoopDriver && lastIsReturn)
        ? fn.statements.slice(0, -1)
        : fn.statements;

      for (const statement of stmtsToEmit) {
        appendRenderedStatement(ctx, statement, "  ", functionScope);
      }

      if (isLoopDriver && (hasPromiseRuntime || asyncTaskClasses.length > 0 || usesTimers)) {
        const taskNames = asyncTaskClasses.map(t => t.taskVarName);
        const asyncConfig = strategy.getAsyncRuntimeConfig();
        asyncConfig.hasPromiseRuntime = hasPromiseRuntime;
        asyncConfig.hasTimers = usesTimers;
        const injectionLines = strategy.asyncLoopInjection(taskNames, asyncConfig);
        for (const line of injectionLines) {
          appendSourceLine(ctx, `  ${line}`);
        }
      }

      if (isLoopDriver && lastIsReturn) {
        appendRenderedStatement(ctx, lastStmt, "  ", functionScope);
      }
    }
    appendSourceLine(ctx, "}");
    emitCommentLines(fn.trailingComments, "", (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, "");
  }
}

export function emitFunctionForwardDeclarations(_ctx: EmitterContext): void {
  // Placeholder — forward declarations are emitted inline by other functions.
}
