import type {
  TargetProfile as CoreTargetProfile,
  PlatformContext as CorePlatformContext,
  SourceSpan as CoreSourceSpan,
  Diagnostic as CoreDiagnostic,
} from "./api/shared/index.js";

export type EmitMode = "cpp" | "split";

export type TargetProfile = CoreTargetProfile;
export type PlatformContext = CorePlatformContext;
export type SourceSpan = CoreSourceSpan;

export interface SourceMapEntry {
  generatedStartLine: number;
  generatedStartColumn: number;
  generatedEndLine: number;
  generatedEndColumn: number;
  tsSpan: SourceSpan;
  nodeKind: string;
  symbolName?: string;
}

export interface GeneratedSourceMap {
  version: 1;
  generatedFilePath: string;
  sourceFilePath: string;
  entries: SourceMapEntry[];
}

export interface MappedDiagnostic {
  cppFilePath: string;
  cppLine: number;
  cppColumn: number;
  message?: string;
  mappedTsSpan?: SourceSpan;
  nodeKind?: string;
  symbolName?: string;
}

export type Diagnostic = CoreDiagnostic;

export interface TreeShakingOptions {
  /** Enable tree-shaking (default: true) */
  enabled?: boolean;
  /** Keep enums even if not referenced (default: false) */
  keepUnusedEnums?: boolean;
  /** Keep classes even if not instantiated (default: false) */
  keepUnusedClasses?: boolean;
  /** Keep type aliases even if not used (default: false) */
  keepUnusedTypeAliases?: boolean;
  /** Keep top-level variables even if not referenced (default: false) */
  keepUnusedVariables?: boolean;
  /** Generate diagnostics for removed code (default: true) */
  reportUnused?: boolean;
  /** Additional symbols to treat as entry points */
  entryPoints?: string[];
}

export interface TranspileOptions {
  inputFile: string;
  outDir?: string;
  emitMode: EmitMode;
  target: TargetProfile;
  emitMaps: boolean;
  platformContext?: PlatformContext;
  /** Tree-shaking options for dead code elimination */
  treeShaking?: TreeShakingOptions;
  /**
   * Board package specifier resolved from `cuttlefish.config.ts`.
   * When present, `@typecad/board` imports are rewritten to this package
   * (e.g. `'@typecad/board-arduino-uno'`).
   */
  boardPackage?: string;
  /**
   * Framework package for code generation strategy.
   * Can be any framework package path, e.g. '@typecad/framework-arduino',
   * '@typecad/framework-avr', or a custom local path.
   * When not specified, the GenericStrategy (standard C++) is used.
   */
  frameworkPackage?: string;
  /** Enable debug mode - inject breakpoint instrumentation */
  debug?: boolean;
  /** Skip TypeScript type-checking before transpilation (default: false) */
  skipTypeCheck?: boolean;
  /**
   * Skip ESLint checks before transpilation (default: false).
   * When false, ESLint errors in the user's `src/` abort the build, matching
   * the type-check behavior. Mirrors `skipTypeCheck`.
   */
  skipLint?: boolean;
  /**
   * The user's project root — the directory containing `cuttlefish.config.ts`.
   * The ESLint gate looks for `.cuttlefish/eslint.config.mjs` (or a root-level
   * `eslint.config.mjs`) here, not under `src/`. When omitted, the entry file's
   * directory is used as a fallback (suitable for ad-hoc API/test callers that
   * pass a bare input file outside a configured project).
   */
  projectRoot?: string;
  /**
   * Force retranspilation of all files, ignoring incremental cache.
   * Currently a no-op: incremental builds are disabled and every build already
   * transpiles the full graph. Retained on the API for forward compatibility.
   * (default: false)
   */
  force?: boolean;
  /** Generate diagnostics.md and diagnostics.json reports (default: false) */
  diagnostics?: boolean;
  /** Display profile config from cuttlefish.config.ts */
  display?: import("./api/shared/display-profile.js").DisplayConfig;
}

export interface LibraryDefinitionCondition {
  target?: TargetProfile;
  architecture?: string;
  core?: string;
  fqbnIncludes?: string;
}

interface LibraryDefinitionVariant {
  when: LibraryDefinitionCondition;
  include: string;
  symbols?: Record<string, string>;
}

export interface LibraryDefinition {
  module: string;
  include: string;
  symbols?: Record<string, string>;
  variants?: LibraryDefinitionVariant[];
}

export interface CommandLineOptions {
  command: "default" | "build" | "gen-libdefs" | "gen-decls" | "map-error" | "preview" | "doctor";
  inputFile?: string;
  emitMode: EmitMode;
  target: TargetProfile;
  outDir?: string;
  emitMaps: boolean;
  /** Skip transpilation (use existing generated files) */
  noTranspile: boolean;
  /** Compile using the framework toolchain after transpilation */
  compile: boolean;
  /** Upload using the framework toolchain after compilation (requires compile) */
  upload: boolean;
  /** Open serial monitor after upload */
  monitor: boolean;
  /** Serial port for upload and monitor (e.g. COM4 or /dev/ttyACM0) */
  port?: string;
  /** Baud rate for monitor (default: 9600) */
  baud: number;
  platformContext?: PlatformContext;
  mapFile?: string;
  cppFile?: string;
  cppLine?: number;
  cppColumn?: number;
  message?: string;
  /** Tree-shaking options */
  treeShaking?: TreeShakingOptions;
  /**
   * Board package specifier resolved from `cuttlefish.config.ts`.
   * When present, `@typecad/board` imports are rewritten to this package.
   */
  boardPackage?: string;
  /**
   * Framework package for code generation strategy.
   * Can be '@typecad/framework-arduino', '@typecad/framework-avr', or a custom path.
   */
  frameworkPackage?: string;
  /** Enable debug mode - inject breakpoint instrumentation */
  debug?: boolean;
  /** Skip TypeScript type-checking before transpilation */
  skipTypeCheck?: boolean;
  /** Force retranspilation of all files, ignoring cache. Currently a no-op: incremental builds are disabled. */
  force?: boolean;
  /** Watch for file changes and retranspile automatically */
  watch: boolean;
  /** Run hardware tests via @typecad/expect */
  expect?: boolean;
  /** Optional test file path filter for --expect */
  expectFile?: string;
  /** Generate diagnostics.md and diagnostics.json reports */
  diagnostics?: boolean;
  /** Config file for preview command */
  configPath?: string;
  /** Project root (dir of cuttlefish.config.ts); passed to transpileFile for the ESLint gate. */
  projectRoot?: string;
}

export interface GenerateLibdefOptions {
  inputFile: string;
  outDir: string;
}

export interface GeneratedOutputs {
  headerPath?: string;
  sourcePath: string;
  headerMapPath?: string;
  sourceMapPath?: string;
  diagnostics: Diagnostic[];
  asyncTaskNames?: string[];
  usesTimers?: boolean;
  /** Path to the diagnostics.md report, if --diagnostics was passed. */
  diagnosticsReportPath?: string;
}

interface CompileErrorEntry {
  filePath: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "note";
  message: string;
}

export interface CompileResultType {
  success: boolean;
  output: string;
  errors: CompileErrorEntry[];
}

export interface UploadResultType {
  success: boolean;
  output: string;
}

export interface CreateCommandOptions {
  command: "create";
  projectName?: string;
  /** @deprecated Use target */
  board?: string;
  target?: string;
  framework?: string;
  baud?: number;
  noSketch?: boolean;
  outDir?: string;
}

export interface BoardAddCommandOptions {
  command: "board-add";
  specPath: string;
  force?: boolean;
}
