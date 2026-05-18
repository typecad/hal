import type { ProgramIR, ExpressionIR, StatementIR } from "@typehal/core";
import type { PlatformStrategy, RuntimePolyfillIR } from "@typehal/core/shared";
import type { ProgramAnalysisResult } from "../../ir/program-analysis";
import type { EmissionScopeState } from "../snprintf-helpers";
import type { ExpressionRenderer } from "../expression-renderer";
import type { StatementRenderer } from "../statement-renderer";
import type { Diagnostic, EmitMode, SourceMapEntry } from "../../types";
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
  platformContext?: any;
  npmPackage?: ResolvedNpmPackage;
  npmPackages?: Map<string, ResolvedNpmPackage>;
  isEntryFile?: boolean;
  strategy?: PlatformStrategy;
  nativeModules?: Map<string, { declPath: string; cppPath: string; moduleKey: string }>;
  crossModuleClasses?: Set<string>;
}

export interface MappedFunction {
  name: string;
  returnType: string;
  sourceSpan: any;
  leadingComments?: string[];
  trailingComments?: string[];
  parameters: any[];
  isAsync?: boolean;
  typeParameters?: string[];
  typeParameterConstraints?: Map<string, string>;
  isReadonlyReturnType?: boolean;
  statements: StatementIR[];
}

export interface CallbackFunction {
  name: string;
  params: string[];
  statements: StatementIR[];
  debounceMs?: number;
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
  platformReservedNames: ReadonlySet<string>;
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

  // ── Profile diagnostics ───────────────────────────────────────────────────
  profileDiagnostics: Diagnostic[];

  // ── Interface pre-scan data ───────────────────────────────────────────────
  templateInterfaceNames: Set<string>;
  interfaceNamespaceMap: Map<string, string>;
}
