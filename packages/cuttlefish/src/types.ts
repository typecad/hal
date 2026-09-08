import type {
  TargetProfile as CoreTargetProfile,
  PlatformContext as CorePlatformContext,
  SourceSpan as CoreSourceSpan,
  Diagnostic as CoreDiagnostic,
} from "./api/shared/index.js";

export type EmitMode = "cpp" | "split";

export type ComplianceMode = "off" | "warn" | "strict";

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
   * Zephyr board target resolved from `typecad-hal.config.ts` (e.g.
   * `'esp32s3_devkitc/esp32s3/procpu'`). When a generated board module is
   * absent, `@typecad/hal` imports resolve through the real package.
   */
  boardTarget?: string;
  /**
   * Framework package for code generation strategy.
   * Can be any framework package path, e.g. '@typecad/framework-zephyr',
   * '@typecad/framework-native', or a custom local path.
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
   * The user's project root — the directory containing `typecad-hal.config.ts`.
   * The ESLint gate looks for `.typecad-hal/eslint.config.mjs` (or a root-level
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
  /** Display profile config from typecad-hal.config.ts */
  display?: import("./api/shared/display-profile.js").DisplayConfig;
  /** AUTOSAR C++14 compliance mode for emitted code (default: "off"). */
  autosar?: ComplianceMode;
  /** When true (and autosar is warn/strict), also emit the .autosar-deviations.arxml sidecar. */
  autosarArxml?: boolean;
  /** Upgrade UI CSS-compatibility warnings (css-* diagnostics) to errors. */
  strictCss?: boolean;
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
  command: "default" | "build" | "gen-decls" | "preview" | "doctor" | "licenses";
  /** For `licenses`: treat unknown/missing licenses as failures (exit 1). */
  strict?: boolean;
  /** For `licenses`: scan all installed libraries (default: this project's only). */
  all?: boolean;
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
  /** One-off probe-method override (a board probeMethods id) for --upload
   *  and --debug. Wins over zephyr.probe in typecad-hal.config.ts; Zephyr-only. */
  probe?: string;
  /** Baud rate for monitor. Undefined when --baud is absent so the consumer
   *  can fall through to the framework monitor default. */
  baud?: number;
  platformContext?: PlatformContext;
  /** Tree-shaking options */
  treeShaking?: TreeShakingOptions;
  /**
   * Board package specifier resolved from `typecad-hal.config.ts`.
   * When present, `@typecad/hal` imports are rewritten to this package.
   */
  boardTarget?: string;
  /**
   * Framework package for code generation strategy.
   * Can be '@typecad/framework-zephyr', '@typecad/framework-native', or a custom path.
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
  /** Run hardware tests via the built-in test-runner (typecad-hal test) */
  expect?: boolean;
  /** Optional test file path filter for --expect */
  expectFile?: string;
  /** Generate diagnostics.md and diagnostics.json reports */
  diagnostics?: boolean;
  /** AUTOSAR C++14 compliance mode for emitted code (default: "off"). */
  autosar?: ComplianceMode;
  /** When true (and autosar is warn/strict), also emit the .autosar-deviations.arxml sidecar. */
  autosarArxml?: boolean;
  /** Upgrade UI CSS-compatibility warnings (css-* diagnostics) to errors. */
  strictCss?: boolean;
  /** Config file for preview command */
  configPath?: string;
  /** Project root (dir of typecad-hal.config.ts); passed to transpileFile for the ESLint gate. */
  projectRoot?: string;
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
  noStarter?: boolean;
  outDir?: string;
  /** Skip the automatic `npm install` in the scaffolded project. */
  noInstall?: boolean;
  /** Probe method id (board probeMethods table) — skips the wizard question
   * and writes zephyr.probe into the scaffolded config. Zephyr-only. */
  probe?: string;
  /** Serial port the board is attached to (COMx / /dev/tty*) — skips the
   * wizard question and seeds test.port in the config. */
  port?: string;
}

/** Parsed `typecad-hal board <subcommand>` options. */
export interface BoardCommandOptions {
  command: "board";
  subcommand: "regen" | "sync";
  /** sync: optional explicit Zephyr checkout path to walk. */
  zephyrBase?: string;
}

/** Parsed `typecad-hal clean` options. */
export interface CleanCommandOptions {
  command: "clean";
  /** Override the output dir (absolute) — wins over the config's output.outDir. */
  outDir?: string;
  /** Override the entry file (absolute) — its dir anchors relative outDir resolution. */
  entry?: string;
  /** Remove an existing output dir even without the generated-dir marker. */
  force?: boolean;
}

/** Parsed `typecad-hal debug-server <start|stop>` options. */
export interface DebugServerCommandOptions {
  command: "debug-server";
  action: "start" | "stop";
  /** start: run the full build pipeline (transpile → compile → upload, with
   *  --debug) before serving — the F5 preLaunchTask is ONE background task. */
  flash?: boolean;
}

/** Parsed `cuttlefish test` options — everything after the subcommand is
 *  forwarded verbatim to the hardware test-runner CLI (typecad-hal test). */
export interface TestCommandOptions {
  command: "test";
  forwarded: string[];
}

/** Parsed `typecad-hal library <subcommand>` options. */
export interface LibraryCommandOptions {
  command: "library";
  subcommand: "search" | "install" | "init" | "validate";
  /** Non-flag tokens after the subcommand: search text, install names, init name, validate path. */
  positionals: string[];
  /** search: taxonomy category id. */
  category?: string;
  /** init: framework id from the framework catalog. */
  framework?: string;
  /** init: comma-separated board-target prefixes. */
  targets?: string;
  /** init: scaffold directory (default ./<library-id>). */
  dir?: string;
  /** init: skip prompts, take defaults. */
  yes?: boolean;
  /** Machine-readable output for search/validate. */
  json?: boolean;
}
