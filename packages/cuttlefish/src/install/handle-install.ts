// `cuttlefish install` — installs a chosen @typecad/framework-* package into the
// current project. The flow asks which board to target first, then narrows the
// framework choices to those compatible with that board (see framework-catalog).
// A framework id may be passed directly (`cuttlefish install arduino`) to skip
// the prompts entirely, which also makes the command usable in CI.

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import chalk from "chalk";
import type { InstallCommandOptions } from "../types.js";
import { KNOWN_TARGETS, type KnownTarget } from "../create/index.js";
import {
  FRAMEWORK_CATALOG,
  frameworkCatalogEntry,
  frameworksForTarget,
  detectPackageManager,
  buildInstallCommand,
  type FrameworkCatalogEntry,
  type PackageManager,
} from "./framework-catalog.js";

type ReadlineInterface = ReturnType<typeof readline.createInterface>;

// ── prompts (mirror the create wizard's style for a consistent UX) ──────────

async function promptSelect(
  rl: ReadlineInterface,
  prompt: string,
  options: Array<{ label: string; value: string }>,
): Promise<string> {
  console.log(`${chalk.cyan("?")} ${prompt}:`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${chalk.dim(`${i + 1})`)} ${options[i]!.label}`);
  }
  while (true) {
    const answer = await rl.question(`  Enter number (1-${options.length}): `);
    const idx = parseInt(answer.trim(), 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx]!.value;
    }
    console.log(`  ${chalk.red("✗")} Please enter a number between 1 and ${options.length}.`);
  }
}

async function selectBoardInteractively(rl: ReadlineInterface): Promise<KnownTarget> {
  const options = KNOWN_TARGETS.map((t) => ({
    label: t.isNative
      ? `${t.displayName} (Windows/Linux executable)`
      : `${t.displayName} (${t.architecture!.toUpperCase()})`,
    value: t.id,
  }));
  const selectedId = await promptSelect(rl, "Target board", options);
  return KNOWN_TARGETS.find((t) => t.id === selectedId)!;
}

/**
 * Pick a framework for `target`. When only one framework is compatible with the
 * board it is auto-selected (mirrors the create wizard's single-option path) so
 * the user isn't asked a question with one answer.
 */
async function selectFrameworkInteractively(
  rl: ReadlineInterface,
  target: KnownTarget,
  compatible: FrameworkCatalogEntry[],
): Promise<FrameworkCatalogEntry> {
  if (compatible.length === 1) {
    const only = compatible[0]!;
    console.log(`${chalk.cyan("?")} Framework: ${chalk.white(only.label)} ${chalk.dim(`(only option for ${target.id})`)}`);
    return only;
  }
  const selectedId = await promptSelect(
    rl,
    "Framework",
    compatible.map((f) => ({ label: f.label, value: f.id })),
  );
  return compatible.find((f) => f.id === selectedId)!;
}

// ── package-manager spawn, with a for-test override hook ────────────────────
// Mirrors the arduino-cli probe's pattern (packages/arduino-cli/src/probe.ts):
// the real executor runs `spawnSync` with inherited stdio so the user sees live
// install progress; tests inject a fake runner so no real process is spawned.

interface InstallCommand {
  bin: string;
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
export function __setInstallRunnerForTest(runner: InstallRunner | undefined): void {
  testRunner = runner;
}

function runRealInstall(cmd: InstallCommand): InstallRunResult {
  // stdio: "inherit" streams the package manager's own output to the terminal
  // (install progress, deprecation warnings, etc.). On failure the user has
  // already seen the details above, so we only need to report the exit code.
  const result: SpawnSyncReturns<Buffer> = spawnSync(cmd.bin, cmd.args, {
    cwd: cmd.cwd,
    stdio: "inherit",
  });
  if (result.error) {
    const errno = (result.error as NodeJS.ErrnoException).code;
    return {
      status: null,
      launchError: errno === "ENOENT" ? `'${cmd.bin}' not found on PATH` : String(result.error),
    };
  }
  return { status: result.status };
}

export interface InstallResult {
  pm: PackageManager;
  bin: string;
  args: string[];
}

/**
 * Resolve the package manager and run the install for `entry`'s package. In
 * dry-run mode the command is printed but not executed. Throws on launch
 * failure or non-zero exit so the CLI surfaces a clear error.
 */
export function installFrameworkPackage(
  entry: FrameworkCatalogEntry,
  opts: { cwd: string; dryRun?: boolean },
): InstallResult {
  const pm = detectPackageManager(opts.cwd);
  const { bin, args } = buildInstallCommand(pm, entry.packageName);

  if (opts.dryRun) {
    console.log(`${chalk.cyan("$")} ${bin} ${args.join(" ")}`);
    return { pm, bin, args };
  }

  const cmd: InstallCommand = { bin, args, cwd: opts.cwd };
  const run = testRunner ?? runRealInstall;
  const result = run(cmd);
  if (result.launchError) {
    throw new Error(`Failed to run '${bin}': ${result.launchError}`);
  }
  if (result.status !== 0) {
    throw new Error(`'${bin} ${args.join(" ")}' exited with code ${result.status}. See the package manager output above for details.`);
  }
  return { pm, bin, args };
}

// ── command entry point ─────────────────────────────────────────────────────

export async function handleInstall(options: InstallCommandOptions): Promise<void> {
  const cwd = process.cwd();

  // 1. Resolve which framework to install.
  let entry: FrameworkCatalogEntry;
  if (options.framework) {
    const resolved = frameworkCatalogEntry(options.framework);
    if (!resolved) {
      const available = FRAMEWORK_CATALOG.filter((f) => f.installable).map((f) => f.id).join(", ");
      throw new Error(`Unknown framework '${options.framework}'. Available: ${available}`);
    }
    if (!resolved.installable) {
      throw new Error(`Framework '${options.framework}' has no published package yet and cannot be installed.`);
    }
    entry = resolved;
    console.log(`${chalk.cyan("?")} Framework: ${chalk.white(entry.label)}`);
  } else {
    // Resolve the target board. --board skips the board prompt; otherwise the
    // board is chosen interactively (which requires a TTY — handled below).
    let target: KnownTarget | undefined;
    if (options.board) {
      const found = KNOWN_TARGETS.find((t) => t.id === options.board);
      if (!found) {
        const available = KNOWN_TARGETS.map((t) => t.id).join(", ");
        throw new Error(`Unknown board '${options.board}'. Available: ${available}`);
      }
      target = found;
      console.log(`${chalk.cyan("?")} Board: ${chalk.white(target.displayName)} (${chalk.dim(target.id)})`);
    }

    // Narrow to the frameworks compatible with that board.
    let compatible: FrameworkCatalogEntry[] | undefined;
    if (target) {
      compatible = frameworksForTarget(target).filter((f) => f.installable);
      if (compatible.length === 0) {
        throw new Error(`No installable frameworks are compatible with board '${target.id}'.`);
      }
    }

    if (compatible && compatible.length === 1) {
      // Only one framework fits this board — auto-select it (no prompt, so this
      // path also works under CI / non-interactive stdin).
      entry = compatible[0]!;
      console.log(
        `${chalk.cyan("?")} Framework: ${chalk.white(entry.label)} ${chalk.dim(`(only option for ${target!.id})`)}`,
      );
    } else {
      // Need to prompt — for the board (if --board wasn't given) and/or for the
      // framework (when 2+ are compatible). Refuse to hang on a readline that
      // can't be answered (e.g. piped stdin under CI).
      if (!process.stdin.isTTY) {
        throw new Error(
          "No framework specified and stdin is not interactive. " +
            "Pass a framework id (e.g. 'cuttlefish install arduino'), " +
            "or a board with a single compatible framework (e.g. '--board arduino-uno').",
        );
      }

      const rl = readline.createInterface({ input, output });
      try {
        if (!target) {
          target = await selectBoardInteractively(rl);
          compatible = frameworksForTarget(target).filter((f) => f.installable);
          if (compatible.length === 0) {
            throw new Error(`No installable frameworks are compatible with board '${target.id}'.`);
          }
        }
        entry = await selectFrameworkInteractively(rl, target, compatible!);
      } finally {
        rl.close();
      }
    }
  }

  // 2. Install it.
  console.log(`\n${chalk.cyan("⤳")} Installing ${chalk.white(entry.packageName)} into ${chalk.dim(cwd)}…`);
  const result = installFrameworkPackage(entry, { cwd, dryRun: options.dryRun });
  if (options.dryRun) {
    console.log(chalk.dim("(dry-run — nothing was installed)"));
    return;
  }
  console.log(`\n${chalk.green("✓")} Installed ${chalk.white(entry.packageName)} via ${result.pm}.`);
  console.log(
    chalk.dim(
      `Next: run 'cuttlefish create' and pick ${entry.id}, or set framework: "${entry.packageName}" in cuttlefish.config.ts.`,
    ),
  );
}
