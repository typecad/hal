import path from "node:path";
import type { ProgramIR, StatementIR } from "../../api/index.js";
import { filterPolyfillHelpers, isStringEnum } from "../../api/shared/index.js";
import { hasSafetyHook, requireSafetyHook } from "../../safety-hook.js";
import { isSafetyImportSpecifier } from "../../safety/specifiers.js";
import { analyzeProgram } from "../../ir/program-analysis.js";
import { collectStatementIdentifiers } from "../../ir/identifier-collector.js";
import { Diagnostic, EmitMode, SourceMapEntry } from "../../types.js";
import { ensureDir } from "../../utils/fs.js";
import { resolveImport } from "../../libdef/registry.js";
import { isRegisteredCuttlefishLibrary } from "../../library-packages.js";
import { emitPolyfillBoilerplate } from "../native-helpers-emitter.js";
import { ResolvedNpmPackage } from "../../transpile/resolution.js";
import { resolveStrategy } from "../../platform/registry.js";
import { buildCoopSchedulerPolyfill } from "../../platform/coop-scheduler-runtime.js";
import { getLoadedFramework } from "../../framework-registry.js";
import { entryHasUI } from "../../ui-hook.js";
import { ComplianceContext } from "../compliance/compliance-context.js";
import {
  createEmissionScopeState,
  statementNeedsSnprintf,
} from "../snprintf-helpers.js";
import { ExpressionRenderer } from "../expression-renderer.js";
import { StatementRenderer } from "../statement-renderer.js";
import {
  isCuttlefishSDKImport,
  emitCommentLines,
  normalizeInclude,
  dedupe,
  applySymbolMap,
  generateAsyncTaskClass,
  resolveTranspiledModuleInclude,
} from "../utils/index.js";
import type {
  EmitterContext,
  EmitterOptions,
  MappedFunction,
  AsyncTaskClass,
} from "./emitter-context.js";

function resolveTemplateReturnType(
  returnType: string,
  typeParameters: string[] | undefined,
): string {
  if (!typeParameters || typeParameters.length === 0) return returnType;
  return returnType;
}

function filterShimBlock(lines: string[], startMarker: string, endMarker: string): string[] {
  const startIdx = lines.findIndex(l => l.includes(startMarker));
  if (startIdx === -1) return lines;
  const endIdx = lines.findIndex((l, i) => i >= startIdx && l.includes(endMarker));
  if (endIdx === -1) return lines;
  const filtered = lines.slice();
  filtered.splice(startIdx, endIdx - startIdx + 1);
  while (filtered.length > 0 && filtered[startIdx] === '') {
    filtered.splice(startIdx, 1);
  }
  return filtered;
}

/**
 * Detect whether a program uses the watchdog timer. The HAL resolver lowers
 * `WDT.enable/reset/disable` calls to structured `wdt.*` hal-ops, which the
 * setup emitter then renders as bare `wdt_enable/wdt_reset/wdt_disable` calls
 * (or constant-folded `wdt_enable(WDTO_*)` macros). All of those require
 * `<avr/wdt.h>`, so the include is gated on this check instead of being forced
 * into every AVR program.
 *
 * `programAnalysis.usesWDT` is NOT used here: it scans `WDT.`-prefixed
 * callees and raw-code hal-ops, but the structured `wdt.*` ops carry a typed
 * operation name with no raw code, so the analysis misses them.
 *
 * The recursion mirrors `collectStatementIdentifiers` (identifier-collector.ts)
 * — the canonical IR walker — so every compound statement shape is covered.
 */
function programUsesWdt(program: ProgramIR): boolean {
  const visitStatement = (stmt: StatementIR): boolean => {
    if (stmt.kind === "hal-op") {
      const opName = (stmt as any).operation?.operation;
      if (typeof opName === "string" && opName.startsWith("wdt.")) return true;
    }
    switch (stmt.kind) {
      case "block":
      case "labeled":
        return visit(stmt.body);
      case "if":
        return visit(stmt.thenBranch) || visit(stmt.elseBranch ?? []);
      case "for":
        return visit(stmt.body)
          || (stmt.initializer ? visitStatement(stmt.initializer) : false);
      case "while":
      case "do_while":
      case "for_of":
      case "for_in":
        return visit(stmt.body);
      case "switch":
        return stmt.cases.some((c: any) => visit(c.body ?? []));
      case "try":
        return visit(stmt.tryBlock) || visit(stmt.catchBlock ?? []) || visit(stmt.finallyBlock ?? []);
      default:
        return false;
    }
  };
  const visit = (statements: StatementIR[] | undefined): boolean => {
    if (!statements) return false;
    for (const stmt of statements) {
      if (visitStatement(stmt)) return true;
    }
    return false;
  };
  if (visit(program.topLevelStatements)) return true;
  for (const fn of program.functions ?? []) {
    if (visit(fn.statements)) return true;
  }
  for (const cls of program.classes ?? []) {
    for (const m of cls.methods ?? []) if (visit(m.statements)) return true;
    for (const g of cls.getters ?? []) if (visit(g.statements)) return true;
    for (const s of cls.setters ?? []) if (visit(s.statements)) return true;
    if (cls.constructor && visit(cls.constructor.statements)) return true;
  }
  return false;
}

/**
 * Detect whether a program uses @typecad/safety. The safety transform pass
 * injects safety.* ops when in use; strategies consult this to decide
 * whether to emit the __tc_gpio_read shim that the safety voter calls.
 * Mirrors programUsesWdt() above (same inline walker pattern).
 *
 * `hal-expr` (the expression-position safety.read_safe lowering produced
 * by `const r = safe.read(pin)`) lives in expression trees, not at statement
 * level — but it's carried inside a var_decl statement whose initializer is
 * the hal-expr, and the var_decl gets visited as a top-level statement. We
 * detect both: statement-level `hal-op` operations, and any statement whose
 * rendered initializer text mentions safety.* (a defensive catch for the
 * hal-expr-in-initializer case). The latter is rarely needed because the
 * voter's read_safe op is also captured at the call site, but kept for
 * robustness.
 */
export function programUsesSafety(program: ProgramIR): boolean {
  // Defensive: some test fixtures and partial-program callers pass a minimal
  // object (e.g. `{} as any`). Treat a missing iterable field as "no safety
  // ops" rather than crashing — matches how the existing ArduinoStrategy path
  // behaves when given a partial program.
  if (!program) return false;
  const visitStatement = (stmt: StatementIR): boolean => {
    if (stmt.kind === "hal-op") {
      const opName = (stmt as any).operation?.operation;
      if (typeof opName === "string" && opName.startsWith("safety.")) return true;
    }
    switch (stmt.kind) {
      case "block":
      case "labeled":
        return visit(stmt.body);
      case "if":
        return visit(stmt.thenBranch) || visit(stmt.elseBranch ?? []);
      case "for":
        return visit(stmt.body)
          || (stmt.initializer ? visitStatement(stmt.initializer) : false);
      case "while":
      case "do_while":
      case "for_of":
      case "for_in":
        return visit(stmt.body);
      case "switch":
        return stmt.cases.some((c: any) => visit(c.body ?? []));
      case "try":
        return visit(stmt.tryBlock) || visit(stmt.catchBlock ?? []) || visit(stmt.finallyBlock ?? []);
      default:
        return false;
    }
  };
  const visit = (statements: StatementIR[] | undefined): boolean => {
    if (!statements) return false;
    for (const stmt of statements) {
      if (visitStatement(stmt)) return true;
    }
    return false;
  };
  if (visit(program.topLevelStatements)) return true;
  for (const fn of program.functions ?? []) {
    if (visit(fn.statements)) return true;
  }
  for (const cls of program.classes ?? []) {
    for (const m of cls.methods ?? []) if (visit(m.statements)) return true;
    for (const g of cls.getters ?? []) if (visit(g.statements)) return true;
    for (const s of cls.setters ?? []) if (visit(s.statements)) return true;
    if (cls.constructor && visit(cls.constructor.statements)) return true;
  }
  // SafeInt<T> / SafeVariable<T> usage does not produce safety.* hal-ops
  // (they are plain C++ template types), so the op-walk above misses them.
  // Detect via the var_decl cppType: any declaration whose type starts with
  // "SafeInt" or "SafeVariable" needs the corresponding polyfill to ship.
  const usesSafeWrapperType = (statements: StatementIR[] | undefined): boolean => {
    if (!statements) return false;
    for (const stmt of statements) {
      if (stmt.kind === "var_decl") {
        const cppType = (stmt as any).cppType as string | undefined;
        if (typeof cppType === "string" && (cppType.startsWith("SafeInt") || cppType.startsWith("SafeVariable"))) {
          return true;
        }
      }
    }
    return false;
  };
  if (usesSafeWrapperType(program.topLevelStatements)) return true;
  for (const fn of program.functions ?? []) {
    if (usesSafeWrapperType(fn.statements)) return true;
  }
  return false;
}
function extractShimMacro(lines: string[], macroName: string): string[] {
  const ifndefIdx = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed.startsWith('#ifndef') && trimmed.endsWith(macroName);
  });
  if (ifndefIdx === -1) return [];
  // Find the matching #endif that closes this guard.
  let depth = 1;
  let endIdx = -1;
  for (let i = ifndefIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#ifndef') || trimmed.startsWith('#ifdef')) depth++;
    else if (trimmed.startsWith('#endif')) {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) return [];
  return lines.slice(ifndefIdx, endIdx + 1);
}

export function buildEmitterContext(
  program: ProgramIR,
  options: EmitterOptions,
): EmitterContext {
  // Framework strategies that resolve per-program chip data (Zephyr's chip
  // view reconstructs from the generated manifest) must do it before any
  // body rendering — hal-op lowering reads their cached descriptor.
  (options.strategy as { prepareChip?: (p: ProgramIR, c: unknown) => void } | undefined)
    ?.prepareChip?.(program, options.platformContext);
  const largeEnumNames = new Set<string>();
  const enumNames = new Set<string>();
  const stringEnumNames = new Set<string>();
  for (const e of program.enums) {
    enumNames.add(e.name);
    if (isStringEnum(e)) {
      stringEnumNames.add(e.name);
    }
    if (e.members.some(m => typeof m.value === "number" && (m.value > 32767 || m.value < -32768))) {
      largeEnumNames.add(e.name);
    }
  }
  const namespaceNames = new Set<string>();
  for (const ns of program.namespaces) {
    namespaceNames.add(ns.name);
    for (const e of ns.enums) {
      enumNames.add(e.name);
      if (isStringEnum(e)) {
        stringEnumNames.add(e.name);
      }
      if (e.members.some(m => typeof m.value === "number" && (m.value > 32767 || m.value < -32768))) {
        largeEnumNames.add(e.name);
      }
    }
  }
  if (options.crossModuleEnumNames) {
    for (const name of options.crossModuleEnumNames) {
      enumNames.add(name);
    }
  }
  if (options.crossModuleStringEnumNames) {
    for (const name of options.crossModuleStringEnumNames) {
      stringEnumNames.add(name);
    }
  }
  // When @typecad/safety is active, register its enum names so the expression
  // renderer uses :: (C++ enum-class scope resolution) instead of . (TS dot
  // access) for member access like SafetyFaultCategory.Configuration. The
  // graph-builder skips @typecad/safety (its source isn't parsed), so these
  // enum names never enter program.enums — we register them manually here.
  if (hasSafetyHook()) {
    enumNames.add("SafetyFaultCategory");
    enumNames.add("SafetyFaultCode");
    enumNames.add("SafetyStatus");
  }

  const strategy = options.strategy ?? resolveStrategy(options.target ?? "generic");
  strategy.setLargeEnumNames?.(largeEnumNames);
  // When @typecad/safety is active, `safe` is a compile-time-only construct
  // (its methods are intercepted at IR-build time). Its top-level var_decl
  // (from the parsed safety module source) must NOT be emitted as a C++
  // _safe_t struct — add it to reservedNames so the top-level-prep filter
  // strips it. Mirrors how platform reserved names (HIGH, LOW, etc.) are
  // kept out of user-code emission.
  let reservedNames: Set<string> = new Set(strategy.reservedNames());
  if (hasSafetyHook()) {
    reservedNames = new Set(reservedNames);
    reservedNames.add("safe");
  }

  ensureDir(options.outDir);

  const classNameMap = (() => {
    try {
      const framework = getLoadedFramework();
      if (framework.classNameMapBuilder) {
        return framework.classNameMapBuilder(program.imports);
      }
    } catch {
      // No loaded framework
    }
    return undefined;
  })();

  const programAnalysis = analyzeProgram(program, strategy);

  if (options.platformContext) {
    options.platformContext.analysis = programAnalysis;
    if (!options.platformContext.architecture && program.boardConstants) {
      options.platformContext.architecture = program.boardConstants.get("architecture") as string;
    }
  }

  const originalBaseName = path.basename(program.fileName).replace(/\.[^.]+$/, "");
  const outDirBaseName = path.basename(path.resolve(options.outDir));
  const baseName = options.npmPackage?.moduleKey
    || strategy.overrideBaseName(originalBaseName, outDirBaseName, options.isEntryFile ?? true, !!options.npmPackage);

  const isNpmPackage = !!options.npmPackage;
  const isEntryFile = options.isEntryFile !== false;
  const isrPrefix = isEntryFile ? 'main' : originalBaseName;
  const effectiveEmitMode: EmitMode = strategy.effectiveEmitMode(options.emitMode, isNpmPackage) as EmitMode;

  const includes: string[] = [];
  const symbolMap: Record<string, string> = {};
  let profileDiagnostics: Diagnostic[] = [];
  // Shared sink for emit-time diagnostics (HAL warnings, etc.). Passed by
  // reference to the renderers and merged into the final diagnostics list by
  // finalizeOutput.
  const emitDiagnostics: Diagnostic[] = [];
  let shimLines: string[] = [];

  const isEntryFileForPolyfills = isEntryFile;
  const nativePolyfills = isEntryFileForPolyfills
    ? (strategy.generateNativePolyfills?.(program, options.platformContext) ?? [])
    : (strategy.generateNativePolyfills?.(program, options.platformContext) ?? []);

  let filteredNativePolyfills = filterPolyfillHelpers(nativePolyfills, programAnalysis.usedPolyfillHelpers);
  // cuttlefish_halt: keep when the program throws (throw lowers to cuttlefish_halt)
  // OR explicitly calls cuttlefish_halt in lowered raw text.
  if (!programAnalysis.hasThrowStatements && !programAnalysis.usesHalt) {
    filteredNativePolyfills = filteredNativePolyfills.filter(p => p.id !== "cuttlefish_halt");
  }
  // static_array: the __tc_StaticArray struct has no __tc_*() call pattern, so
  // filterPolyfillHelpers' per-function tree-shaker can't drop it (it sees no
  // extractable name). Gate at the polyfill-id level instead: keep only when
  // __tc_StaticArray genuinely appears in used code.
  if (!programAnalysis.usedPolyfillHelpers.has('__tc_StaticArray')) {
    filteredNativePolyfills = filteredNativePolyfills.filter(p => p.id !== "static_array");
  }

  // Safety polyfills (mode table + voter + SafeVariable + SafeInt). Gated on
  // programUsesSafety(program) so they ONLY appear when the program actually
  // references a safety construct — emitting them unconditionally (just because
  // @typecad/safety is installed and registered its hook) leaks ~200 lines of
  // polyfill into every program, and SafeInt's `return *this` chaining methods
  // tripped byte-identity / lowering assertions that expect no `this` token.
  // programUsesSafety walks the IR for any safety.* hal-op.
  if (isEntryFile && hasSafetyHook() && programUsesSafety(program)) {
    const safetyPolyfills = filterPolyfillHelpers(
      requireSafetyHook().buildPolyfills?.() ?? [],
      programAnalysis.usedPolyfillHelpers,
    );
    filteredNativePolyfills = [...filteredNativePolyfills, ...safetyPolyfills];
  }

  // Cooperative scheduler polyfill (Phase 0). Injected centrally when the
  // strategy opts into priority/time-budget scheduling AND there is per-frame
  // work to schedule (async tasks, the std::function microtask pump, or the
  // cooperative timer pump). The polyfill carries only the no-STL CoopSched
  // namespace; per-program trampoline registration is emitted by the function
  // emitter around the driver's loop injection. STL-free so it links on
  // minimal-libc targets (Zephyr) where the Promise runtime does not.
  const coopConfig = strategy.getAsyncRuntimeConfig?.();
  const hasCoopWork =
    program.functions.some(fn => fn.isAsync) ||
    program.classes.some(c => c.methods.some(m => m.isAsync));
  if (isEntryFile && coopConfig && hasCoopWork) {
    const coop = buildCoopSchedulerPolyfill(program, coopConfig, strategy.currentTimeMillis());
    if (coop) filteredNativePolyfills = [...filteredNativePolyfills, coop];
  }

  const allPolyfills = filteredNativePolyfills;
  const emittedPolyfills = allPolyfills.length > 0
    ? emitPolyfillBoilerplate(allPolyfills)
    : undefined;
  const hasAsyncRuntime = program.functions.some(fn => fn.isAsync) || program.classes.some(c => c.methods.some(m => m.isAsync));
  const hasPromiseRuntime = nativePolyfills.some(
    (p) => p.id === "async_runtime" && p.hasPromiseRuntime === true
  );
  // Native timer capability comes from the strategy's async config, not from
  // scanning the program: platforms either provide native timer callbacks for
  // the async runtime (host/native) or they do not (Zephyr — periodic work is
  // a Thread or a Counter there).
  const usesTimers = strategy.getAsyncRuntimeConfig?.()?.hasTimers === true;

  if (!isNpmPackage) {
    includes.push(...strategy.forcedIncludes(program, options.platformContext));
    Object.assign(symbolMap, strategy.symbolAliases(program, options.platformContext));
    // Both entry and non-entry files get the strategy's shim lines, then the
    // Layer B filters below strip unused blocks based on programAnalysis. For
    // non-entry (split-file) headers, the per-file pre-render analysis can miss
    // renderer-introduced calls (e.g. cuttlefish_nullish from `??` lowering);
    // output-finalizer.ts handles that case with a post-render text scan that
    // re-injects the nullish helper shim into a header whose emitted lines
    // actually contain a cuttlefish_nullish( call. So gating here is safe — the
    // post-render injection covers the one unreliable pre-render signal.
    shimLines = [...strategy.shimLines(program, options.platformContext)];
    if (!programAnalysis.usesStringConversion) {
      shimLines = shimLines.filter(l => !l.includes('std::string String('));
    }
    if (!programAnalysis.usesDateNow) {
      shimLines = shimLines.filter(l => !l.includes('namespace Date'));
    }
    // Strip the nullish helper FUNCTIONS (not the CUTTLEFISH_UNDEFINED macro)
    // when the file doesn't actually emit cuttlefish_nullish(...) calls. A
    // file that only references `null`/`undefined` literals needs just the
    // macro token, not the function definitions. The usesNullishHelper flag
    // tracks files that lower `??` to cuttlefish_nullish(...) calls.
    //
    // Note: for split-file HEADERS, output-finalizer.ts separately injects
    // the full shim when the header's emitted lines contain an actual
    // cuttlefish_nullish( call (a more reliable post-emit check than the
    // per-file pre-emit analysis flag). The logic here governs the .cpp
    // source shim only.
    // The runtime clock (__tc_now_ms) is gated by the Zephyr strategy at
    // emission; native emits its definition unconditionally. Strip it from
    // programs that can never read the clock (no Time calls, async, timers,
    // scheduler, or mounted UI) so the definition doesn't leak into the
    // emitted header.
    if (!programAnalysis.usesWallClock && !programAnalysis.hasAsync && !entryHasUI() && !hasPromiseRuntime) {
      shimLines = shimLines.filter(l => !l.includes('__tc_now_ms'));
    }
    if (!programAnalysis.usesNullishHelper) {
      const filtered: string[] = [];
      for (let i = 0; i < shimLines.length; i++) {
        const l = shimLines[i];
        if (l.includes('cuttlefish_is_nullish') || l.includes('cuttlefish_exists') || l.includes('cuttlefish_nullish')) continue;
        filtered.push(l);
      }
      shimLines = filtered;
    }
    if (!programAnalysis.usesNum) {
      shimLines = filterShimBlock(shimLines, 'struct __tc_Num {', '} Num;');
    }
    if (!programAnalysis.usesWDT) {
      shimLines = filterShimBlock(shimLines, '#include <avr/wdt.h>', '} WDT;');
    }
    if (!programAnalysis.usesStrPtr) {
      shimLines = filterShimBlock(shimLines, '#ifndef CUTTLEFISH_STR_BUF_SIZE', 'inline size_t (strlen)(const __tc_str_ptr& s) { return ::strlen(s.buf); }');
    }
    // framework-avr native peripheral driver shims. Each block carries a
    // CUTTLEFISH_*_BEGIN/END marker pair; strip the ones the program doesn't
    // use. framework-arduino's shimLines contain none of these markers, so
    // these filters are no-ops there. The strategies also self-gate on the
    // same flags; this is the defensive backstop (mirrors how usesWDT/etc.
    // backstop the strategy-side gating above).
    if (!programAnalysis.usesUart) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_UART_BEGIN', '// CUTTLEFISH_UART_END');
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_UART_EXT_BEGIN', '// CUTTLEFISH_UART_EXT_END');
    }
    if (!programAnalysis.usesSPI) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_SPI_BEGIN', '// CUTTLEFISH_SPI_END');
    }
    if (!programAnalysis.usesI2C) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_TWI_BEGIN', '// CUTTLEFISH_TWI_END');
    }
    // framework-esp32 native peripheral driver shims. Same defensive-backstop
    // pattern as the UART/SPI/TWI/EEPROM blocks above. framework-arduino's
    // and framework-avr's shimLines contain none of these markers, so these
    // filters are no-ops there.
    if (!programAnalysis.usesGPIO) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_GPIO_BEGIN', '// CUTTLEFISH_GPIO_END');
    }
    if (!programAnalysis.usesPWM) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_PWM_BEGIN', '// CUTTLEFISH_PWM_END');
    }
    if (!programAnalysis.usesADC) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_ADC_BEGIN', '// CUTTLEFISH_ADC_END');
    }
    if (!programAnalysis.usesDAC) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_DAC_BEGIN', '// CUTTLEFISH_DAC_END');
    }
    if (!programAnalysis.usesWdt) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_WDT_BEGIN', '// CUTTLEFISH_WDT_END');
    }
    if (!programAnalysis.usesInterrupts) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_INTR_BEGIN', '// CUTTLEFISH_INTR_END');
    }
    if (!programAnalysis.usesPulse) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_PULSE_BEGIN', '// CUTTLEFISH_PULSE_END');
    }
    if (!programAnalysis.usesShift) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_SHIFT_BEGIN', '// CUTTLEFISH_SHIFT_END');
    }
    if (!programAnalysis.usesWifi) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_WIFI_BEGIN', '// CUTTLEFISH_WIFI_END');
    } else {
      if (!programAnalysis.usesWifiConnect) {
        shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_WIFI_CONNECT_BEGIN', '// CUTTLEFISH_WIFI_CONNECT_END');
      }
      if (!programAnalysis.usesWifiConnectBlocking) {
        shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_WIFI_CONNECT_BLOCKING_BEGIN', '// CUTTLEFISH_WIFI_CONNECT_BLOCKING_END');
      }
      if (!programAnalysis.usesWifiQuery) {
        shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_WIFI_QUERY_BEGIN', '// CUTTLEFISH_WIFI_QUERY_END');
      }
      if (!programAnalysis.usesWifiScan) {
        shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_WIFI_SCAN_BEGIN', '// CUTTLEFISH_WIFI_SCAN_END');
      }
      if (!programAnalysis.usesWifiConfig) {
        shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_WIFI_CONFIG_BEGIN', '// CUTTLEFISH_WIFI_CONFIG_END');
      }
    }
    if (!programAnalysis.usesHttp) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_HTTP_BEGIN', '// CUTTLEFISH_HTTP_END');
    }
    if (!programAnalysis.usesPreferences) {
      shimLines = filterShimBlock(shimLines, '// CUTTLEFISH_PREFERENCES_BEGIN', '// CUTTLEFISH_PREFERENCES_END');
    }
    // Entry-TU marker for framework shims: the UI runtime header (ui_tick) is
    // emitted ONLY into the entry file (emitUIRuntime gates on isEntryFile), so
    // shim helpers that keep the UI alive during bounded blocking waits (e.g.
    // Zephyr's wifi connect) must compile those calls down everywhere else.
    // Defined before the shim lines land in the preamble, after all filters.
    if (isEntryFile && entryHasUI() && shimLines.length > 0) {
      shimLines.unshift("#define CUTTLEFISH_ENTRY_UI_TU 1");
    }
    profileDiagnostics = [...strategy.profileDiagnostics(program, options.platformContext)];
  }

  for (const imported of program.imports) {
    // Resolve the default import name (import X from "./mod.js") the same way as
    // named imports — add it to the symbolMap so cross-module references
    // resolve. Demo #12 Finding C — was skipped, so `encode` wasn't declared.
    const defaultName = (imported as any).defaultImportName as string | undefined;
    // Cuttlefish library packages: the import emits the shim-header include
    // (resolved through the libdef registry from the library manifest) and
    // contributes native shims + build fragments. This must run BEFORE the
    // SDK skip below — @typecad-scoped libraries would otherwise be treated
    // as type-level-only like the rest of the SDK.
    if (isRegisteredCuttlefishLibrary(imported.moduleSpecifier)) {
      const resolved = resolveImport(imported, options.libdefs, options.target, options.platformContext, program.fileName);
      includes.push(normalizeInclude(resolved.include));
      Object.assign(symbolMap, resolved.symbolMap);
      if (defaultName) symbolMap[defaultName] = defaultName;
      continue;
    }
    if (isCuttlefishSDKImport(imported.moduleSpecifier, program.fileName)) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      if (defaultName) symbolMap[defaultName] = defaultName;
      continue;
    }
    if (options.nativeModules && options.nativeModules.has(imported.moduleSpecifier)) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      if (defaultName) symbolMap[defaultName] = defaultName;
      continue;
    }
    // .ui.html modules: their content is injected directly into the entry TU
    // by emitUIRuntime (static tables + runtime header), so they need NO
    // separate header include. Just register the imported symbols (e.g.
    // `screen`) so cross-module references resolve.
    if (imported.moduleSpecifier.endsWith(".ui.html")) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      if (defaultName) symbolMap[defaultName] = defaultName;
      continue;
    }
    // Compile-time-only packages: their calls are intercepted at IR-build
    // time; the package emits NO C++ module/header. Register the imported
    // symbols so references resolve, but skip the #include generation.
    if (
      imported.moduleSpecifier === "@typecad/ui" ||
      isSafetyImportSpecifier(imported.moduleSpecifier)
    ) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      if (defaultName) symbolMap[defaultName] = defaultName;
      continue;
    }
    const transpiledInclude = resolveTranspiledModuleInclude(
      imported.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );
    if (transpiledInclude.isTranspiled) {
      includes.push(transpiledInclude.include);
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      if (defaultName) symbolMap[defaultName] = defaultName;
    } else {
      const resolved = resolveImport(imported, options.libdefs, options.target, options.platformContext, program.fileName);
      includes.push(normalizeInclude(resolved.include));
      Object.assign(symbolMap, resolved.symbolMap);
      if (defaultName) symbolMap[defaultName] = defaultName;
    }
  }

  const templateInterfaceNames = new Set<string>();
  const interfaceNamespaceMap = new Map<string, string>();
  const interfaceFieldTypes = new Map<string, Map<string, string>>();
  // Shared map populated as top-level const object literals are emitted
  // (function-emitter-impl.ts) and read by the expression renderer to decide
  // `.` vs `::` member access on those variables.
  const knownTopLevelObjectTypes = new Map<string, string>();
  // Module-scope pointer variables, populated by runTopLevelPreprocessing
  // (top-level-prep.ts) into THIS map (in place, by reference) so the
  // ExpressionRenderer — constructed below with this same reference — can
  // decide `->` vs `.` for bare identifiers that resolve to file-global
  // pointers (e.g. ISR-captured `const btn = new Button()`). Replaces the
  // file-wide text sweep formerly in output-finalizer.ts.
  const globalPointerVarTypes = new Map<string, string>();
  for (const iface of program.interfaces) {
    if (iface.parentScope) {
      interfaceNamespaceMap.set(iface.name, iface.parentScope);
    }
    if (iface.fields.length > 0) {
      const fieldTypes = new Map<string, string>();
      for (const field of iface.fields) {
        fieldTypes.set(field.name, field.cppType);
      }
      interfaceFieldTypes.set(iface.name, fieldTypes);
      for (const field of iface.fields) {
        if (/^[A-Z]$/.test(field.cppType)) {
          templateInterfaceNames.add(iface.name);
          break;
        }
      }
    }
  }
  for (const classDef of program.classes) {
    if (classDef.fields.length > 0 || classDef.extendsClass) {
      const fieldTypes = new Map<string, string>();
      if (classDef.extendsClass) {
        const parentFields = interfaceFieldTypes.get(classDef.extendsClass);
        if (parentFields) {
          for (const [fname, ftype] of parentFields) {
            fieldTypes.set(fname, ftype);
          }
        }
      }
      for (const field of classDef.fields) {
        fieldTypes.set(field.name, field.cppType);
      }
      interfaceFieldTypes.set(classDef.name, fieldTypes);
    }
  }
  if (options.crossModuleClassFieldTypes) {
    for (const [className, fieldTypes] of options.crossModuleClassFieldTypes) {
      if (!interfaceFieldTypes.has(className)) {
        interfaceFieldTypes.set(className, fieldTypes);
      }
    }
  }

  // Build the set of all known class names (local + cross-module).
  // Class instances are always created with `new`, which returns a pointer;
  // function parameters that reference these types must also be pointers.
  const classNames = new Set<string>();
  for (const cls of program.classes) classNames.add(cls.name);
  if (options.crossModuleClasses) {
    for (const name of options.crossModuleClasses) classNames.add(name);
  }

  // Map a function's original TS name to its emitted C++ name, applying the
  // strategy's user-function renames. The entrypoint sentinel
  // `__cuttlefish_entrypoint__` maps to the strategy's entrypoint name
  // (per-target entrypoint names); every other name is routed through
  // `strategy.mapFunctionName`, which is where a target renames a user
  // function that would otherwise collide with a C++/framework reserved name
  // — e.g. Targets without a user `main()` rename one to `cuttlefish_main`;
  // because this target has no user `main()` (the entrypoints are the auto-generated
  // `setup()`/`loop()`), and a file-scope `static void main()` collides with
  // C++'s required `int main()` signature. Call-site renames are applied
  // uniformly in StatementRenderer.renderCall (the single call-rendering
  // chokepoint), so every reference — definition, forward decl, and every call
  // site including the top-level `main()` call spliced into `setup()` —
  // follows the rename.
  const mapEmittedFnName = (originalName: string): string =>
    originalName === "__cuttlefish_entrypoint__"
      ? strategy.entrypointFunctionName()
      : strategy.mapFunctionName(originalName);

  const mappedFunctions: MappedFunction[] = program.functions.map((fn) => {
    const fnName = mapEmittedFnName(fn.originalName);
    return {
      name: fnName,
      returnType: resolveTemplateReturnType(
        strategy.mapReturnType(fnName, fn.returnType),
        fn.typeParameters,
      ),
      sourceSpan: fn.sourceSpan,
      leadingComments: fn.leadingComments,
      trailingComments: fn.trailingComments,
      parameters: fn.parameters,
      isAsync: fn.isAsync,
      typeParameters: fn.typeParameters,
      typeParameterConstraints: fn.typeParameterConstraints,
      isReadonlyReturnType: fn.isReadonlyReturnType,
      isGenerator: fn.isGenerator,
      isExported: fn.isExported,
      statements: fn.statements.map((stmt) => {
        if (stmt.kind === "call") {
          return { ...stmt, callee: applySymbolMap(stmt.callee, symbolMap) };
        }
        return stmt;
      }),
    };
  });

  const knownFunctionReturnTypes = new Map<string, string>(options.crossModuleFunctionReturnTypes);
  for (const fn of mappedFunctions) {
    knownFunctionReturnTypes.set(fn.name, fn.returnType);
  }
  for (const fn of program.functions) {
    const fnName = fn.originalName === "__cuttlefish_entrypoint__" ? strategy.entrypointFunctionName() : fn.originalName;
    knownFunctionReturnTypes.set(fn.originalName, strategy.mapReturnType(fnName, fn.returnType));
  }
  // Also register class method return types (keyed by bare method name) so
  // downstream type inference — in particular snprintf format-specifier
  // selection for `this->method()` / `obj->method()` operands in a string
  // concat — can resolve a method's return type. Without this, a
  // double-returning method like `cargoUsed()` defaults to `%d` in the
  // emitted snprintf, which misaligns the format/arg list and corrupts
  // output. The bare-name key is safe here because `inferExpressionCppType`
  // looks up `expr.callee` which is the bare method name for member calls.
  for (const cls of program.classes) {
    for (const m of cls.methods) {
      if (!knownFunctionReturnTypes.has(m.name)) {
        knownFunctionReturnTypes.set(m.name, m.returnType);
      }
    }
    for (const g of cls.getters) {
      if (!knownFunctionReturnTypes.has(g.name)) {
        knownFunctionReturnTypes.set(g.name, g.returnType);
      }
    }
  }

  const snprintfCounter = { value: 0 };
  const topLevelScope = createEmissionScopeState();

  if (options.crossModuleVariableTypes) {
    for (const [name, cppType] of options.crossModuleVariableTypes) {
      topLevelScope.knownVariableTypes.set(name, { cppType });
    }
  }

  // Register namespace-scope const/let types in knownVariableTypes so the
  // snprintf operand resolver (and other type-resolution consumers) see them
  // — otherwise a namespace `const string` used in a concat fell through to
  // the %d default (namespace stress test Finding 3b). Mirrors the cross-
  // module registration above; walks nested namespaces recursively.
  const registerNsConstants = (ns: typeof program.namespaces[number]): void => {
    for (const c of ns.constants) {
      topLevelScope.knownVariableTypes.set(c.name, { cppType: c.cppType });
    }
    for (const child of ns.children ?? []) registerNsConstants(child);
  };
  for (const ns of program.namespaces) registerNsConstants(ns);

  const stringVarNames = new Set<string>();
  // Pre-populate known string variable names from the program IR so that
  // string-concat / template rendering can detect string identifiers even when
  // the dynamic knownVariableTypes map doesn't yet hold them at render time.
  const isStringCppType = (t: string | undefined): boolean =>
    !!t && (t === "std::string" || t === "const char*");
  const collectStringVars = (statements: StatementIR[]): void => {
    for (const stmt of statements) {
      switch (stmt.kind) {
        case "var_decl":
          if (isStringCppType(stmt.cppType)) stringVarNames.add(stmt.name);
          break;
        case "if":
          collectStringVars(stmt.thenBranch);
          if (stmt.elseBranch) collectStringVars(stmt.elseBranch);
          break;
        case "for":
          if (stmt.initializer && stmt.initializer.kind === "var_decl" && isStringCppType(stmt.initializer.cppType)) {
            stringVarNames.add(stmt.initializer.name);
          }
          collectStringVars(stmt.body);
          break;
        case "for_of":
        case "for_in":
          if (stmt.variable && stmt.variable.kind === "var_decl" && isStringCppType(stmt.variable.cppType)) {
            stringVarNames.add(stmt.variable.name);
          }
          collectStringVars(stmt.body);
          break;
        case "while":
        case "do_while":
        case "block":
        case "labeled":
          collectStringVars(stmt.body);
          break;
        case "switch":
          for (const c of stmt.cases) collectStringVars(c.body);
          break;
        case "try":
          collectStringVars(stmt.tryBlock);
          if (stmt.catchBlock) collectStringVars(stmt.catchBlock);
          if (stmt.finallyBlock) collectStringVars(stmt.finallyBlock);
          break;
        default:
          break;
      }
    }
  };
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl" && isStringCppType(stmt.cppType)) stringVarNames.add(stmt.name);
  }
  for (const fn of program.functions) {
    for (const param of fn.parameters) {
      if (isStringCppType(param.cppType)) stringVarNames.add(param.name);
    }
    collectStringVars(fn.statements);
  }
  for (const cls of program.classes) {
    for (const field of cls.fields) {
      if (isStringCppType(field.cppType)) stringVarNames.add(field.name);
    }
    for (const method of cls.methods) {
      for (const param of method.parameters) {
        if (isStringCppType(param.cppType)) stringVarNames.add(param.name);
      }
      collectStringVars(method.statements);
    }
    if (cls.constructor) {
      for (const param of cls.constructor.parameters) {
        if (isStringCppType(param.cppType)) stringVarNames.add(param.name);
      }
      collectStringVars(cls.constructor.statements);
    }
  }
  const varAccessorNames = new Map<string, Map<string, "getter" | "setter" | "both">>();

  // Populate the variable → accessor map BEFORE constructing the renderers so
  // every emit pass (free functions, class methods, top-level code) sees the
  // full mapping. A getter read (`hero.alive`) must rewrite to `hero->getAlive()`
  // regardless of whether `hero` is a local, a free-function parameter, a class
  // method/ctor parameter, or a top-level binding. Previously only local
  // var_decls were registered (in class-emitter), which ran too late for the
  // free-function pass — leaving `hero->alive` unrewritten and failing g++.
  // (demo #4 fix.)
  // `classAccessorNames` is built at the outer scope (not inside a nested
  // block) so it can also be passed to the expression renderer as
  // `typeAccessorNames` — the type-keyed fallback used when a getter access's
  // receiver isn't a registered variable (e.g. a for-of loop variable, a
  // function return, or a chained member access). See demo #6 fix C.
  const classAccessorNames = new Map<string, Map<string, "getter" | "setter" | "both">>();
  for (const classDef of program.classes) {
    const accessors = new Map<string, "getter" | "setter" | "both">();
    for (const g of classDef.getters) {
      accessors.set(g.name, accessors.has(g.name) ? "both" : "getter");
    }
    for (const s of classDef.setters) {
      accessors.set(s.name, accessors.has(s.name) ? "both" : "setter");
    }
    if (accessors.size > 0) {
      classAccessorNames.set(classDef.name, accessors);
    }
  }
  // Merge cross-file (imported) class accessors so `obj.getter` and
  // `Cls.staticGetter` accesses rewrite correctly when the class lives in
  // another module (demo #14 Finding E).
  if (options.crossModuleClassAccessors) {
    for (const [className, accessors] of options.crossModuleClassAccessors) {
      if (!classAccessorNames.has(className)) {
        classAccessorNames.set(className, accessors);
      }
    }
  }
  const allVarDecls: { name: string; cppType: string }[] = [];
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") allVarDecls.push(stmt);
  }
  for (const fn of mappedFunctions) {
    for (const stmt of fn.statements) {
      if (stmt.kind === "var_decl") allVarDecls.push(stmt);
    }
    for (const param of fn.parameters) {
      allVarDecls.push({ name: param.name, cppType: param.cppType });
    }
  }
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      for (const param of method.parameters) {
        allVarDecls.push({ name: param.name, cppType: param.cppType });
      }
    }
    if (cls.constructor) {
      for (const param of cls.constructor.parameters) {
        allVarDecls.push({ name: param.name, cppType: param.cppType });
      }
    }
  }
  for (const v of allVarDecls) {
    const bareType = v.cppType.replace(/\*$/, "").replace(/^const\s+/, "");
    const accessors = classAccessorNames.get(bareType);
    if (accessors) {
      varAccessorNames.set(v.name, accessors);
    }
  }

  const exprRenderer = new ExpressionRenderer({
    strategy,
    boardConstants: program.boardConstants,
    typeAccessorNames: classAccessorNames,
    classNameMap,
    enumNames,
    stringEnumNames,
    largeEnumNames,
    knownFunctionReturnTypes,
    knownVariableTypes: topLevelScope.knownVariableTypes,
    globalPointerVarTypes,
    namespaceNames,
    snprintfCounter,
    stringVarNames,
    varAccessorNames,
    interfaceFieldTypes,
    crossModuleClassNames: classNames,
    knownTopLevelObjectTypes,
    diagnostics: emitDiagnostics,
  });

  // Construct the compliance context early so it can be threaded into the
  // renderers (StatementRenderer needs it for A3-9-1 fixed-width integer
  // default). It's also returned in the EmitterContext at the end.
  const compliance = new ComplianceContext(options.autosar ?? "off");

  const statementRenderer = new StatementRenderer({
    strategy,
    boardConstants: program.boardConstants,
    classNameMap,
    enumNames,
    stringEnumNames,
    largeEnumNames,
    knownFunctionReturnTypes,
    knownVariableTypes: topLevelScope.knownVariableTypes,
    globalPointerVarTypes,
    namespaceNames,
    snprintfCounter,
    stringVarNames,
    varAccessorNames,
    typeAccessorNames: classAccessorNames,
    interfaceFieldTypes,
    crossModuleClassNames: classNames,
    diagnostics: emitDiagnostics,
    compliance,
  });

  const asyncFunctionOriginalNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => fn.originalName)
  );
  const mapFunctionNameLocal = (originalName: string) =>
    statementRenderer.mapFunctionName(originalName);
  const asyncFunctionMappedNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => mapFunctionNameLocal(fn.originalName))
  );

  const asyncTaskClasses: AsyncTaskClass[] = [];
  const asyncMethodStarters: { proto: string }[] = [];
  if (hasAsyncRuntime) {
    for (const fn of program.functions) {
      if (fn.isAsync) {
        const task = generateAsyncTaskClass(
          fn.originalName,
          fn.statements,
          strategy,
          knownFunctionReturnTypes,
          (stmt, forHeader, strategy, pointerVarTypes, calleeTransformer, knownReturnTypes) => {
            const contextRenderer = new StatementRenderer({
              strategy,
              boardConstants: program.boardConstants,
              classNameMap,
              enumNames,
              stringEnumNames,
              largeEnumNames,
              knownFunctionReturnTypes: knownReturnTypes ?? knownFunctionReturnTypes,
              knownVariableTypes: topLevelScope.knownVariableTypes,
              globalPointerVarTypes,
              namespaceNames,
              snprintfCounter,
              stringVarNames,
              varAccessorNames,
              typeAccessorNames: classAccessorNames,
              pointerVarTypes,
              diagnostics: emitDiagnostics,
            });
            // Use renderWithPrelude so snprintf buffer declarations (e.g.
            // char __cuttlefish_str_N[...]; snprintf(...)) are emitted before
            // the statement that references them. Without this, template-literal
            // string building inside async functions loses the buffer declaration.
            const { prelude, statement } = contextRenderer.renderWithPrelude(stmt, forHeader, calleeTransformer);
            if (prelude.length > 0) {
              return prelude.join("\n") + "\n" + statement;
            }
            return statement;
          },
          {
            onUnsupportedAwait: (callee, span) => {
              emitDiagnostics.push({
                severity: "error",
                code: "await-unsupported-call",
                message: `await ${callee}(...) has no cooperative lowering here — the call would be dropped. Await is supported on Time.sleep, HAL ops (wifi.join / wifi.scan / http.send), ui.onTap(), and pin-edge waits.`,
                ...(span ? { source: `${callee}(...)` } : {}),
              } as never);
            },
          },
        );
        asyncTaskClasses.push({ ...task, taskVarName: `${fn.originalName}Task` });
      }
    }

    // Async METHODS on user classes: the body becomes an owner-bound task
    // (this->x renders as _owner->x inside segments); the in-class method
    // body is replaced by a call to a forward-declared starter that binds
    // the receiver and arms the machine (see class-emitter.ts).
    for (const cls of program.classes) {
      for (const method of cls.methods) {
        if (!method.isAsync) continue;
        const fnName = `${cls.name}_${method.name}`;
        if (method.isStatic) {
          emitDiagnostics.push({
            severity: "error",
            code: "async-method-static",
            message: `static async method ${cls.name}.${method.name}() is not supported — hoist it to a free async function instead.`,
          } as never);
          continue;
        }
        if (method.parameters.length > 0) {
          emitDiagnostics.push({
            severity: "error",
            code: "async-method-params",
            message: `async method ${cls.name}.${method.name}() takes parameters, which the cooperative state machine cannot capture — make it parameterless.`,
          } as never);
          continue;
        }
        if (method.returnType !== "void" && !String(method.returnType).startsWith("Promise")) {
          emitDiagnostics.push({
            severity: "error",
            code: "async-method-return",
            message: `async method ${cls.name}.${method.name}() returns ${method.returnType}; async methods lower to fire-and-forget tasks and must return void (Promise<void>).`,
          } as never);
          continue;
        }
        const task = generateAsyncTaskClass(
          fnName,
          method.statements,
          strategy,
          knownFunctionReturnTypes,
          (stmt, forHeader, strategy, pointerVarTypes, calleeTransformer, knownReturnTypes) => {
            const contextRenderer = new StatementRenderer({
              strategy,
              boardConstants: program.boardConstants,
              classNameMap,
              enumNames,
              stringEnumNames,
              largeEnumNames,
              knownFunctionReturnTypes: knownReturnTypes ?? knownFunctionReturnTypes,
              knownVariableTypes: topLevelScope.knownVariableTypes,
              globalPointerVarTypes,
              namespaceNames,
              snprintfCounter,
              stringVarNames,
              varAccessorNames,
              typeAccessorNames: classAccessorNames,
              pointerVarTypes,
              diagnostics: emitDiagnostics,
            });
            const { prelude, statement } = contextRenderer.renderWithPrelude(stmt, forHeader, calleeTransformer);
            const body = prelude.length > 0 ? prelude.join("\n") + "\n" + statement : statement;
            // The task class is not the receiver: rebind member accesses from
            // the owning instance to the task's _owner pointer. The renderer
            // emits every this-form as `this->`; a rendered string literal
            // containing that token would be rewritten too (accepted edge).
            return body.replace(/this->/g, "_owner->");
          },
          {
            ownerClassName: cls.name,
            onUnsupportedAwait: (callee, span) => {
              emitDiagnostics.push({
                severity: "error",
                code: "await-unsupported-call",
                message: `await ${callee}(...) has no cooperative lowering here — the call would be dropped. Await is supported on Time.sleep, HAL ops (wifi.join / wifi.scan / http.send), ui.onTap(), and pin-edge waits.`,
                ...(span ? { source: `${callee}(...)` } : {}),
              } as never);
            },
          },
        );
        asyncTaskClasses.push({ ...task, taskVarName: `${fnName}Task` });
        asyncMethodStarters.push({
          proto: `void __tc_async_start_${fnName}(${cls.name}* owner);`,
        });
      }
    }
  }

  // Additional includes computed from analysis
  const usesVectorTypes = programAnalysis.usesVectorTypes || programAnalysis.hasArrayInObjectLiteral;
  if (programAnalysis.usesStdString && strategy.needsStdString()) {
    includes.push("<string>");
  }
  if (strategy.needsStdVector() && programAnalysis.usesVectorTypes) {
    includes.push("<vector>");
  }
  if (strategy.needsStdVector() && programAnalysis.hasArrayInObjectLiteral) {
    includes.push("<vector>");
  }
  if (programAnalysis.usesStdFunction && strategy.needsStdFunction()) {
    includes.push("<functional>");
  }
  if (programAnalysis.hasThrowStatements && strategy.needsStdExcept()) {
    includes.push("<stdexcept>");
  }
  if (program.functions.some(fn => fn.typeParameterConstraints && fn.typeParameterConstraints.size > 0)) {
    includes.push("<type_traits>");
  }
  if (programAnalysis.hasStdMathCalls) {
    includes.push(strategy.mathHeader());
  }
  if (programAnalysis.usesStdMap) {
    includes.push("<map>");
  }
  const needsSnprintf = strategy.useSnprintfForStrings() && (
    program.topLevelStatements.some((statement) => statementNeedsSnprintf(statement, strategy)) ||
    program.functions.some((fn) => fn.statements.some((statement) => statementNeedsSnprintf(statement, strategy))) ||
    program.classes.some((classDef) =>
      (classDef.constructor?.statements.some((statement) => statementNeedsSnprintf(statement, strategy)) ?? false) ||
      classDef.methods.some((method) => method.statements.some((statement) => statementNeedsSnprintf(statement, strategy)))
    )
  );
  if (needsSnprintf) {
    includes.push("<stdio.h>");
    includes.push("<stdlib.h>");
  }
  if (emittedPolyfills) {
    includes.push(...emittedPolyfills.includes.map((include) => normalizeInclude(include)));
  }
  if (program.requiredIncludes) {
    let reqIncludes = [...program.requiredIncludes];
    // Let the strategy strip stale includes (e.g. framework-avr removes
    // Arduino library headers it doesn't need — Wire.h, SPI.h, etc.).
    if (strategy.filterRequiredIncludes) {
      reqIncludes = strategy.filterRequiredIncludes(reqIncludes);
    }
    includes.push(...reqIncludes);
  }
  // UI text bindings lower to snprintf bodies that need <stdio.h>. Pushed here
  // (in buildEmitterContext) rather than in emitUIRuntime because emitPreamble
  // runs before emitUIRuntime — a push there would never reach the output.
  // Gated on entryHasUI so non-UI files don't pull in stdio unnecessarily.
  if (entryHasUI() && !includes.includes("<stdio.h>")) {
    includes.push("<stdio.h>");
  }
  // std::variant (from discriminated-union type aliases) needs <variant>.
  // Scan type aliases AND function signatures (params/return types) — a union
  // used only as a param/return may not survive tree-shaking as an alias, but
  // the resolved `std::variant<...>` cppType still appears in signatures.
  const variantInAliases = program.typeAliases.some((a) => (a.cppType ?? "").includes("std::variant"));
  const variantInFunctions = program.functions.some(
    (f) => (f.returnType ?? "").includes("std::variant")
      || f.parameters.some((p) => (p.cppType ?? "").includes("std::variant")),
  );
  if (variantInAliases || variantInFunctions) {
    includes.push("<variant>");
  }
  // String enums lower to const char* and use strcmp() for === comparisons.
  // Header name is platform-specific: <cstring> on hosted, <string.h> on AVR.
  if (stringEnumNames.size > 0) {
    includes.push(strategy.cstringHeader());
  }
  // `<avr/wdt.h>` is only needed when the program actually uses the watchdog.
  // The HAL resolver lowers WDT.enable/reset/disable to bare wdt_*() calls
  // (or constant-folded wdt_enable(WDTO_*) macros), all of which require the
  // header. Detect the structured `wdt.*` hal-ops directly here rather than
  // relying on programAnalysis.usesWDT (which misses these ops — they carry
  // a typed operation name, not raw code the analysis scans) or on a forced
  // include in the AVR profile (which leaked the header into every AVR
  // program, even ones that never touch the watchdog like `led.toggle()`).
  if (programUsesWdt(program)) {
    // Strategy-vetoed: framework-zephyr lowers wdt.* to the Zephyr watchdog
    // driver (<zephyr/drivers/watchdog.h>, forced under usesWDT) and must not
    // carry the AVR-only header into a Zephyr build.
    const wdtInc = strategy.filterRequiredIncludes
      ? strategy.filterRequiredIncludes(["<avr/wdt.h>"])
      : ["<avr/wdt.h>"];
    includes.push(...wdtInc);
  }

  // Placeholder defaults for fields that are computed later by other phases
  const noopFixPointer: (callee: string) => string = (c) => c;

  // Demo #18 Finding B: collect the names of non-exported free functions that
  // are CALLED from at least one class method body (method/getter/setter/
  // constructor). In split mode an inline class method body lives in the
  // header, so such a function must be visible in the header too (a `static`
  // forward decl in the .cpp is reached only after the header is processed).
  // These functions are emitted non-static with a header prototype, like
  // exported functions.
  //
  // Demo #30 Finding A: this previously had its OWN hand-rolled IR walk that
  // only inspected structured `call`/`method-call` nodes. A free function
  // reached through a `raw` IR wrapper — the lowering of
  // `freeFn(x).trim()` / `__tc_trim(freeFn(x))` — was invisible to it, so the
  // function was emitted `static` with no header prototype and g++ reported it
  // "not declared in this scope" from the inline class-method body. This is
  // the SAME blind spot demo #28 Finding C fixed in the tree-shaking walk
  // (`identifier-collector.ts`): two parallel walks over the same IR diverged.
  // The fix is to stop duplicating the walk and reuse the canonical collector
  // — which already extracts identifiers from `raw` text, recurses through
  // `paren`/`lambda`/`tuple-access`/`hal-expr`, and is the single place that
  // knows every IR shape. Any free function reached through ANY lowering
  // (raw wrapper, parenthesized call, lambda capture, HAL op) is now visible.
  const freeFunctionNames = new Set<string>();
  for (const fn of program.functions) {
    if (!fn.isExported) freeFunctionNames.add(fn.originalName);
  }
  const freeFunctionsCalledFromClassMethods = new Set<string>();
  for (const cls of program.classes) {
    const methodBodies: StatementIR[] = [];
    for (const m of cls.methods) for (const s of m.statements) methodBodies.push(s);
    for (const g of cls.getters) for (const s of g.statements) methodBodies.push(s);
    for (const st of cls.setters) for (const s of st.statements) methodBodies.push(s);
    if (cls.constructor) for (const s of cls.constructor.statements) methodBodies.push(s);
    for (const stmt of methodBodies) {
      for (const id of collectStatementIdentifiers(stmt)) {
        if (freeFunctionNames.has(id)) freeFunctionsCalledFromClassMethods.add(id);
      }
    }
  }

  return {
    program,
    options,
    strategy,
    programAnalysis,
    enumNames,
    stringEnumNames,
    largeEnumNames,
    namespaceNames,
    symbolMap,
    includes,
    shimLines,
    baseName,
    effectiveEmitMode,
    isEntryFile,
    isNpmPackage,
    isrPrefix,
    reservedNames,
    knownFunctionReturnTypes,
    mappedFunctions,
    freeFunctionsCalledFromClassMethods,
    topLevelScope,
    snprintfCounter,
    stringVarNames,
    varAccessorNames,
    exprRenderer,
    statementRenderer,
    classNameMap,
    boardConstants: program.boardConstants,
    restParamFunctions: program.restParamFunctions,
    asyncTaskClasses,
    asyncMethodStarters,
    asyncFunctionOriginalNames,
    asyncFunctionMappedNames,
    hasAsyncRuntime,
    hasPromiseRuntime,
    usesTimers,
    emittedPolyfills,
    sourceLines: [],
    headerLines: ["#pragma once", ""],
    sourceMapEntries: [],
    headerMapEntries: [],
    // GDB debug mode: emit #line markers at appendSourceLine when 'gdb'.
    // Resolved once from strategy.debugMode(buildTarget); defaults to 'printf'
    // so all existing paths keep their pre-marker behavior.
    debugMode: (() => {
      const buildTarget = (options.platformContext?.frameworkData as { buildTarget?: string } | undefined)?.buildTarget;
      return strategy.debugMode?.(buildTarget) ?? 'printf';
    })(),
    lastEmittedSource: null,
    cArrayVarNames: new Set(),
    fnCArrayVarNames: new Map(),
    globalPointerVarTypes,
    promotedVarDecls: new Map(),
    callbackFunctions: [],
    filteredTopLevelExecutables: [],
    filteredTopLevelDeclarations: [],
    emittedTopLevelStatements: [],
    compiletimeVarNames: new Set(),
    fixPointerFieldAccess: noopFixPointer,
    knownTopLevelObjectTypes,
    knownTopLevelObjectFields: new Map(),
    profileDiagnostics,
    emitDiagnostics,
    templateInterfaceNames,
    interfaceNamespaceMap,
    interfaceFieldTypes,
    compliance,
  };
}
