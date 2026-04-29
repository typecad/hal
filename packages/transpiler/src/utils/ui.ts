import chalk from "chalk";

const VERSION = "0.1.0";

// Icons
const ICON_TYPEHAL = "⤳";
const ICON_COMPILE = "⇉";
const ICON_UPLOAD = "↱";
const ICON_SUCCESS = "✓";
const ICON_ERROR = "✗";
const ICON_INFO = "•";

/**
 * Print the typeHAL branded header
 */
export function printHeader(): void {
  console.log();
  console.log(chalk.cyan(`${ICON_TYPEHAL} typeHAL`) + chalk.gray(` v${VERSION}`));
  console.log();
}

/**
 * Print build configuration info
 */
export function printBuildInfo(options: {
  framework?: string;
  board?: string;
  buildTarget?: string;
}): void {
  if (options.framework) {
    console.log(chalk.gray(`  ${ICON_INFO} Framework: `) + chalk.white(options.framework));
  }
  if (options.board) {
    console.log(chalk.gray(`  ${ICON_INFO} Board: `) + chalk.white(options.board));
  }
  if (options.buildTarget) {
    console.log(chalk.gray(`  • Build Target: `) + chalk.white(options.buildTarget));
  }
  if (options.framework || options.board || options.buildTarget) {
    console.log();
  }
}

/**
 * Print a step notification (transpiling, compiling, etc.)
 */
export function printStep(message: string): void {
  console.log(chalk.cyan(`${ICON_COMPILE} ${message}`));
}

/**
 * Print transpiling step
 */
export function printTranspiling(): void {
  console.log(chalk.cyan(`${ICON_TYPEHAL} Transpiling...`));
}

/**
 * Print compiling step
 */
export function printCompiling(target: string): void {
  console.log(chalk.cyan(`${ICON_COMPILE} Compiling for `) + chalk.white(target));
}

/**
 * Print uploading step
 */
export function printUploading(port: string): void {
  console.log(chalk.cyan(`${ICON_UPLOAD} Uploading to `) + chalk.white(port));
}

/**
 * Print monitoring step
 */
export function printMonitoring(port: string, baud: number): void {
  console.log(chalk.cyan(`${ICON_UPLOAD} Monitor `) + chalk.white(`${port} @ ${baud} baud`));
  console.log(chalk.gray(`  Press Ctrl+C to exit`));
}

/**
 * Print success message
 */
export function printSuccess(message: string = "Done"): void {
  console.log(chalk.green(`${ICON_SUCCESS} ${message}`));
}

/**
 * Print error message
 */
export function printError(message: string): void {
  console.log(chalk.red(`${ICON_ERROR} ${message}`));
}

/**
 * Print warning message
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow(`${ICON_ERROR} ${message}`));
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(chalk.gray(`  ${ICON_INFO} ${message}`));
}

/**
 * Print a file creation notification (for scaffold commands)
 */
export function printFileCreated(filePath: string): void {
  console.log(chalk.gray(`  ${ICON_SUCCESS} ${filePath}`));
}

/**
 * Print a section header
 */
export function printSection(title: string): void {
  console.log();
  console.log(chalk.cyan(`${ICON_TYPEHAL} ${title}`));
}