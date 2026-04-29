import type {
  TargetProfile as CoreTargetProfile,
  PlatformContext as CorePlatformContext,
  SourceSpan as CoreSourceSpan,
  Diagnostic as CoreDiagnostic,
} from "@typehal/core/shared";

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
   * Board package specifier resolved from `typehal.config.ts`.
   * When present, bare `@typehal` imports are rewritten to this package
   * (e.g. `'@typehal/board-arduino-uno'`).
   */
  boardPackage?: string;
  /**
   * Framework package for code generation strategy.
   * Can be any framework package path, e.g. '@typehal/framework-arduino',
   * '@typehal/framework-avr', or a custom local path.
   * When not specified, the GenericStrategy (standard C++) is used.
   */
  frameworkPackage?: string;
  /** Enable debug mode - inject breakpoint instrumentation */
  debug?: boolean;
  /** Skip TypeScript type-checking before transpilation (default: false) */
  skipTypeCheck?: boolean;
  /**
   * Force retranspilation of all files, ignoring incremental cache.
   * (default: false)
   */
  force?: boolean;
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
  command: "default" | "build" | "gen-libdefs" | "gen-decls" | "map-error" | "create-board" | "init";
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
   * Board package specifier resolved from `typehal.config.ts`.
   * When present, bare `@typehal` imports are rewritten to this package.
   */
  boardPackage?: string;
  /**
   * Framework package for code generation strategy.
   * Can be '@typehal/framework-arduino', '@typehal/framework-avr', or a custom path.
   */
  frameworkPackage?: string;
  /** Enable debug mode - inject breakpoint instrumentation */
  debug?: boolean;
  /** Skip TypeScript type-checking before transpilation */
  skipTypeCheck?: boolean;
  /** Force retranspilation of all files, ignoring cache */
  force?: boolean;
  /** Watch for file changes and retranspile automatically */
  watch: boolean;
  /** Run hardware tests via @typehal/expect */
  expect?: boolean;
  /** Optional test file path filter for --expect */
  expectFile?: string;
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

// ---------------------------------------------------------------------------
// Scaffold command options (create-board)
// ---------------------------------------------------------------------------

export interface ScaffoldCommandOptions {
  command: "create-board";
  /** Board name (e.g., 'my-custom-board') */
  name: string;
  /** Display name (e.g., 'My Custom Board') */
  displayName?: string;
  /** Vendor name */
  vendor?: string;
  /** Architecture identifier */
  architecture?: string;
  /** MCU part number */
  mcu?: string;
  /** Clock speed in MHz */
  clockSpeedMhz?: number;
  /** Flash size in KB */
  flashKb?: number;
  /** SRAM size in KB */
  sramKb?: number;
  /** EEPROM size in KB */
  eepromKb?: number;
  /** Build Target Identifier (e.g. FQBN for Arduino) */
  buildTarget?: string;
  /** Output directory */
  outDir?: string;
  /** Generate minimal package */
  minimal?: boolean;
}

// ---------------------------------------------------------------------------
// Init command options (project scaffolding)
// ---------------------------------------------------------------------------

export interface InitCommandOptions {
  command: "init";
  /** Project name (e.g., 'my-blink') */
  projectName?: string;
  /** Board identifier from the built-in registry (e.g., 'arduino-uno') */
  board?: string;
  /** Framework: 'arduino' or 'avr' */
  framework?: string;
  /** Serial baud rate for console/monitor */
  baud?: number;
  /** Skip generating the starter sketch */
  noSketch?: boolean;
  /** Output directory (default: ./<projectName>) */
  outDir?: string;
}
