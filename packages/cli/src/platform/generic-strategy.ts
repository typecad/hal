// ---------------------------------------------------------------------------
// GenericStrategy — standard C++ target (std::cout, main(), <cmath> …)
// ---------------------------------------------------------------------------

import type { PlatformStrategy } from "./platform-strategy";
import type { ExpressionIR, ProgramIR } from "../ir/model";
import type { Diagnostic, PlatformContext } from "../types";
import type { BoardConstants } from "../ir/board-resolver";
import type { TypecodeReceiverKind } from "../ir/typecode-symbols";

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
  mapReturnType(_functionName: string, returnType: string): string {
    if (_functionName === "setup" || _functionName === "loop") return "void";
    return this.normalizeCppType(returnType);
  }
  mapFunctionName(originalName: string): string {
    if (originalName === "__arduino_setup__") return "setup";
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
  renameEnumMember(_enumName: string, memberName: string): string {
    return memberName;
  }
  enumCastType(_enumName: string): string | undefined {
    return undefined;
  }
  tryRenderTypecodeCall(
    _receiver: string,
    _receiverKind: TypecodeReceiverKind,
    _method: string,
    _args: ReadonlyArray<ExpressionIR>,
    _renderArg: (e: ExpressionIR) => string,
    _boardConstants?: BoardConstants,
    _interruptMode?: "FALLING" | "RISING" | "CHANGE",
  ): string | undefined {
    return undefined;
  }
  renderBoardDefinitionAccess(
    _chain: string[],
    _boardConstants?: BoardConstants,
  ): string | undefined {
    return undefined;
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  tryRenderCallStatement(
    _callee: string,
    _args: ReadonlyArray<ExpressionIR>,
    _renderArg: (e: ExpressionIR) => string,
    _boardConstants?: BoardConstants,
  ): string | undefined {
    return undefined;
  }
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

  asyncLoopInjection(_taskVarNames: string[], hasPromiseRuntime: boolean): string[] {
    const lines: string[] = [];
    if (hasPromiseRuntime) lines.push("  ts2cpp_pump_microtasks();");
    return lines;
  }
  asyncDriverFunctionName(): string { return "main"; }

  // ── Type aliases ────────────────────────────────────────────────────────

  shouldSkipTypeAlias(_cppType: string): boolean { return false; }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  emitDiagnostics(_emitMode: string): Diagnostic[] { return []; }
}
