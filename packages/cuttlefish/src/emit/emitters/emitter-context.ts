import type { ProgramIR, ExpressionIR, StatementIR, ParameterIR } from "../../api";
import type { PlatformStrategy, RuntimePolyfillIR } from "../../api/shared";
import type { ProgramAnalysisResult } from "../../ir/program-analysis";
import type { EmissionScopeState } from "../snprintf-helpers";
import type { ExpressionRenderer } from "../expression-renderer";
import type { StatementRenderer } from "../statement-renderer";
import type { Diagnostic, EmitMode, SourceMapEntry, SourceSpan } from "../../types";
import type { ResolvedNpmPackage } from "../../transpile/resolution";
import type { BoardConstants } from "../../ir/board-resolver";
import type { LibraryDefinition } from "../../types";

/** Options controlling C++ emission. */
export interface EmitterOptions {
  outDir: string;
  emitMode: EmitMode;
  target: string;
  libdefs: Map<string, LibraryDefinition>;
  emitMaps: boolean;
  platformContext?: Record<string, unknown>;
  npmPackage?: ResolvedNpmPackage;
  npmPackages?: Map<string, ResolvedNpmPackage>;
  isEntryFile?: boolean;
  strategy?: PlatformStrategy;
  nativeModules?: Map<string, { declPath: string; cppPath: string; moduleKey: string }>;
  crossModuleClasses?: Set<string>;
  crossModuleClassFieldTypes?: Map<string, Map<string, string>>;
  crossModuleFunctionReturnTypes?: Map<string, string>;
  crossModuleEnumNames?: Set<string>;
  crossModuleStringEnumNames?: Set<string>;
  crossModuleVariableTypes?: Map<string, string>;
}

export interface MappedFunction {
  name: string;
  returnType: string;
  sourceSpan: SourceSpan;
  leadingComments?: string[];
  trailingComments?: string[];
  parameters: ParameterIR[];
  isAsync?: boolean;
  typeParameters?: string[];
  typeParameterConstraints?: Map<string, string>;
  isReadonlyReturnType?: boolean;
  isGenerator?: boolean;
  isExported?: boolean;
  statements: StatementIR[];
}

export interface CallbackFunction {
  name: string;
  params: string[];
  statements: StatementIR[];
  debounceMs?: number;
  /**
   * Return type of the synthesized free function. Defaults to "void" (the
   * historical ISR/HAL-callback case). Populated from a hoisted lambda's
   * return-type annotation so a `(x): int16_t => {...}` callback lowers to
   * `int16_t name(int16_t)` rather than `void name()`.
   */
  returnType?: string;
  /**
   * Typed parameters of the synthesized free function, carrying both the C++
   * type and the name. Defaults to [] (the void() ISR case). Populated from a
   * hoisted lambda's typed params. Used both to render the signature and to
   * seed the body's emission scope so the params are resolvable.
   */
  typedParams?: { name: string; cppType: string }[];
}

export interface AsyncTaskClass {
  classDef: string;
  instanceDecl: string;
  taskVarName: string;
}

export interface FixPointerFieldAccessFn {
  (callee: string): string;
}

/**
 * Shared state bag passed between all sub-emitter steps.
 */
export interface EmitterContext {
  // ── Resolved once during setup phase ──────────────────────────────────────
  program: ProgramIR;
  options: EmitterOptions;
  strategy: PlatformStrategy;
  programAnalysis: ProgramAnalysisResult;
  enumNames: Set<string>;
  stringEnumNames: Set<string>;
  largeEnumNames: Set<string>;
  namespaceNames: Set<string>;
  symbolMap: Record<string, string>;
  includes: string[];
  shimLines: string[];
  baseName: string;
  effectiveEmitMode: EmitMode;
  isEntryFile: boolean;
  isNpmPackage: boolean;
  isrPrefix: string;
  reservedNames: ReadonlySet<string>;
  knownFunctionReturnTypes: Map<string, string>;
  mappedFunctions: MappedFunction[];
  topLevelScope: EmissionScopeState;
  snprintfCounter: { value: number };
  stringVarNames: Set<string>;
  varAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">>;
  exprRenderer: ExpressionRenderer;
  statementRenderer: StatementRenderer;
  classNameMap?: Map<string, string>;
  boardConstants?: BoardConstants;
  restParamFunctions?: Map<string, string>;

  // ── Computed during setup / async ─────────────────────────────────────────
  asyncTaskClasses: AsyncTaskClass[];
  asyncFunctionOriginalNames: Set<string>;
  asyncFunctionMappedNames: Set<string>;
  hasAsyncRuntime: boolean;
  hasPromiseRuntime: boolean;
  usesTimers: boolean;
  emittedPolyfills?: { declarations: string[]; definitions: string[]; includes: string[] };

  // ── Line buffers + source map state ───────────────────────────────────────
  sourceLines: string[];
  headerLines: string[];
  sourceMapEntries: SourceMapEntry[];
  headerMapEntries: SourceMapEntry[];

  // ── Mutable per-function state for C-array tracking ───────────────────────
  cArrayVarNames: Set<string>;
  fnCArrayVarNames: Map<string, Set<string>>;

  // ── Computed during top-level preprocessing ───────────────────────────────
  globalPointerVarTypes: Map<string, string>;
  promotedVarDecls: Map<string, { cppType: string; index: number }>;
  callbackFunctions: CallbackFunction[];
  filteredTopLevelExecutables: StatementIR[];
  filteredTopLevelDeclarations: StatementIR[];
  emittedTopLevelStatements: StatementIR[];
  compiletimeVarNames: Set<string>;
  fixPointerFieldAccess: FixPointerFieldAccessFn;
  knownTopLevelObjectTypes: Map<string, string>;
  knownTopLevelObjectFields: Map<string, Map<string, string>>;

  // ── Mutable per-class state for pointer field tracking ────────────────────
  currentClassPointerFields?: string[];
  currentClassPointerFieldTypes?: Map<string, string>;

  // ── Profile diagnostics ───────────────────────────────────────────────────
  profileDiagnostics: Diagnostic[];

  // ── Interface pre-scan data ───────────────────────────────────────────────
  templateInterfaceNames: Set<string>;
  interfaceNamespaceMap: Map<string, string>;
  /** Map of interface name to its field types (e.g., "Task" -> Map("id" -> "std::string", "title" -> "std::string")) */
  interfaceFieldTypes: Map<string, Map<string, string>>;
}
