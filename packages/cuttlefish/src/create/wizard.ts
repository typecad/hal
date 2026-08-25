import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import type { CreateProjectOptions } from "./templates.js";
import { KNOWN_TARGETS, KNOWN_MCUS, type KnownTarget } from "./scaffold.js";
import { frameworksForTarget, frameworkCatalogEntry, frameworkCompatibleWithTarget, FRAMEWORK_CATALOG, frameworkTargetProfile, probeMethodsForBoard } from './framework-catalog.js';
import {
  mcuAsTarget,
  findKnownMcu,
  mcuSupportsZephyr,
  zephyrBoardsForMcu,
  sanitizeBoardName,
  isValidFqbn,
  type McuCreateTarget,
} from './mcu-target.js';

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

export async function runCreateWizard(
  partialOptions?: {
    probe?: string;
    projectName?: string;
    board?: string;
    framework?: string;
    baud?: number;
    noSketch?: boolean;
  },
): Promise<CreateProjectOptions | null> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log();
    console.log(chalk.cyan("⤳ Cuttlefish") + chalk.dim(" — Project Setup"));
    console.log();

    // 1. Project name
    const projectName = partialOptions?.projectName
      ?? await promptText(rl, "Project name", "my-project", validateProjectName);

    // 2. Target selection (native first, then embedded boards, then bare MCUs)
    const targetOptions = [
      ...KNOWN_TARGETS.map((t: KnownTarget) => ({
        label: t.isNative
          ? `${t.displayName} (Windows/Linux executable)`
          : `${t.displayName} (${t.architecture!.toUpperCase()})`,
        value: t.id,
      })),
      ...KNOWN_MCUS.map((m) => ({
        label: `${m.displayName} — no board package (${m.architecture.toUpperCase()})`,
        value: `mcu:${m.id}`,
      })),
    ];

    let targetId: string;
    if (partialOptions?.board) {
      const found = KNOWN_TARGETS.find((t: KnownTarget) => t.id === partialOptions.board);
      const mcuFound = findKnownMcu(partialOptions.board);
      if (found) {
        targetId = found.id;
        console.log(`${chalk.cyan("?")} Target: ${chalk.white(found.displayName)} (${chalk.dim(partialOptions.board)})`);
      } else if (mcuFound) {
        targetId = `mcu:${mcuFound.id}`;
        console.log(`${chalk.cyan("?")} Target: ${chalk.white(mcuFound.displayName)} (${chalk.dim(partialOptions.board)})`);
      } else {
        console.log(`  ${chalk.yellow("!")} Target '${chalk.white(partialOptions.board)}' not found.`);
        targetId = await promptSelect(rl, "Target", targetOptions);
      }
    } else {
      targetId = await promptSelect(rl, "Target", targetOptions);
    }

    // MCU-only entries carry a `mcu:` prefix in the picker value space.
    const mcuEntry = targetId.startsWith("mcu:") ? findKnownMcu(targetId.slice(4)) : undefined;
    const target: KnownTarget = mcuEntry ? mcuAsTarget(mcuEntry) : KNOWN_TARGETS.find((t: KnownTarget) => t.id === targetId)!;
    const mcuTarget = mcuEntry ? (target as McuCreateTarget) : undefined;

    // 3. Framework. Narrow to the frameworks compatible with the selected board
    // (see framework-catalog), then let the user pick. The chosen package is
    // installed into the new project by `cuttlefish create`, so we offer every
    // compatible framework regardless of what is currently installed — no
    // require.resolve discovery (which also avoided an ESM `require` pitfall
    // where the lookup always failed and made the wizard dead-end).
    let framework = target.framework;
    let frameworkPackage = target.frameworkPackage;

    const compatible = frameworksForTarget(target)
      // MCU-only targets: Zephyr needs the package's silicon zephyr block
      // (custom-board generation + the board snapshot both key off its socs).
      .filter((f) => !mcuTarget || f.id !== 'zephyr' || mcuSupportsZephyr(mcuTarget))
      .filter((f) => f.installable);
    if (compatible.length === 0) {
      // Defensive: every known target maps to at least one framework in the catalog.
      throw new Error(`No installable frameworks are compatible with target '${target.id}'.`);
    }

    if (partialOptions?.framework) {
      const requested = frameworkCatalogEntry(partialOptions.framework);
      if (!requested) {
        const available = FRAMEWORK_CATALOG.filter(f => f.installable).map(f => f.id).join(", ");
        throw new Error(`Unknown framework '${partialOptions.framework}'. Available: ${available}`);
      }
      // Same compatibility guard as the non-interactive CLI path: a preseeded
      // --framework bypasses the narrowing below, so validate it explicitly.
      if (!frameworkCompatibleWithTarget(target, requested.id)) {
        const list = compatible.map(f => f.id).join(", ");
        throw new Error(
          `Framework '${requested.id}' is not compatible with target '${target.id}' (${target.displayName}). ` +
          `Compatible frameworks: ${list}`,
        );
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
    let buildTarget = profile.buildTarget ?? target.buildTarget;
    let zephyrCustomBoard = false;

    // MCU-only targets have no catalog build target — resolve one here.
    if (mcuTarget) {
      if (framework === 'zephyr') {
        const boards = zephyrBoardsForMcu(mcuTarget);
        const choice = await promptSelect(
          rl,
          `Zephyr board for the ${mcuTarget.displayName.split(' (')[0]}`,
          [
            { label: `Generate a custom board (${sanitizeBoardName(projectName)} — for hardware with no Zephyr board)`, value: 'custom' },
            { label: `Pick an existing Zephyr board (${boards.length} board${boards.length === 1 ? '' : 's'} use this SoC)`, value: 'existing' },
          ],
        );
        if (choice === 'custom') {
          buildTarget = sanitizeBoardName(projectName);
          zephyrCustomBoard = true;
          console.log(`  ${chalk.dim(`framework-zephyr generates boards/typecad/${buildTarget}/ at compile time`)}${' '}`);
        } else {
          buildTarget = await promptSelect(
            rl,
            `Board (${boards.length} — showing first 30)`,
            boards.slice(0, 30).map((b) => ({ label: `${b.name} (${b.vendor})`, value: b.target })),
          );
        }
      } else {
        // Arduino: the FQBN lives in the user's arduino-cli installation —
        // hand them the command and take the paste. Shape-validated here;
        // core presence is checked at first compile.
        console.log();
        console.log(`  ${chalk.cyan("i")} Find your board's FQBN in another terminal, e.g.:`);
        console.log(`      ${chalk.white("arduino-cli board search 'pro mini'")}   ${chalk.dim("(or: arduino-cli board listall)")}`);
        console.log(`  ${chalk.yellow("!")} The board must carry this exact MCU — the silicon pin map is per-chip.`);
        buildTarget = await promptText(
          rl,
          'Arduino FQBN',
          undefined,
          (v) => isValidFqbn(v) ? null : "Expected packager:architecture:board[:options] — e.g. arduino:avr:pro",
        );
      }
    }

    // 3.5 Probe method (Zephyr boards that ship a table). The probe in the
    // user's hand becomes the scaffolded zephyr.probe entry — it serves both
    // flashing and debugging; "board default" omits the section.
    let probeMethod: string | undefined;
    const probeMethods = framework === 'zephyr' ? probeMethodsForBoard(target.id) : [];
    if (probeMethods.length > 0) {
      if (partialOptions?.probe) {
        probeMethod = partialOptions.probe;
        console.log(`${chalk.cyan("?")} Probe method: ${chalk.white(probeMethod)}`);
      } else {
        const chosen = await promptSelect(
          rl,
          "Which probe will you attach to this board?",
          [
            ...probeMethods.map((m) => ({ label: `${m.id} — ${m.description}`, value: m.id })),
            { label: "board default (no zephyr.probe entry)", value: "" },
          ],
        );
        probeMethod = chosen === "" ? undefined : chosen;
      }
    }

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
      probeMethod,
      probeMethods,
      projectName,
      targetId: target.id,
      targetDisplayName: target.displayName,
      isNative: target.isNative,
      architecture: target.architecture,
      boardPackage: target.boardPackage,
      frameworkPackage: frameworkPackage ?? '',
      framework: framework ?? '',
      buildTarget,
      ...(profile.toolchainType ? { toolchainType: profile.toolchainType } : {}),
      mcu: target.mcu,
      ...(mcuTarget ? { sketchPin: mcuTarget.sketchPin } : {}),
      ...(zephyrCustomBoard ? { zephyrCustomBoard: true } : {}),
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
