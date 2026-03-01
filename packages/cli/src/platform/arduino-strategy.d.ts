import type { PlatformStrategy } from "./platform-strategy";
import type { ExpressionIR, ProgramIR } from "../ir/model";
import type { Diagnostic, PlatformContext } from "../types";
import type { BoardConstants } from "../ir/board-resolver";
import type { TypecodeReceiverKind } from "../ir/typecode-symbols";
export declare class ArduinoStrategy implements PlatformStrategy {
    readonly id = "arduino";
    /**
     * Allows the emitter to inform this strategy which enums have large values
     * so that static_cast uses `long` instead of `int`.
     */
    setLargeEnumNames(names: ReadonlySet<string>): void;
    forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[];
    symbolAliases(program: ProgramIR, ctx?: PlatformContext): Record<string, string>;
    shimLines(program: ProgramIR, ctx?: PlatformContext): string[];
    profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[];
    sourceExtension(isEntryFile: boolean, isNpmPackage: boolean): string;
    entrypointFunctionName(): string;
    requiresLoopFunction(): boolean;
    overrideBaseName(originalBaseName: string, outDirBaseName: string, isEntryFile: boolean, isNpmPackage: boolean): string;
    effectiveEmitMode(_requestedMode: string, isNpmPackage: boolean): string;
    normalizeCppType(typeName: string): string;
    mapReturnType(functionName: string, returnType: string): string;
    mapFunctionName(originalName: string): string;
    normalizeRawExpression(value: string): string;
    nullValue(): string;
    wrapStringConcat(leftRendered: string, rightRendered: string, leftIsString: boolean): string | undefined;
    renameEnumMember(_enumName: string, memberName: string): string;
    enumCastType(enumName: string): string | undefined;
    tryRenderTypecodeCall(receiver: string, receiverKind: TypecodeReceiverKind, method: string, args: ReadonlyArray<ExpressionIR>, renderArg: (e: ExpressionIR) => string, boardConstants?: BoardConstants): string | undefined;
    renderBoardDefinitionAccess(chain: string[], boardConstants?: BoardConstants): string | undefined;
    tryRenderCallStatement(callee: string, args: ReadonlyArray<ExpressionIR>, renderArg: (e: ExpressionIR) => string, boardConstants?: BoardConstants): string | undefined;
    renderThrow(_valueExpr: string): string;
    transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string;
    objectFieldInitializer(fieldValue: ExpressionIR, _renderExpr: (e: ExpressionIR) => string): string | undefined;
    overrideClassFieldType(fieldName: string, normalizedType: string): string;
    reservedNames(): ReadonlySet<string>;
    apiReservedEnumNames(): ReadonlySet<string>;
    apiReservedEnumGuard(): string;
    needsIostream(): boolean;
    needsStdString(): boolean;
    needsStdVector(): boolean;
    needsStdExcept(): boolean;
    mathHeader(): string;
    needsVectorOverload(): boolean;
    needsLargeEnumUnderlying(): boolean;
    renameStructField(fieldName: string): string;
    structFieldInitializer(fieldValue: ExpressionIR, compiletimeVarNames: Set<string>, _renderExpr: (e: ExpressionIR) => string): string | undefined;
    asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean): string[];
    asyncDriverFunctionName(): string;
    shouldSkipTypeAlias(cppType: string): boolean;
    emitDiagnostics(emitMode: string): Diagnostic[];
}
//# sourceMappingURL=arduino-strategy.d.ts.map