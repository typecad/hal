import type { ProgramIR, ExpressionIR, StatementIR, ParameterIR } from "../../api/index.js";
import type { PlatformStrategy, RuntimePolyfillIR } from "../../api/shared/index.js";
import type { ProgramAnalysisResult } from "../../ir/program-analysis.js";
import type { EmissionScopeState } from "../snprintf-helpers.js";
import type { ExpressionRenderer } from "../expression-renderer.js";
import type { StatementRenderer } from "../statement-renderer.js";
import type { Diagnostic, EmitMode, ComplianceMode, SourceMapEntry, SourceSpan } from "../../types.js";
import type { ResolvedNpmPackage } from "../../transpile/resolution.js";
import type { BoardConstants } from "../../ir/board-resolver.js";
import type { LibraryDefinition } from "../../types.js";
import type { ComplianceContext } from "../compliance/compliance-context.js";

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
  /** Getters/setters declared on classes in OTHER files, keyed by class name.
   * Lets `obj.getter` access rewrite to `obj->getX()`/`Cls::getX()` even when
   * the class is imported (demo #14 Finding E — cross-file getter access). */
  crossModuleClassAccessors?: Map<string, Map<string, "getter" | "setter" | "both">>;
  crossModuleFunctionReturnTypes?: Map<string, string>;
  crossModuleEnumNames?: Set<string>;
  crossModuleStringEnumNames?: Set<string>;
  crossModuleVariableTypes?: Map<string, string>;
  /** AUTOSAR C++14 compliance mode. Default 'off' — feature is opt-in. */
  autosar?: ComplianceMode;
  /** Tool version, written into the sidecar deviation registry. */
  toolVersion?: string;
  /** When true (and autosar is warn/strict), also write the .autosar-deviations.arxml sidecar. */
  autosarArxml?: boolean;
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
   * True for GPIO / hardware ISR callbacks only. WiFi event handlers, timers,
   * and setInterval use the same hoist path but must NOT get IRAM_ATTR.
   */
  isInterruptHandler?: boolean;
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
  /** Async methods: the starter-function DEFINITION (binds the owner and
   *  arms the task). Emitted after the task class; the matching prototype
   *  (asyncMethodStarters) precedes the owning class. */
  starterDef?: string;
}

/** Forward prototypes for async-method starters — emitted before the class
 *  definitions whose method bodies call them. */
export interface AsyncMethodStarter {
  /** The `void __tc_async_start_<Class>_<method>(<Class>*);` prototype. */
  proto: string;
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
  /**
   * Names of non-exported free functions that are CALLED from at least one
   * class method body (a getter/setter/method/constructor). In split mode an
   * inline class method body lives in the header, so such a function must be
   * visible in the header too — otherwise the method body sees
   * "'fn' was not declared in this scope". These functions are therefore
   * emitted non-static with a header prototype (like exported functions).
   * Demo #18 Finding B.
   */
  freeFunctionsCalledFromClassMethods: Set<string>;
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
  asyncMethodStarters: AsyncMethodStarter[];
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

  // ── GDB debug mode (line directives) ──────────────────────────────────────
  /**
   * Active debug mode. When 'gdb', appendSourceLine emits `#line` markers
   * before lines whose TS source span transitions. 'printf' = no markers.
   * Resolved once from strategy.debugMode(buildTarget) during setup.
   */
  debugMode: 'gdb' | 'printf';
  /**
   * The {filePath, line} of the most recently emitted linemarker, or null if
   * none yet. Used by appendSourceLine for transition detection.
   */
  lastEmittedSource: { filePath: string; line: number } | null;

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

  /**
   * Diagnostics produced during emission (e.g. an unregistered HAL operation
   * the strategy couldn't resolve, surfaced as a warning). Kept separate from
   * profileDiagnostics for clarity; merged into the final diagnostics list by
   * finalizeOutput. Shared by reference with ExpressionRenderer /
   * StatementRenderer so their fallback paths can report without throwing.
   */
  emitDiagnostics: Diagnostic[];

  // ── Interface pre-scan data ───────────────────────────────────────────────
  templateInterfaceNames: Set<string>;
  interfaceNamespaceMap: Map<string, string>;
  /** Map of interface name to its field types (e.g., "Task" -> Map("id" -> "std::string", "title" -> "std::string")) */
  interfaceFieldTypes: Map<string, Map<string, string>>;

  // ── AUTOSAR C++14 compliance (emit-time enforcement + deviations) ────────
  compliance: ComplianceContext;
}
