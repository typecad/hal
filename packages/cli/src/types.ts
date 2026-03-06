export type EmitMode = "cpp" | "split";
export type TargetProfile = "generic" | "arduino" | (string & {});

export interface ArduinoPlatformContext {
  fqbn?: string;
}

export interface PlatformContext {
  arduino?: ArduinoPlatformContext;
  console?: {
    baudRate?: number;
  };
  [key: string]: unknown;
}

export interface SourceSpan {
  filePath: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

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

export interface Diagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  line?: number;
  column?: number;
  code?: string;
}

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
   * Board package specifier resolved from `typecode.config.ts`.
   * When present, bare `@typecode` imports are rewritten to this package
   * (e.g. `'@typecode/board-arduino-uno'`).
   */
  boardPackage?: string;
  /** Enable debug mode - inject breakpoint instrumentation */
  debug?: boolean;
  /** Skip TypeScript type-checking before transpilation (default: false) */
  skipTypeCheck?: boolean;
}

export interface LibraryDefinitionCondition {
  target?: TargetProfile;
  architecture?: string;
  core?: string;
  fqbnIncludes?: string;
}

export interface LibraryDefinitionVariant {
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
  command: "default" | "gen-libdefs" | "gen-decls" | "map-error";
  inputFile?: string;
  emitMode: EmitMode;
  target: TargetProfile;
  outDir?: string;
  emitMaps: boolean;
  /** Skip transpilation (use existing generated files) */
  noTranspile: boolean;
  /** Run arduino-cli compile after transpilation */
  compile: boolean;
  /** Run arduino-cli upload after compilation (requires compile) */
  upload: boolean;
  /** Run arduino-cli monitor after upload */
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
   * Board package specifier resolved from `typecode.config.ts`.
   * When present, bare `@typecode` imports are rewritten to this package.
   */
  boardPackage?: string;
  /** Enable debug mode - inject breakpoint instrumentation */
  debug?: boolean;
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

export interface ArduinoCompileError {
  filePath: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "note";
  message: string;
}

export interface ArduinoCompileResult {
  success: boolean;
  output: string;
  errors: ArduinoCompileError[];
}

export interface ArduinoUploadResult {
  success: boolean;
  output: string;
}
