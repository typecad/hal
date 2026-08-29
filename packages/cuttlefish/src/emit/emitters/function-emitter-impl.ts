import { emitCommentLines, isRuntimeExpression, collectNestedStructDefs, inferObjectFieldType } from "../utils/index.js";
import { appendSourceLine, appendHeaderLine, appendRenderedStatement } from "./line-appender.js";
import { createChildEmissionScope } from "../snprintf-helpers.js";
import { escapeCppKeyword } from "../../utils/strings.js";
import type { EmitterContext } from "./emitter-context.js";
import { parsedIsPlainStructType } from "../../api/shared/cpp-type-ir.js";
import { entryHasUI } from "../../ui-hook.js";
import { activeNamespaceNames } from "../../ir/build-ir-state.js";
import { buildCoopSchedInjection, type CoopWorkUnit } from "../../api/shared/coop-scheduler.js";

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

  // Forward declarations for promoted runtime var_decls.
  //
  // A promoted top-level variable (one classified runtime AND referenced by a
  // free function, so it must live at file scope) is forward-declared here and
  // assigned its real initializer inside the entrypoint. The default
  // initializer must be value-initialization (`{}`), which is valid for every
  // C++ type: scalars/pointers zero/null-initialize, class types
  // (std::string, std::vector, std::map, user structs) default-construct.
  // Previously this emitted `= 0` for every non-pointer type, which is invalid
  // for class types (`std::vector<...>` has no implicit conversion from int)
  // and failed at g++ time. Demo #28 Finding B.
  if (ctx.promotedVarDecls.size > 0) {
    for (const [varName, info] of ctx.promotedVarDecls) {
      // A3-9-1: promoted file-scope declarations bypass renderVarDecl, so the
      // int -> fixed-width substitution has to be applied here as well.
      const autosarOn = ctx.compliance.isEnabled() && ctx.compliance.isBanned("A3-9-1");
      const fwdType = autosarOn && info.cppType === "int"
        ? strategy.defaultNumericType(ctx.compliance)
        : normalizeCppTypeForTarget(info.cppType);
      appendSourceLine(ctx, `${fwdType} ${escapeCppKeyword(varName, platformReservedNames)} = {};`);
      // Seed the top-level scope's type map so subsequent assign rendering
      // (e.g. the deferred `c = SafeInt(0)` initializer) can resolve the
      // variable's type and inject template args / casts via
      // renderValueForTarget. Without this, type-aware rendering of promoted
      // vars is unreachable (inferLvalueCppType returns undefined).
      ctx.topLevelScope.knownVariableTypes.set(varName, { cppType: info.cppType });
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
      // When the source annotation names a concrete type (e.g. an exported
      // interface referenced across modules: `const cfg: ThresholdConfig = {...}`),
      // the variable's cppType already is that interface/struct name. The struct
      // itself is declared by the interface declaration, and the extern + cpp
      // definition are emitted by emitTypeDeclarations (via the extern block and
      // appendRenderedStatement respectively). So we must skip synthesizing a
      // local `_name_t` struct here — otherwise we'd emit a second, conflicting
      // struct definition and a duplicate extern/definition.
      const placeholderStructName = `_${statement.name}_t`;
      // Compile-time-only namespace values (e.g. the `ui` handle) emit nothing.
      if (activeNamespaceNames.has(statement.name)) {
        return;
      }
      const declaredCppType = statement.cppType;
      const hasExplicitNamedType =
        !!declaredCppType &&
        declaredCppType !== "auto" &&
        declaredCppType !== placeholderStructName &&
        parsedIsPlainStructType(declaredCppType);

      // Still register the field types so downstream rendering (e.g. string-concat
      // wrapping via interfaceFieldTypes) can resolve property accesses on the var.
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
          strategy.defaultNumericType(ctx.compliance.isEnabled() ? ctx.compliance : undefined),
          (o, n) => strategy.resolvePinType?.(o, n),
        );
        return [field.name, inferred] as const;
      });
      if (hasExplicitNamedType) {
        const namedType = declaredCppType!;
        ctx.knownTopLevelObjectTypes.set(statement.name, namedType);
        ctx.knownTopLevelObjectFields.set(statement.name, new Map(fieldTypeEntries));
        continue;
      }

      const structName = placeholderStructName;
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

  // NOTE: forward declarations for callbacks and free functions are now emitted
  // BEFORE class bodies by emitFunctionForwardDeclarations (cpp-emitter step
  // 6.5). This function emits only the callback DEFINITIONS (plus split-mode
  // header prototypes, which belong with the public API).

  // Emit callback functions
  for (const callback of ctx.callbackFunctions) {
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendSourceLine(ctx, `volatile unsigned long ${callback.name}_lastTime = 0;`);
      appendSourceLine(ctx, `const unsigned long ${callback.name}_debounce = ${callback.debounceMs};`);
      appendSourceLine(ctx, "");
    }
    // IRAM_ATTR only on true ISR definitions. ESP-IDF's IRAM_ATTR uses
    // __COUNTER__, so putting it on both forward decl and definition assigns
    // conflicting .iram1.N sections (-Werror=attributes). Non-ISR callbacks
    // (WiFi events, timers) must not be IRAM-placed either — they call printf.
    const isrAttr = callback.isInterruptHandler ? (strategy.isrFunctionAttribute?.() ?? "") : "";
    appendSourceLine(ctx, `${isrAttr}${renderCallbackSignature(callback)} {`);
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendSourceLine(ctx, `  volatile unsigned long now = ${strategy.currentTimeMillis()};`);
      appendSourceLine(ctx, `  if (now - ${callback.name}_lastTime < ${callback.name}_debounce) return;`);
      appendSourceLine(ctx, `  ${callback.name}_lastTime = now;`);
    }
    const callbackScope = createChildEmissionScope(topLevelScope, callback.typedParams);
    for (const stmt of callback.statements) {
      appendRenderedStatement(ctx, stmt, "  ", callbackScope);
    }
    appendSourceLine(ctx, "}");
    appendSourceLine(ctx, "");
  }

  // Split-mode ISR callback forward declarations in header (no IRAM_ATTR —
  // attribute belongs on the definition only; see comment above).
  if (effectiveEmitMode === "split") {
    for (const callback of ctx.callbackFunctions) {
      appendHeaderLine(ctx, `${renderCallbackSignature(callback)};`);
    }
  }
}

/**
 * Render the C++ signature of a synthesized callback (ISR) free function.
 *
 * Historically every hoisted callback emitted as `void name()` — fine for
 * parameter-less ISRs (the `onFalling(() => {...})` case) but wrong for a
 * typed lambda passed as a `std::function<R(args)>` argument, where the
 * function must carry the same return type and parameter list. We fall back
 * to the historical `void name()` shape when the callback carries no
 * returnType/typedParams (the common ISR path that populates neither).
 */
function renderCallbackSignature(callback: { name: string; returnType?: string; typedParams?: { name: string; cppType: string }[] }): string {
  const ret = callback.returnType && callback.returnType !== "void" ? callback.returnType : "void";
  const params = (callback.typedParams ?? []).map(p => `${p.cppType} ${p.name}`).join(", ");
  return `${ret} ${callback.name}(${params})`;
}

export function emitFunctions(ctx: EmitterContext): void {
  const { strategy, effectiveEmitMode, mappedFunctions, topLevelScope, hasPromiseRuntime, asyncTaskClasses, usesTimers } = ctx;

  // NOTE: source-level forward declarations (non-split free fns + split-mode
  // static fns) are now emitted BEFORE class bodies by
  // emitFunctionForwardDeclarations (cpp-emitter step 6.5). This function
  // emits function DEFINITIONS and the split-mode header prototypes for
  // exported functions (which ride along with their definition below).

  for (let fi = 0; fi < mappedFunctions.length; fi++) {
    const fn = mappedFunctions[fi];
    // Async functions become cooperative *Task state machines (emitAsyncTaskClasses).
    // Emitting an empty stub here triggers -Wunused-function with no value.
    if (fn.isAsync && ctx.hasAsyncRuntime) continue;

    const declarationParameterList = ctx.statementRenderer.renderParameters(fn.parameters, true);
    const definitionParameterList = ctx.statementRenderer.renderParameters(fn.parameters, false);
    const readonlyPrefix = fn.isReadonlyReturnType ? "const " : "";
    const isExported = fn.isExported === true;
    // A function is an entrypoint if it is the strategy's primary entrypoint
    // (e.g. `setup` on Arduino, `main` on native) OR one of the platform's
    // reserved entrypoint names the strategy excludes from forward declarations
    // (e.g. `loop` on Arduino, whose `void loop(void)` is forward-declared
    // extern by the Arduino core — emitting `static void loop()` redeclares it
    // with conflicting linkage, which ESP32's GCC rejects; see
    // arduino-loop-linkage.test.ts). Treating these as entrypoints drops the
    // `static` qualifier, matching how `setup`/`main` already emit.
    const platformEntrypoints = strategy.forwardDeclarationExclusions?.() ?? [];
    const isEntrypoint =
      fn.name === strategy.entrypointFunctionName() ||
      platformEntrypoints.includes(fn.name);
    // Demo #18 Finding B: a non-exported free function that is CALLED from a
    // class method body must be visible in the header (inline method bodies
    // live there in split mode) and defined non-static in the .cpp (a `static`
    // definition would clash with the header's extern prototype). The header
    // prototype is emitted in emitFunctionForwardDeclarations (which runs
    // before classes); here we only drop the `static` from the definition.
    const calledFromClassMethod = ctx.freeFunctionsCalledFromClassMethods.has(fn.name);
    const needsStatic = !isExported && !isEntrypoint && !calledFromClassMethod;

    if (effectiveEmitMode === "split") {
      if (isExported) {
        emitCommentLines(fn.leadingComments, "", (line) => appendHeaderLine(ctx, line));
        if (fn.typeParameters && fn.typeParameters.length > 0) {
          appendHeaderLine(ctx, `template<typename ${fn.typeParameters.join(", typename ")}>`);
        }
        appendHeaderLine(ctx, `${readonlyPrefix}${ctx.statementRenderer.mapReturnTypeForEmit(fn.name, fn.returnType)} ${fn.name}(${declarationParameterList});`, {
          tsSpan: fn.sourceSpan,
          nodeKind: "function_declaration",
          symbolName: fn.name,
        });
        emitCommentLines(fn.trailingComments, "", (line) => appendHeaderLine(ctx, line));
      }
    }

    // Generic (templated) functions must be DEFINED in the header — a C++
    // template definition in a .cpp is not visible to other translation
    // units, producing `undefined reference` at link time. So for an exported
    // generic function in split mode we route the full definition (template
    // line + signature + body) into the header. We use the same buffer-swap
    // trick the class emitter uses (class-emitter.ts:13-18), so that
    // appendSourceLine / appendRenderedStatement (which are hardwired to the
    // source buffer) write to the header while the swap is active. Non-generic
    // exported functions keep their historical decl-in-.h / def-in-.cpp split.
    const isExportedGeneric =
      effectiveEmitMode === "split" &&
      isExported &&
      !!fn.typeParameters && fn.typeParameters.length > 0 &&
      !fn.isAsync; // async functions are driven via task classes, not templates

    if (isExportedGeneric) {
      const _swapLines = ctx.sourceLines;
      ctx.sourceLines = ctx.headerLines;
      ctx.headerLines = _swapLines;
      const _swapMaps = ctx.sourceMapEntries;
      ctx.sourceMapEntries = ctx.headerMapEntries;
      ctx.headerMapEntries = _swapMaps;
    }

    // Cooperative scheduler trampolines (Phase 0).
    //
    // When the strategy opts into priority/time-budget scheduling, the driver
    // function's per-frame pumps are routed through the no-STL CoopSched. The
    // trampolines (file-scope `static void __tc_coop_*(void*)`) must appear
    // before the driver function definition so CoopSched can call them; they
    // reference only global/static names (task instances, pump functions) so
    // no captures are needed. Emitted once, ahead of the driver only.
    const asyncDriverFnForTrampolines = strategy.asyncDriverFunctionName();
    if (
      fn.name === asyncDriverFnForTrampolines &&
      (hasPromiseRuntime || asyncTaskClasses.length > 0 || usesTimers)
    ) {
      const coopConfig = strategy.getAsyncRuntimeConfig();
      if (coopConfig.enablePriority || coopConfig.enableTimeBudget) {
        const coopUnits = buildDriverCoopUnits(
          asyncTaskClasses.map(t => t.taskVarName),
          hasPromiseRuntime,
          usesTimers,
        );
        if (coopUnits.length > 0) {
          const { trampolines } = buildCoopSchedInjection(coopUnits);
          appendSourceLine(ctx, "// ── CoopSched trampolines (priority/time-budget scheduling) ──");
          for (const t of trampolines) appendSourceLine(ctx, t);
          appendSourceLine(ctx, "");
        }
      }
    }

    emitCommentLines(fn.leadingComments, "", (line) => appendSourceLine(ctx, line));
    if (fn.typeParameters && fn.typeParameters.length > 0) {
      appendSourceLine(ctx, `template<typename ${fn.typeParameters.join(", typename ")}>`);
    }
    const fnReturnType = fn.isGenerator ? `__tc_Generator<${fn.returnType === "void" ? "void" : ctx.statementRenderer.mapReturnTypeForEmit(fn.name, fn.returnType)}>` : `${readonlyPrefix}${ctx.statementRenderer.mapReturnTypeForEmit(fn.name, fn.returnType)}`;
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

    // Drive the UI runtime each frame. Fires only in the driver function when
    // a UI is mounted (entryHasUI). Uses a separate gate from the async pump
    // so a pure-UI program (no async/timers) still animates. When the strategy
    // provides hostEventLoop, the per-frame work — ui_tick AND the async-task
    // injections below — runs inside a while loop so a driver that is called
    // once (a main() entrypoint: SDL native, Zephyr's scheduler loop) can pump
    // events, tick the UI, and advance async tasks every frame. (A repeatedly-
    // called driver like Arduino's loop() provides no hostEventLoop and the
    // work stays flat.) Emitted AFTER the function's init statements
    // (ui_init/display_init/touch_init) so initialization precedes the loop.
    const hostLoop = entryHasUI() && fn.name === asyncDriverFn
      ? strategy.hostEventLoop?.()
      : undefined;
    if (hostLoop) {
      appendSourceLine(ctx, `  bool ${hostLoop.flagName} = true;`);
      appendSourceLine(ctx, `  while (${hostLoop.continueCondition}) {`);
      if (hostLoop.preIteration) {
        appendSourceLine(ctx, `    ${hostLoop.preIteration}`);
      }
    }
    if (entryHasUI() && fn.name === asyncDriverFn) {
      appendSourceLine(ctx, `  uint32_t __tc_ui_now = static_cast<uint32_t>(${strategy.currentTimeMillis()});`);
      appendSourceLine(ctx, "  static uint32_t __tc_ui_last_tick = __tc_ui_now;");
      appendSourceLine(ctx, "  uint32_t __tc_ui_delta = __tc_ui_now - __tc_ui_last_tick;");
      appendSourceLine(ctx, "  __tc_ui_last_tick = __tc_ui_now;");
      appendSourceLine(ctx, "  if (__tc_ui_delta > 250) __tc_ui_delta = 250;");
      appendSourceLine(ctx, "  ui_tick(static_cast<uint16_t>(__tc_ui_delta));");
    }

    if (isLoopDriver && (hasPromiseRuntime || asyncTaskClasses.length > 0 || usesTimers)) {
      const taskNames = asyncTaskClasses.map(t => t.taskVarName);
      const asyncConfig = strategy.getAsyncRuntimeConfig();
      asyncConfig.hasPromiseRuntime = hasPromiseRuntime;
      asyncConfig.hasTimers = usesTimers;
      const injectionIndent = hostLoop ? "    " : "  ";

      // Cooperative scheduler path (Phase 0): when opted in, replace the flat
      // per-frame pump sequence with a single CoopSched dispatch. The work
      // units mirror exactly what a strategy's asyncLoopInjection() would
      // have emitted (so Zephyr, which omits the microtask pump, still omits
      // it), but they are dispatched in priority order and budget-bounded.
      if (asyncConfig.enablePriority || asyncConfig.enableTimeBudget) {
        const coopUnits = buildDriverCoopUnits(taskNames, hasPromiseRuntime, usesTimers);
        if (coopUnits.length > 0) {
          const { injection } = buildCoopSchedInjection(coopUnits);
          for (const line of injection) appendSourceLine(ctx, line);
        } else {
          // No work units: fall back to the strategy's own injection.
          const injectionLines = strategy.asyncLoopInjection(taskNames, asyncConfig);
          for (const line of injectionLines) appendSourceLine(ctx, `${injectionIndent}${line}`);
        }
      } else {
        const injectionLines = strategy.asyncLoopInjection(taskNames, asyncConfig);
        for (const line of injectionLines) {
          appendSourceLine(ctx, `${injectionIndent}${line}`);
        }
      }
    }

    if (hostLoop) {
      if (hostLoop.postIteration) {
        appendSourceLine(ctx, `    ${hostLoop.postIteration}`);
      }
      appendSourceLine(ctx, "  }");
    }

    if (isLoopDriver && lastIsReturn) {
      appendRenderedStatement(ctx, lastStmt, "  ", functionScope);
    }
    appendSourceLine(ctx, "}");
    emitCommentLines(fn.trailingComments, "", (line) => appendSourceLine(ctx, line));
    appendSourceLine(ctx, "");

    // Restore the buffer swap we applied for exported generic functions (see
    // isExportedGeneric above). After this point sourceLines/headerLines are
    // back to their normal roles for the next function in the loop.
    if (isExportedGeneric) {
      const _swapLines = ctx.sourceLines;
      ctx.sourceLines = ctx.headerLines;
      ctx.headerLines = _swapLines;
      const _swapMaps = ctx.sourceMapEntries;
      ctx.sourceMapEntries = ctx.headerMapEntries;
      ctx.headerMapEntries = _swapMaps;
    }
  }
}

/**
 * Emit forward declarations for ALL free functions (and ISR callbacks) BEFORE
 * class bodies. A class method may call a free function declared later in the
 * same source file; if that function's forward declaration only appears after
 * the class (as it did historically via emitCallbackFunctions/emitFunctions),
 * g++ reports "'fn' was not declared in this scope" inside the class body.
 *
 * This runs at cpp-emitter.ts step 6.5, ahead of emitClasses (step 7). The
 * definition-only emission in emitCallbackFunctions/emitFunctions below no
 * longer re-emits these declarations (they are dropped there to avoid
 * duplicates). Template/generic functions get template prototypes here so
 * earlier functions can call them before their definitions later in the same
 * translation unit.
 */
export function emitFunctionForwardDeclarations(ctx: EmitterContext): void {
  const { strategy, effectiveEmitMode } = ctx;
  const excludedNames = new Set(strategy.forwardDeclarationExclusions?.() ?? []);

  // Async-method starters: the owning class's method body calls these before
  // the task class (and this definition) exists later in the TU. The class
  // forward declarations emitted nearby make the <Class>* parameter valid.
  for (const starter of ctx.asyncMethodStarters ?? []) {
    appendSourceLine(ctx, starter.proto);
  }

  // Callback forward declarations (no IRAM_ATTR — ESP-IDF's attribute uses
  // __COUNTER__, so decl+def would get conflicting .iram1.N sections).
  if (effectiveEmitMode !== "split") {
    for (const callback of ctx.callbackFunctions) {
      appendSourceLine(ctx, `${renderCallbackSignature(callback)};`);
    }
  }

  let emittedAnyFn = false;
  for (const fn of ctx.mappedFunctions) {
    if (excludedNames.has(fn.name)) continue;
    // Async functions become *Task classes; calls lower to `fooTask.run()`.
    // Forward-declaring empty stubs triggers -Wunused-function.
    if (fn.isAsync && ctx.hasAsyncRuntime) continue;
    const isExported = fn.isExported === true;
    // A function is an entrypoint if it is the strategy's primary entrypoint
    // (e.g. `setup` on Arduino, `main` on native) OR one of the platform's
    // reserved entrypoint names the strategy excludes from forward declarations
    // (e.g. `loop` on Arduino, whose `void loop(void)` is forward-declared
    // extern by the Arduino core — emitting `static void loop()` redeclares it
    // with conflicting linkage, which ESP32's GCC rejects; see
    // arduino-loop-linkage.test.ts). Treating these as entrypoints drops the
    // `static` qualifier, matching how `setup`/`main` already emit.
    const platformEntrypoints = strategy.forwardDeclarationExclusions?.() ?? [];
    const isEntrypoint =
      fn.name === strategy.entrypointFunctionName() ||
      platformEntrypoints.includes(fn.name);
    // Demo #18 Finding B: a free function called from a class method body is
    // forward-declared in the HEADER (like an exported function) — this step
    // runs BEFORE emitClasses, so the prototype precedes the class body that
    // references it. It must NOT also get a `static` source-level forward decl.
    const calledFromClassMethod = ctx.freeFunctionsCalledFromClassMethods.has(fn.name);

    // Exported functions and class-method-called free functions are forward-
    // declared in the HEADER (above). Only static (non-exported) functions
    // that are NOT called from a class method need a source-level forward decl.
    if (effectiveEmitMode === "split" && calledFromClassMethod) {
      const declarationParameterList = ctx.statementRenderer.renderParameters(fn.parameters, true);
      const readonlyPrefix = fn.isReadonlyReturnType ? "const " : "";
      const fnReturnType = fn.isGenerator
        ? `__tc_Generator<${fn.returnType === "void" ? "void" : ctx.statementRenderer.mapTypeForEmit(fn.returnType)}>`
        : `${readonlyPrefix}${ctx.statementRenderer.mapReturnTypeForEmit(fn.name, fn.returnType)}`;
      if (fn.typeParameters && fn.typeParameters.length > 0) {
        const typeParams = fn.typeParameters.join(", typename ");
        appendHeaderLine(ctx, `template<typename ${typeParams}>`);
      }
      appendHeaderLine(ctx, `${fnReturnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
      emittedAnyFn = true;
      continue;
    }
    if (effectiveEmitMode === "split" && (isExported || isEntrypoint)) continue;

    const declarationParameterList = ctx.statementRenderer.renderParameters(fn.parameters, true);
    const readonlyPrefix = fn.isReadonlyReturnType ? "const " : "";
    const fnReturnType = fn.isGenerator
      ? `__tc_Generator<${fn.returnType === "void" ? "void" : ctx.statementRenderer.mapTypeForEmit(fn.returnType)}>`
      : `${readonlyPrefix}${ctx.statementRenderer.mapReturnTypeForEmit(fn.name, fn.returnType)}`;

    if (fn.typeParameters && fn.typeParameters.length > 0) {
      const fnNeedsStatic = !isExported && !isEntrypoint;
      const typeParams = fn.typeParameters.join(", typename ");
      appendSourceLine(ctx, `template<typename ${typeParams}>`);
      appendSourceLine(ctx, `${fnNeedsStatic ? "static " : ""}${fnReturnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
      emittedAnyFn = true;
      continue;
    }

    if (effectiveEmitMode === "split") {
      appendSourceLine(ctx, `static ${fnReturnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
    } else {
      const fnNeedsStatic = !isExported && !isEntrypoint;
      appendSourceLine(ctx, `${fnNeedsStatic ? "static " : ""}${fnReturnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
    }
    emittedAnyFn = true;
  }

  if (ctx.callbackFunctions.length > 0 || emittedAnyFn) {
    appendSourceLine(ctx, "");
  }
}

/**
 * Build the CoopSched work units for the driver function's per-frame pumps.
 *
 * The units mirror what a strategy's asyncLoopInjection() emits as a flat
 * sequence, so the cooperative scheduler preserves each strategy's decisions
 * about WHICH pumps run (e.g. Zephyr omits the std::function microtask pump
 * because its async path is state-machine-based). Default priorities:
 *   - async task .run()        → priority 1 (latency-sensitive: drives awaits)
 *   - microtask pump           → priority 1 (continuations of resolved promises)
 *   - cooperative timer pump   → priority 0 (less latency-critical)
 * Both are tunable via AsyncRuntimeConfig.schedulerPriorities; the scheduler
 * bucket-walks from the highest level down to 0.
 */
function buildDriverCoopUnits(
  taskVarNames: string[],
  hasPromiseRuntime: boolean,
  hasTimers: boolean,
): CoopWorkUnit[] {
  const units: CoopWorkUnit[] = [];
  let taskIdx = 0;
  for (const name of taskVarNames) {
    units.push({
      name: `task_${taskIdx++}`,
      body: `${name}.run();`,
      priority: 1,
    });
  }
  if (hasPromiseRuntime) {
    units.push({
      name: "microtasks",
      body: "cuttlefish_pump_microtasks();",
      priority: 1,
    });
  }
  if (hasTimers) {
    units.push({
      name: "timers",
      body: "__tc_timer_runtime.run();",
      priority: 0,
    });
  }
  return units;
}
