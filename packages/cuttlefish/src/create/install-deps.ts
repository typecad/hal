// Installs all dependencies in a freshly scaffolded project directory, as the
// final step of `typecad-hal create` so the new project is ready to build with
// no separate `npm install` step. The package manager is detected from the
// INVOKING directory (process.cwd()) — a pnpm/yarn user gets their tool of
// choice even though the new project has no lockfile yet.

import { spawnSync } from "node:child_process";
import { detectPackageManager, type PackageManager } from "./framework-catalog.js";

export interface ProjectInstallResult {
  pm: PackageManager;
}

interface InstallCommand {
  bin: PackageManager;
  args: string[];
  cwd: string;
}

interface InstallRunResult {
  /** Exit status; null when the process could not be launched (ENOENT, etc.). */
  status: number | null;
  /** Populated only when the binary could not be launched. */
  launchError?: string;
}

type InstallRunner = (cmd: InstallCommand) => InstallRunResult;

let testRunner: InstallRunner | undefined;

/**
 * FOR TESTS ONLY. Replaces the real spawn-based installer with `runner`.
 * Pass `undefined` to restore the real executor.
 */
export function __setProjectInstallRunnerForTest(runner: InstallRunner | undefined): void {
  testRunner = runner;
}

function runRealInstall(cmd: InstallCommand): InstallRunResult {
  // stdio: "inherit" streams the package manager's own output to the terminal
  // (install progress, deprecation warnings, etc.).
  const result = spawnSync(cmd.bin, cmd.args, { cwd: cmd.cwd, stdio: "inherit" });
  if (result.error) {
    const errno = (result.error as NodeJS.ErrnoException).code;
    return {
      status: null,
      launchError: errno === "ENOENT" ? `'${cmd.bin}' not found on PATH` : String(result.error),
    };
  }
  return { status: result.status };
}

/**
 * Run `<pm> install` in `projectDir`. Throws on launch failure or non-zero exit
 * so the create command can catch it and fall back to instructing the user to
 * run the install manually (the scaffold itself already succeeded).
 */
export function installProjectDependencies(opts: {
  projectDir: string;
  /** Where to detect the user's preferred package manager. Defaults to cwd. */
  cwd?: string;
}): ProjectInstallResult {
  const pm = detectPackageManager(opts.cwd ?? process.cwd());
  const cmd: InstallCommand = { bin: pm, args: ["install"], cwd: opts.projectDir };
  const run = testRunner ?? runRealInstall;
  const result = run(cmd);
  if (result.launchError) {
    throw new Error(`Failed to run '${pm}': ${result.launchError}`);
  }
  if (result.status !== 0) {
    throw new Error(`'${pm} install' exited with code ${result.status}.`);
  }
  return { pm };
}
