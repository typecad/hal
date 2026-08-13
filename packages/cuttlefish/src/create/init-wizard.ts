import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import type { InitProjectOptions } from "./init-templates.js";
import { KNOWN_TARGETS, type KnownTarget } from "./init-scaffold.js";
import { frameworksForTarget, frameworkCatalogEntry, FRAMEWORK_CATALOG, frameworkTargetProfile } from "./framework-catalog.js";

type ReadlineInterface = ReturnType<typeof readline.createInterface>;

function validateProjectName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return "Project name cannot be empty.";
  }
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(normalized)) {
    return "Project name must start with a letter and contain only lowercase letters, digits, and hyphens.";
  }
  if (normalized.length > 64) {
    return "Project name must be 64 characters or fewer.";
  }
  return null;
}

async function promptText(
  rl: ReadlineInterface,
  prompt: string,
  defaultValue?: string,
  validate?: (value: string) => string | null,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = await rl.question(`${chalk.cyan("?")} ${prompt}${suffix}: `);
    const value = (answer.trim() || (defaultValue ?? "")).trim();

    if (validate) {
      const error = validate(value);
      if (error) {
        console.log(`  ${chalk.red("✗")} ${error}`);
        continue;
      }
    }
    return value;
  }
}

async function promptSelect(
  rl: ReadlineInterface,
  prompt: string,
  options: Array<{ label: string; value: string }>,
): Promise<string> {
  console.log(`${chalk.cyan("?")} ${prompt}:`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${chalk.dim(`${i + 1})`)} ${options[i].label}`);
  }

  while (true) {
    const answer = await rl.question(`  Enter number (1-${options.length}): `);
    const idx = parseInt(answer.trim(), 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx].value;
    }
    console.log(`  ${chalk.red("✗")} Please enter a number between 1 and ${options.length}.`);
  }
}

async function promptConfirm(
  rl: ReadlineInterface,
  prompt: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? " (Y/n)" : " (y/N)";
  const answer = await rl.question(`${chalk.cyan("?")} ${prompt}${suffix}: `);
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") return defaultValue;
  return trimmed === "y" || trimmed === "yes";
}

export async function runInitWizard(
  partialOptions?: {
    projectName?: string;
    board?: string;
    framework?: string;
    baud?: number;
    noSketch?: boolean;
  },
): Promise<InitProjectOptions | null> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log();
    console.log(chalk.cyan("⤳ Cuttlefish") + chalk.dim(" — Project Setup"));
    console.log();

    // 1. Project name
    const projectName = partialOptions?.projectName
      ?? await promptText(rl, "Project name", "my-project", validateProjectName);

    // 2. Target selection (native first, then embedded boards)
    const targetOptions = KNOWN_TARGETS.map((t: KnownTarget) => ({
      label: t.isNative
        ? `${t.displayName} (Windows/Linux executable)`
        : `${t.displayName} (${t.architecture!.toUpperCase()})`,
      value: t.id,
    }));

    let targetId: string;
    if (partialOptions?.board) {
      const found = KNOWN_TARGETS.find((t: KnownTarget) => t.id === partialOptions.board);
      if (found) {
        targetId = found.id;
        console.log(`${chalk.cyan("?")} Target: ${chalk.white(found.displayName)} (${chalk.dim(partialOptions.board)})`);
      } else {
        console.log(`  ${chalk.yellow("!")} Target '${chalk.white(partialOptions.board)}' not found.`);
        targetId = await promptSelect(rl, "Target", targetOptions);
      }
    } else {
      targetId = await promptSelect(rl, "Target", targetOptions);
    }

    const target = KNOWN_TARGETS.find((t: KnownTarget) => t.id === targetId)!;

    // 3. Framework. Narrow to the frameworks compatible with the selected board
    // (see framework-catalog), then let the user pick. The chosen package is
    // installed into the new project by `cuttlefish create`, so we offer every
    // compatible framework regardless of what is currently installed — no
    // require.resolve discovery (which also avoided an ESM `require` pitfall
    // where the lookup always failed and made the wizard dead-end).
    let framework = target.framework;
    let frameworkPackage = target.frameworkPackage;

    const compatible = frameworksForTarget(target).filter((f) => f.installable);
    if (compatible.length === 0) {
      // Defensive: every known target maps to at least one framework in the catalog.
      throw new Error(`No installable frameworks are compatible with target '${target.id}'.`);
    }

    if (partialOptions?.framework) {
      const requested = frameworkCatalogEntry(partialOptions.framework);
      if (!requested) {
        const available = FRAMEWORK_CATALOG.filter((f) => f.installable).map((f) => f.id).join(", ");
        throw new Error(`Unknown framework '${partialOptions.framework}'. Available: ${available}`);
      }
      framework = requested.id;
      frameworkPackage = requested.packageName;
      console.log(`${chalk.cyan("?")} Framework: ${chalk.white(requested.label)}`);
    } else if (compatible.length === 1) {
      framework = compatible[0]!.id;
      frameworkPackage = compatible[0]!.packageName;
      console.log(`${chalk.cyan("?")} Framework: ${chalk.white(compatible[0]!.label)}`);
    } else {
      const selected = await promptSelect(
        rl,
        "Framework",
        compatible.map((f) => ({ label: f.label, value: f.id })),
      );
      const match = compatible.find((f) => f.id === selected)!;
      framework = match.id;
      frameworkPackage = match.packageName;
    }

    // Resolve the framework-specific build target + toolchain (e.g. a Zephyr
    // board id + 'west' vs the Arduino FQBN + 'arduino-cli'). See framework-catalog.
    const profile = frameworkTargetProfile(target, framework);

    // 4. Baud rate (only for embedded)
    let baudRate: number | undefined;
    if (!target.isNative) {
      if (partialOptions?.baud) {
        baudRate = partialOptions.baud;
        console.log(`${chalk.cyan("?")} Serial baud rate: ${chalk.white(baudRate)}`);
      } else {
        const baudAnswer = await promptText(rl, "Serial baud rate", "9600");
        baudRate = parseInt(baudAnswer, 10);
        if (Number.isNaN(baudRate) || baudRate <= 0) {
          baudRate = 9600;
          console.log(`  ${chalk.dim("Using default: 9600")}`);
        }
      }
    }

    // 5. Starter sketch
    let includeSketch: boolean;
    if (partialOptions?.noSketch) {
      includeSketch = false;
      console.log(`${chalk.cyan("?")} Create starter sketch: ${chalk.dim("no")}`);
    } else if (partialOptions?.noSketch === false) {
      includeSketch = true;
      console.log(`${chalk.cyan("?")} Create starter sketch: ${chalk.green("yes")}`);
    } else {
      includeSketch = await promptConfirm(rl, "Create starter sketch?", true);
    }

    return {
      projectName,
      targetId: target.id,
      targetDisplayName: target.displayName,
      isNative: target.isNative,
      architecture: target.architecture,
      boardPackage: target.boardPackage,
      frameworkPackage: frameworkPackage ?? '',
      framework: framework ?? '',
      buildTarget: profile.buildTarget ?? target.buildTarget,
      ...(profile.toolchainType ? { toolchainType: profile.toolchainType } : {}),
      mcu: target.mcu,
      baudRate,
      includeSketch,
      ...(target.frameworkData
        ? { frameworkData: target.frameworkData }
        : {}),
    };
  } catch (err) {
    if (err && typeof err === 'object' && (err as any).code === 'ERR_USE_AFTER_CLOSE') {
      return null;
    }
    throw err;
  } finally {
    rl.close();
  }
}
