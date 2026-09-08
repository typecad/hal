import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Real package version (dist/utils/ui.js → ../../package.json). Previously
// hardcoded "0.1.0", which drifted from the published version and misled
// bug reports into blaming a stale global install.
const pkgPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "package.json",
);
const VERSION: string =
  JSON.parse(fs.readFileSync(pkgPath, "utf8")).version ?? "unknown";
export { VERSION };

// Icons
const ICON = "⤳";
const ICON_COMPILE = "⇉";
const ICON_UPLOAD = "↱";
const ICON_SUCCESS = "✓";
const ICON_ERROR = "✗";
const ICON_INFO = "•";
const ICON_MEMORY = " ";

/**
 * Print the typecad-hal branded header
 */
export function printHeader(): void {
  console.log();
  console.log(chalk.cyan(`${ICON} typecad-hal`) + chalk.gray(` v${VERSION}`));
  console.log();
}

/**
 * Print build configuration info
 */
export function printBuildInfo(options: {
  framework?: string;
  mcu?: string;
  board?: string;
  buildTarget?: string;
}): void {
  if (options.framework) {
    console.log(chalk.gray(`  ${ICON_INFO} Framework: `) + chalk.white(options.framework));
  }
  if (options.mcu) {
    console.log(chalk.gray(`  ${ICON_INFO} MCU: `) + chalk.white(options.mcu));
  }
  if (options.board) {
    console.log(chalk.gray(`  ${ICON_INFO} Board: `) + chalk.white(options.board));
  }
  if (options.buildTarget) {
    console.log(chalk.gray(`  • Build Target: `) + chalk.white(options.buildTarget));
  }
  if (options.framework || options.mcu || options.board || options.buildTarget) {
    console.log();
  }
}

/**
 * Print discovered tasks and timers
 */
export function printTasks(tasks: string[], usesTimers: boolean): void {
  if (tasks.length === 0 && !usesTimers) return;

  console.log(chalk.gray(`  ${ICON_INFO} Discovered Tasks:`));
  for (const task of tasks) {
    console.log(chalk.gray(`    Task:  `) + chalk.white(task));
  }
  if (usesTimers) {
    console.log(chalk.gray(`    Timer: `) + chalk.white(`Active (setInterval/setTimeout)`));
  }
  console.log();
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
  console.log(chalk.cyan(`${ICON} Transpiling...`));
}

/**
 * Print compiling step
 */
export function printCompiling(target: string): void {
  console.log(chalk.cyan(`${ICON_COMPILE} Compiling for `) + chalk.white(target));
}

/**
 * Print the debug-session strategy notice (debug builds only): which
 * framework's code-generation strategy is preparing the debug build.
 */
export function printDebugStrategy(framework: string): void {
  console.log(chalk.cyan(`${ICON_COMPILE} Preparing to debug using `) + chalk.white(framework));
}

/**
 * Print uploading step. Probe/USB flashing carries no serial port — the
 * destination is omitted rather than printed as "undefined".
 */
export function printUploading(port?: string): void {
  const destination = port ? chalk.cyan(" to ") + chalk.white(port) : "";
  console.log(chalk.cyan(`${ICON_UPLOAD} Uploading`) + destination);
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
  // Cyan (not green) so the completion marker matches the cyan step indicators
  // (⇉ Compiling / Uploading / Transpiling). The ✓ icon conveys success.
  console.log(chalk.cyan(`${ICON_SUCCESS} ${message}`));
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
  console.log(chalk.yellow(`! ${message}`));
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
 * Print memory usage info
 */
export function printMemoryUsage(usage: {
  flashUsed?: number;
  flashTotal?: number;
  ramUsed?: number;
  ramTotal?: number;
}): void {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const renderBar = (used: number, total: number) => {
    const percent = Math.round((used / total) * 100);
    const color = percent > 90 ? chalk.red : percent > 75 ? chalk.yellow : chalk.green;
    return color(`${percent}%`);
  };

  console.log(chalk.gray(`  ${ICON_MEMORY} Memory Usage:`));
  
  if (usage.flashUsed !== undefined && usage.flashTotal !== undefined) {
    console.log(
      chalk.gray(`    Flash: `) + 
      chalk.white(formatBytes(usage.flashUsed)) + 
      chalk.gray(` / ${formatBytes(usage.flashTotal)} (`) + 
      renderBar(usage.flashUsed, usage.flashTotal) + 
      chalk.gray(`)`)
    );
  }
  
  if (usage.ramUsed !== undefined && usage.ramTotal !== undefined) {
    console.log(
      chalk.gray(`    RAM:   `) + 
      chalk.white(formatBytes(usage.ramUsed)) + 
      chalk.gray(` / ${formatBytes(usage.ramTotal)} (`) + 
      renderBar(usage.ramUsed, usage.ramTotal) + 
      chalk.gray(`)`)
    );

    const free = usage.ramTotal - usage.ramUsed;
    console.log(
      chalk.gray(`    Heap:  `) + 
      chalk.white(formatBytes(free)) + 
      chalk.gray(` available`)
    );
  }
  console.log();
}
