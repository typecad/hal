export type EmitMode = "cpp" | "split";
export type TargetProfile = "generic" | "arduino";

export interface ArduinoPlatformContext {
  fqbn?: string;
  architecture?: "avr" | "esp32" | "samd" | "rp2040" | string;
  core?: string;
  variant?: string;
  arduinoCliJsonPath?: string;
}

export interface PlatformContext {
  arduino?: ArduinoPlatformContext;
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
  enabled: boolean;
  /** Keep enums even if not referenced (default: false) */
  keepUnusedEnums?: boolean;
  /** Keep classes even if not instantiated (default: false) */
  keepUnusedClasses?: boolean;
  /** Keep type aliases even if not used (default: false) */
  keepUnusedTypeAliases?: boolean;
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
  compileArduino: false | true | "strict";
  platformContext?: PlatformContext;
  /** Tree-shaking options for dead code elimination */
  treeShaking?: TreeShakingOptions;
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
  command: "transpile" | "gen-libdefs" | "gen-types" | "map-error";
  inputFile?: string;
  emitMode: EmitMode;
  target: TargetProfile;
  outDir?: string;
  emitMaps: boolean;
  compileArduino: false | true | "strict";
  platformContext?: PlatformContext;
  mapFile?: string;
  cppFile?: string;
  cppLine?: number;
  cppColumn?: number;
  message?: string;
  /** Tree-shaking options */
  treeShaking?: TreeShakingOptions;
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
