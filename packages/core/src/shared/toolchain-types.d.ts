/**
 * GCC-style error regex (used by arduino-cli, platformio, gcc)
 */
export declare const GCC_STYLE: RegExp;
/**
 * Arduino-style error regex (sometimes missing column)
 */
export declare const ARDUINO_ERROR: RegExp;
/**
 * Clang-style error regex
 */
export declare const CLANG_ERROR: RegExp;
/**
 * Compile error structure
 */
export interface CompileError {
    filePath: string;
    line: number;
    column: number;
    severity: "error" | "warning" | "note";
    message: string;
}
/**
 * Result of an Arduino sketch compilation
 */
export interface ArduinoCompileResult {
    success: boolean;
    output: string;
    errors: CompileError[];
}
/**
 * Result of an Arduino sketch upload
 */
export interface ArduinoUploadResult {
    success: boolean;
    output: string;
}
/**
 * Parse compile errors from output (GCC, Arduino, and Clang formats)
 */
export declare function parseCompileErrors(output: string, sketchDir?: string): CompileError[];
/**
 * Collect all .cpp files in a directory (non-recursive).
 * For recursive collection, use collectCppFilesRecursive.
 */
export declare function collectCppFiles(rootDir: string): string[];
/**
 * Extract architecture from FQBN string
 * FQBN format: vendor:arch:board[:config]
 * e.g., "arduino:avr:uno" -> "avr"
 */
export declare function toArchitectureFromFqbn(fqbn?: string): string | undefined;
//# sourceMappingURL=toolchain-types.d.ts.map