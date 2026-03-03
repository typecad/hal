// ---------------------------------------------------------------------------
// types.ts — Toolchain interface and common types
//
// Defines the contract that all toolchain implementations must follow.
// ---------------------------------------------------------------------------

/**
 * Compile error with source location information.
 */
export interface CompileError {
  /** Absolute file path */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Error severity */
  severity: 'error' | 'warning' | 'note';
  /** Error message */
  message: string;
}

/**
 * Options for compile operations.
 */
export interface CompileOptions {
  /** Path to the main .ino sketch file */
  sketchPath: string;
  /** Fully Qualified Board Name (e.g., 'arduino:avr:uno') */
  fqbn: string;
  /** Optimization level */
  optimize?: 'size' | 'speed' | 'debug' | 'none';
  /** Preprocessor defines */
  defines?: Record<string, string | number>;
  /** Extra compiler flags */
  extraFlags?: string[];
  /** Include directories */
  includeDirs?: string[];
}

/**
 * Result of a compile operation.
 */
export interface CompileResult {
  /** Whether compilation succeeded */
  success: boolean;
  /** Raw compiler output */
  output: string;
  /** Parsed errors (if any) */
  errors: CompileError[];
  /** Path to compiled binary (if successful) */
  binaryPath?: string;
}

/**
 * Options for upload operations.
 */
export interface UploadOptions {
  /** Directory containing the sketch */
  sketchDir: string;
  /** Fully Qualified Board Name */
  fqbn: string;
  /** Serial port to upload to */
  port: string;
  /** Verify after upload */
  verify?: boolean;
}

/**
 * Result of an upload operation.
 */
export interface UploadResult {
  /** Whether upload succeeded */
  success: boolean;
  /** Raw uploader output */
  output: string;
}

/**
 * Options for serial monitor operations.
 */
export interface MonitorOptions {
  /** Serial port to connect to */
  port: string;
  /** Baud rate */
  baud: number;
}

/**
 * Information about a serial port.
 */
export interface PortInfo {
  /** Port address (e.g., 'COM3', '/dev/ttyUSB0') */
  port: string;
  /** Port description */
  description?: string;
  /** Connected board info (if detected) */
  board?: {
    name?: string;
    fqbn?: string;
  };
}

/**
 * Toolchain interface - all toolchains must implement this.
 */
export interface Toolchain {
  /** Unique identifier for this toolchain */
  readonly id: 'arduino-cli' | 'platformio' | string;
  
  /** Human-readable name */
  readonly name: string;

  /**
   * Check if the toolchain is installed and available.
   * @returns Path to the executable if installed, undefined otherwise
   */
  isInstalled(): Promise<string | undefined>;

  /**
   * Compile a sketch for the target board.
   */
  compile(options: CompileOptions): Promise<CompileResult>;

  /**
   * Upload compiled firmware to the target board.
   */
  upload(options: UploadOptions): Promise<UploadResult>;

  /**
   * Open a serial monitor connection.
   * This method blocks until the monitor is closed.
   */
  monitor?(options: MonitorOptions): Promise<void>;

  /**
   * List available serial ports.
   */
  listPorts?(): Promise<PortInfo[]>;

  /**
   * Check if a board core is installed.
   */
  hasBoardCore?(fqbn: string): Promise<boolean>;

  /**
   * Install a board core.
   */
  installBoardCore?(fqbn: string): Promise<void>;
}

/**
 * Configuration for toolchain selection.
 */
export interface ToolchainConfig {
  /** Toolchain type */
  type?: 'arduino-cli' | 'platformio';
  /** Arduino CLI specific options */
  arduinoCli?: {
    path?: string;
    configFile?: string;
    verbose?: boolean;
  };
  /** PlatformIO specific options */
  platformio?: {
    path?: string;
    env?: string;
  };
}