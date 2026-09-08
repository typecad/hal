import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import chalk from "chalk";
import type { CreateProjectOptions } from "./templates.js";
import { KNOWN_TARGETS, type KnownTarget } from "./scaffold.js";
import { findPackBoard, packBoardAsTarget } from "./pack-targets.js";
import { pickTarget } from "./board-search.js";
import { activeBoardCatalog } from "../board-catalog/index.js";
import { frameworksForTarget, frameworkCatalogEntry, frameworkCompatibleWithTarget, FRAMEWORK_CATALOG, frameworkTargetProfile, probeMethodsForBoard, probeRunnerQuirks } from './framework-catalog.js';

type ReadlineInterface = ReturnType<typeof readline.createInterface>;

/**
 * Attached serial ports for the wizard's port question — dependency-free
 * (the wizard runs before any project deps exist, and cuttlefish itself
 * carries no native serialport binding). Windows asks the .NET SerialPort
 * class via PowerShell; macOS/Linux scan /dev for USB CDC/bridge nodes.
 * Returns [] when enumeration fails — the question then falls back to a
 * free-text prompt with the platform hint as default.
 */
export function detectSerialPorts(): string[] {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        "[System.IO.Ports.SerialPort]::GetPortNames() -join ','",
        { shell: "powershell.exe", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
      ).toString();
      return out.split(",").map((s) => s.trim()).filter((s) => /^[Cc][Oo][Mm]\d+$/.test(s));
    }
    const dev = readdirSync("/dev");
    return dev
      .filter((n) => /^tty(ACM|USB)/.test(n) || /^cu\.(usb|USB|modem)/.test(n))
      .map((n) => (process.platform === "darwin" ? `/dev/${n}` : `/dev/${n}`))
      .sort();
  } catch {
    return [];
  }
}

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
    port?: string;
    projectName?: string;
    board?: string;
    framework?: string;
    baud?: number;
    noStarter?: boolean;
  },
): Promise<CreateProjectOptions | null> {
  let rl = readline.createInterface({ input, output });

  try {
    console.log();
    console.log(chalk.cyan("⤳ Cuttlefish") + chalk.dim(" — Project Setup"));
    console.log();

    // 1. Project name
    const projectName = partialOptions?.projectName
      ?? await promptText(rl, "Project name", "my-project", validateProjectName);

    // 2. Target selection — the filterable board picker covers everything:
    //    native, bare silicon (soc entries), and every Zephyr board from the
    //    catalog. One search box, no two-stage list. A preseeded --board that
    //    resolves skips the picker entirely.
    let packBoard: { identifier: string; name: string; soc: string } | undefined;
    let foundTarget: KnownTarget | undefined;
    if (partialOptions?.board) {
      const found = KNOWN_TARGETS.find((t: KnownTarget) => t.id === partialOptions.board);
      const packFound = found ? undefined : findPackBoard(partialOptions.board);
      if (found) {
        foundTarget = found;
        console.log(`${chalk.cyan("?")} Target: ${chalk.white(found.displayName)} (${chalk.dim(partialOptions.board)})`);
      } else if (packFound) {
        packBoard = packFound;
        console.log(`${chalk.cyan("?")} Target: ${chalk.white(packFound.name)} (${chalk.dim(packFound.identifier)})`);
      }
    }
    if (Object.keys(activeBoardCatalog()).length === 0) {
      console.log(`  ${chalk.yellow("!")} No board catalog on this machine — the catalog is generated`);
      console.log(`    from your Zephyr tree. Run the installer or 'typecad-hal board sync' to`);
      console.log(`    list boards; a preseeded --board <target> still works and validates at`);
      console.log(`    the first build.`);
    }
    if (!foundTarget && !packBoard) {
      // Close the readline interface for the filterable select (it owns
      // stdin in raw mode), then recreate it for the remaining prompts.
      // Closing a readline pauses stdin; resume it so the select's internal
      // readline receives character bytes (arrow keys arrive via keypress
      // events either way, but typed characters need flowing mode).
      rl.close();
      input.resume();
      const pick = await pickTarget();
      rl = readline.createInterface({ input, output });
      if (!pick) {
        console.log(`  ${chalk.yellow("!")} Target selection cancelled.`);
        return null;
      }
      if (pick.kind === 'native') {
        foundTarget = KNOWN_TARGETS.find((t: KnownTarget) => t.isNative);
      } else if (pick.kind === 'mcu') {
        // Bare-silicon targets were removed with the curated soc layer.
        console.log(`  ${chalk.yellow("!")} Bare-silicon targets no longer exist — pick a board from the catalog.`);
      } else {
        packBoard = pick.entry;
        console.log(`${chalk.cyan("?")} Target: ${chalk.white(pick.entry.name)} (${chalk.dim(pick.entry.identifier)})`);
      }
    }

    const target: KnownTarget = packBoard
      ? packBoardAsTarget(packBoard)
      : foundTarget!;

    // 3. Framework. Narrow to the frameworks compatible with the selected board
    // (see framework-catalog), then let the user pick. The chosen package is
    // installed into the new project by `typecad-hal create`, so we offer every
    // compatible framework regardless of what is currently installed — no
    // require.resolve discovery (which also avoided an ESM `require` pitfall
    // where the lookup always failed and made the wizard dead-end).
    let framework = target.framework;
    let frameworkPackage = target.frameworkPackage;

    const compatible = frameworksForTarget(target)
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

    // Resolve the framework-specific build target + toolchain (the Zephyr
    // board id + 'west'). See framework-catalog.
    const profile = frameworkTargetProfile(target, framework);
    let buildTarget = profile.buildTarget ?? target.buildTarget;
    let zephyrCustomBoard = false;

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
    // Board-catalog quirk for the chosen probe (e.g. an srst-based openocd.cfg
    // behind a debug header with no NRST) — baked into the scaffolded
    // config's runnerArgs so the first flash works.
    const probeRunnerArgs = probeMethod ? probeRunnerQuirks(target.id, probeMethod) : [];

    // 4. Serial port (only for embedded) — the port the board rides on.
    // Detected ports are offered as a choice; the answer seeds test.port in
    // the scaffolded config (no more guessing COM4). "skip" leaves the
    // platform-hint placeholder.
    let serialPort: string | undefined;
    if (!target.isNative) {
      if (partialOptions?.port) {
        serialPort = partialOptions.port;
        console.log(`${chalk.cyan("?")} Serial port: ${chalk.white(serialPort)}`);
      } else {
        const detected = detectSerialPorts();
        if (detected.length > 0) {
          const chosenPort = await promptSelect(
            rl,
            "Which serial port is the board attached to?",
            [
              ...detected.map((p) => ({ label: p, value: p })),
              { label: "not listed / set later (type a path)", value: "__other__" },
              { label: "skip — use the placeholder, configure later", value: "" },
            ],
          );
          serialPort = chosenPort === "" ? undefined
            : chosenPort === "__other__" ? await promptText(rl, "Serial port path", detected[0])
            : chosenPort;
        } else {
          const hint = process.platform === "win32" ? "COM4" : "/dev/ttyACM0";
          const typed = await promptText(rl, "Serial port (none detected — plug the board in, or type a path)", hint);
          serialPort = typed === hint ? undefined : typed;
        }
      }
    }

    // 5. Baud rate (only for embedded)
    let baudRate: number | undefined;
    if (!target.isNative) {
      // Zephyr consoles default to 115200; 9600 is the Arduino-class default.
      const defaultBaud = framework === 'zephyr' ? 115200 : 9600;
      if (partialOptions?.baud) {
        baudRate = partialOptions.baud;
        console.log(`${chalk.cyan("?")} Serial baud rate: ${chalk.white(baudRate)}`);
      } else {
        const baudAnswer = await promptText(rl, "Serial baud rate", String(defaultBaud));
        baudRate = parseInt(baudAnswer, 10);
        if (Number.isNaN(baudRate) || baudRate <= 0) {
          baudRate = defaultBaud;
          console.log(`  ${chalk.dim(`Using default: ${defaultBaud}`)}`);
        }
      }
    }

// 5. Starter program
let includeStarter: boolean;
if (partialOptions?.noStarter) {
  includeStarter = false;
  console.log(`${chalk.cyan("?")} Create starter program: ${chalk.dim("no")}`);
} else if (partialOptions?.noStarter === false) {
  includeStarter = true;
  console.log(`${chalk.cyan("?")} Create starter program: ${chalk.green("yes")}`);
} else {
  includeStarter = await promptConfirm(rl, "Create starter program?", true);
    }

    return {
      probeMethod,
      probeMethods,
      ...(probeRunnerArgs.length > 0 ? { probeRunnerArgs } : {}),
      projectName,
      targetId: target.id,
      targetDisplayName: target.displayName,
      isNative: target.isNative,
      architecture: target.architecture,
      board: target.board,
      // Pack fact: does the board's devicetree declare an LED? Drives the
      // starter between LED-blink and an I/O skeleton.
      ...(target.board ? { hasLed: Boolean(activeBoardCatalog()[target.board]?.led) } : {}),
      ...(serialPort ? { port: serialPort } : {}),
      frameworkPackage: frameworkPackage ?? '',
      framework: framework ?? '',
      buildTarget,
      ...(profile.toolchainType ? { toolchainType: profile.toolchainType } : {}),
      // soc rides the config only for native projects — a board target's
      // soc derives from the identifier at boardgen time.
      ...(target.board ? {} : { soc: target.soc }),
      ...(zephyrCustomBoard ? { zephyrCustomBoard: true } : {}),
      baudRate,
      includeStarter,
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
    // The board picker closes rl itself (it hands stdin to the filterable
    // select); a second close is harmless but explicit is cleaner.
    try { rl.close(); } catch { /* already closed */ }
  }
}
