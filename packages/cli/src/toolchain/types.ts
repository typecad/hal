// ---------------------------------------------------------------------------
// Toolchain types — interfaces for compile/upload backends
//
// A toolchain handles the compilation and upload process for a specific
// build system (arduino-cli, platformio, etc.).
// ---------------------------------------------------------------------------

/** Error information from compilation. */
export interface CompileError {
  filePath: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

/** Result from a compile operation. */
export interface CompileResult {
  success: boolean;
  output: string;
  errors: CompileError[];
}

/** Result from an upload operation. */
export interface UploadResult {
  success: boolean;
  output: string;
}

/** Options for compilation. */
export interface CompileOptions {
  /** Path to the sketch/source file. */
  sketchPath: string;
  /** Fully Qualified Board Name (e.g. 'arduino:avr:uno'). */
  fqbn: string;
  /** Optimization level. */
  optimize?: 'none' | 'size' | 'speed' | 'balanced';
  /** Preprocessor defines. */
  defines?: Record<string, string>;
  /** Extra compiler flags. */
  extraFlags?: string[];
  /** Build directory for output. */
  buildDir?: string;
}

/** Options for upload. */
export interface UploadOptions {
  /** Directory containing the sketch. */
  sketchDir: string;
  /** Fully Qualified Board Name. */
  fqbn: string;
  /** Serial port for upload. */
  port: string;
}

/** Options for serial monitor. */
export interface MonitorOptions {
  /** Serial port. */
  port: string;
  /** Baud rate. */
  baud: number;
}

/**
 * Toolchain interface — abstracts compile/upload operations.
 * Implementations: ArduinoCliToolchain, PlatformioToolchain.
 */
export interface Toolchain {
  /** Unique identifier for this toolchain. */
  readonly id: 'arduino-cli' | 'platformio';

  /** Human-readable name. */
  readonly name: string;

  // ── Availability ────────────────────────────────────────────────────────

  /**
   * Check if this toolchain is installed and available.
   * Returns the path to the executable if found, undefined otherwise.
   */
  isInstalled(): Promise<string | undefined>;

  // ── Core operations ─────────────────────────────────────────────────────

  /**
   * Compile a sketch/project for the target board.
   */
  compile(options: CompileOptions): Promise<CompileResult>;

  /**
   * Upload compiled firmware to the target board.
   */
  upload(options: UploadOptions): Promise<UploadResult>;

  /**
   * Open a serial monitor connection.
   * This typically blocks until the user closes it.
   */
  monitor?(options: MonitorOptions): Promise<void>;

  // ── Board management ────────────────────────────────────────────────────

  /**
   * List available serial ports.
   */
  listPorts?(): Promise<Array<{ port: string; description?: string }>>;

  /**
   * Check if a board core is installed for the given FQBN.
   */
  hasBoardCore?(fqbn: string): Promise<boolean>;

  /**
   * Install a board core for the given FQBN.
   */
  installBoardCore?(fqbn: string): Promise<void>;
}

/**
 * Resolved toolchain configuration from typecode.config.ts.
 */
export interface ResolvedToolchainConfig {
  /** Toolchain type. */
  type: 'arduino-cli' | 'platformio';
  /** Path to executable (if specified). */
  path?: string;
  /** Arduino CLI specific options. */
  arduinoCli?: {
    configFile?: string;
    verbose?: boolean;
  };
  /** PlatformIO specific options. */
  platformio?: {
    env?: string;
  };
}