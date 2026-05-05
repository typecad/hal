// ---------------------------------------------------------------------------
// GenericStrategy — standard C++ target (std::cout, main(), <cmath> …)
// ---------------------------------------------------------------------------

import type { PlatformStrategy, AsyncRuntimeConfig } from "@typehal/core/shared";
import type { ExpressionIR, ProgramIR } from "@typehal/core";
import type { BoardConstants } from "@typehal/core/shared";
import type { Diagnostic, PlatformContext } from "../types";
import type { RuntimePolyfillIR, StdLibSupport } from "@typehal/core/shared";
import { DEFAULT_STDLIB_SUPPORT } from "@typehal/core/shared";
import { buildAsyncRuntimePolyfill } from "./async-runtime";

export class GenericStrategy implements PlatformStrategy {
  readonly id = "generic";

  // ── Profile ─────────────────────────────────────────────────────────────

  forcedIncludes(_program: ProgramIR, _ctx?: PlatformContext): string[] {
    return [];
  }
  symbolAliases(_program: ProgramIR, _ctx?: PlatformContext): Record<string, string> {
    return {};
  }
  shimLines(_program: ProgramIR, _ctx?: PlatformContext): string[] {
    return [];
  }
  profileDiagnostics(_program: ProgramIR, _ctx?: PlatformContext): Diagnostic[] {
    return [];
  }

  // ── File shape ──────────────────────────────────────────────────────────

  sourceExtension(_isEntryFile: boolean, _isNpmPackage: boolean): string {
    return "cpp";
  }
  entrypointFunctionName(): string {
    return "main";
  }
  requiresLoopFunction(): boolean {
    return false;
  }
  overrideBaseName(originalBaseName: string, _outDirBaseName: string, _isEntryFile: boolean, _isNpmPackage: boolean): string {
    return originalBaseName;
  }
  effectiveEmitMode(requestedMode: string, _isNpmPackage: boolean): string {
    return requestedMode;
  }

  // ── Type normalisation ──────────────────────────────────────────────────

  normalizeCppType(typeName: string): string {
    if (typeName === "auto") return "int";
    return typeName;
  }
  defaultNumericType(): string { return "int"; }
  mapReturnType(_functionName: string, returnType: string): string {
    return this.normalizeCppType(returnType);
  }
  mapFunctionName(originalName: string): string {
    if (originalName === "__typehal_entrypoint__") return "main";
    return originalName;
  }

  // ── Expression rendering ────────────────────────────────────────────────

  normalizeRawExpression(value: string): string {
    return value;
  }
  nullValue(): string {
    // In generic C++ null/undefined are left as-is (the common normalizeRawExpression
    // in the emitter already handles === / !== / enum scoping).
    return "";
  }
  wrapStringConcat(_leftRendered: string, _rightRendered: string, _leftIsString: boolean): string | undefined {
    return undefined;
  }
  useSnprintfForStrings(): boolean {
    return false;
  }
  renameEnumMember(_enumName: string, memberName: string): string {
    return memberName;
  }
  enumCastType(_enumName: string): string | undefined {
    return undefined;
  }
  renderBoardDefinitionAccess(
    _chain: string[],
    _boardConstants?: BoardConstants,
  ): string | undefined {
    return undefined;
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  renderThrow(valueExpr: string): string {
    return `throw ${valueExpr};`;
  }
  transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string {
    const semi = forHeader ? "" : ";";
    switch (method) {
      case "log":
      case "info":
      case "debug":
        return `std::cout << ${renderedArgs} << std::endl${semi}`;
      case "error":
        return `std::cerr << "[ERROR] " << ${renderedArgs} << std::endl${semi}`;
      case "warn":
        return `std::cerr << "[WARN] " << ${renderedArgs} << std::endl${semi}`;
      default:
        return `std::cout << ${renderedArgs} << std::endl${semi}`;
    }
  }
  objectFieldInitializer(_fieldValue: ExpressionIR, _renderExpr: (e: ExpressionIR) => string): string | undefined {
    return undefined;
  }
  overrideClassFieldType(_fieldName: string, _normalizedType: string): string {
    return _normalizedType;
  }

  // ── Name guards ─────────────────────────────────────────────────────────

  reservedNames(): ReadonlySet<string> {
    return new Set<string>();
  }
  apiReservedEnumNames(): ReadonlySet<string> {
    return new Set<string>();
  }
  apiReservedEnumGuard(): string {
    return "";
  }

  // ── Includes ────────────────────────────────────────────────────────────

  needsIostream(): boolean { return true; }
  needsStdString(): boolean { return true; }
  needsStdVector(): boolean { return true; }
  needsStdExcept(): boolean { return true; }
  needsStdFunction(): boolean { return true; }
  mathHeader(): string { return "<cmath>"; }
  needsVectorOverload(): boolean { return true; }

  // ── Enum underlying type ────────────────────────────────────────────────

  needsLargeEnumUnderlying(): boolean { return false; }

  // ── Struct field handling ───────────────────────────────────────────────

  renameStructField(fieldName: string): string { return fieldName; }
  structFieldInitializer(
    _fieldValue: ExpressionIR,
    _compiletimeVarNames: Set<string>,
    _renderExpr: (e: ExpressionIR) => string,
  ): string | undefined {
    return undefined;
  }

  // ── Async ───────────────────────────────────────────────────────────────

  getAsyncRuntimeConfig(): AsyncRuntimeConfig {
    return {
      queueCapacity: this.asyncQueueCapacity(),
      scheduler: "microtask",
      waitForPinEdge: "stub",
      hasPromiseRuntime: true,
      hasTimers: false,
      requiredIncludes: ["<functional>", "<vector>", "<utility>", "<string>"],
    };
  }

  generateNativePolyfills(program: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[] {
    const helpers: RuntimePolyfillIR[] = [];
    const asyncRuntime = buildAsyncRuntimePolyfill(program, ctx, "generic", this.asyncQueueCapacity());
    if (asyncRuntime) helpers.push(asyncRuntime);
    return helpers;
  }

  asyncLoopInjection(_taskVarNames: string[], config: AsyncRuntimeConfig): string[];
  asyncLoopInjection(_taskVarNames: string[], hasPromiseRuntime: boolean): string[];
  asyncLoopInjection(_taskVarNames: string[], configOrBool: AsyncRuntimeConfig | boolean): string[] {
    let hasPromiseRuntime: boolean;
    if (typeof configOrBool === 'boolean') {
      hasPromiseRuntime = configOrBool;
    } else {
      hasPromiseRuntime = configOrBool.hasPromiseRuntime;
    }
    const lines: string[] = [];
    if (hasPromiseRuntime) lines.push("  typehal_pump_microtasks();");
    return lines;
  }
  asyncDriverFunctionName(): string { return "main"; }

  // ── Type aliases ────────────────────────────────────────────────────────

  shouldSkipTypeAlias(_cppType: string): boolean { return false; }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  emitDiagnostics(_emitMode: string): Diagnostic[] { return []; }

  currentTimeMillis(): string {
    return 'std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count()';
  }

  // ── Build configuration ─────────────────────────────────────────────────

  asyncQueueCapacity(): number { return 256; }
  outputSubdirectory(_baseName: string): string { return ".build"; }
  generateHeaderFile(): boolean { return true; }
  enumApiGuard(_enumName: string): { open: string; close: string } | undefined { return undefined; }
  getStdLibSupport(_architecture?: string): StdLibSupport { return DEFAULT_STDLIB_SUPPORT; }

  // ── Debug code generation ─────────────────────────────────────────────────

  generateDebugInitCode(): string[] {
    return [
      '// === DEBUG: Initialize ===',
      'std::cout << "TypeHAL Debug Mode Active" << std::endl;',
      '// === END DEBUG INIT ===',
      '',
    ];
  }

  generateDebugBreakpointCode(params: {
    fileName: string; lineNum: number; originalLine: string;
    variables: Array<{ name: string; isFunction?: boolean }>;
    normalizedCondition?: string;
  }): string[] {
    const lines: string[] = [];
    lines.push(`  // === BREAKPOINT: ${params.fileName}:${params.lineNum} ===`);
    if (params.normalizedCondition) {
      lines.push(`  if (${params.normalizedCondition}) {`);
    }
    lines.push(`  ${params.normalizedCondition ? '  ' : ''}std::cout << "━━━━━━━━━━━━━━━━━━━━━━━━━━━━" << std::endl;`);
    lines.push(`  ${params.normalizedCondition ? '  ' : ''}std::cout << "BREAKPOINT: ${params.fileName}:${params.lineNum}" << std::endl;`);
    lines.push(`  ${params.normalizedCondition ? '  ' : ''}std::cout << "  ${params.originalLine.replace(/"/g, '\\"')}" << std::endl;`);
    if (params.variables.length > 0) {
      lines.push(`  ${params.normalizedCondition ? '  ' : ''}std::cout << "  Variables:" << std::endl;`);
      for (const v of params.variables) {
        if (v.isFunction) {
          lines.push(`  ${params.normalizedCondition ? '  ' : ''}std::cout << "  ${v.name} = [function]" << std::endl;`);
        } else {
          lines.push(`  ${params.normalizedCondition ? '  ' : ''}std::cout << "  ${v.name} = " << ${v.name} << std::endl;`);
        }
      }
    }
    lines.push(`  ${params.normalizedCondition ? '  ' : ''}std::cout << "━━━━━━━━━━━━━━━━━━━━━━━━━━━━" << std::endl;`);
    if (params.normalizedCondition) {
      lines.push(`  }`);
    }
    lines.push(`  // === END BREAKPOINT ===`);
    return lines;
  }

  generateDebugLogpointCode(params: {
    fileName: string; lineNum: number;
    parts: Array<{ type: 'text' | 'variable'; value: string }>;
    variables: Array<{ name: string; isFunction?: boolean }>;
  }): string[] {
    const lines: string[] = [];
    lines.push(`  // === LOGPOINT: ${params.fileName}:${params.lineNum} ===`);
    const parts: string[] = [`"[LOG ${params.fileName}:${params.lineNum}] "`];
    for (const part of params.parts) {
      if (part.type === 'text') {
        parts.push(`"${part.value.replace(/"/g, '\\"')}"`);
      } else {
        const varExists = params.variables.some(v => v.name === part.value && !v.isFunction);
        parts.push(varExists ? part.value : `"${part.value}"`);
      }
    }
    lines.push(`  std::cout << ${parts.join(' << ')} << std::endl;`);
    lines.push(`  // === END LOGPOINT ===`);
    return lines;
  }
}
