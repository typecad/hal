// ---------------------------------------------------------------------------
// Interactive project init wizard
//
// Walks the user through creating a new TypeHAL project.
// Uses node:readline/promises — same pattern as wizard.ts for create-board.
// ---------------------------------------------------------------------------

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { InitProjectOptions } from "./init-templates";
import type { ArchitectureIdentifier } from "@typehal/core";
import { KNOWN_BOARDS, type KnownBoard } from "./init-scaffold";

type ReadlineInterface = ReturnType<typeof readline.createInterface>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

async function promptText(
  rl: ReadlineInterface,
  prompt: string,
  defaultValue?: string,
  validate?: (value: string) => string | null,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = await rl.question(`? ${prompt}${suffix}: `);
    const value = (answer.trim() || (defaultValue ?? "")).trim();

    if (validate) {
      const error = validate(value);
      if (error) {
        console.log(`  ✗ ${error}`);
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
  console.log(`? ${prompt}:`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}) ${options[i].label}`);
  }

  while (true) {
    const answer = await rl.question(`  Enter number (1-${options.length}): `);
    const idx = parseInt(answer.trim(), 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx].value;
    }
    console.log(`  ✗ Please enter a number between 1 and ${options.length}.`);
  }
}

async function promptConfirm(
  rl: ReadlineInterface,
  prompt: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? " (Y/n)" : " (y/N)";
  const answer = await rl.question(`? ${prompt}${suffix}: `);
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") return defaultValue;
  return trimmed === "y" || trimmed === "yes";
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

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
    console.log("⤳ typeHAL — Project Setup");
    console.log();

    // 1. Project name
    const projectName = partialOptions?.projectName
      ?? await promptText(rl, "Project name", "my-project", validateProjectName);

    // 2. Board selection
    const boardOptions = KNOWN_BOARDS.map((b: KnownBoard) => ({
      label: `${b.displayName} (${b.architecture.toUpperCase()})`,
      value: b.id,
    }));

    let boardId: string;
    if (partialOptions?.board) {
      const found = KNOWN_BOARDS.find((b: KnownBoard) => b.id === partialOptions.board);
      if (found) {
        boardId = found.id;
        console.log(`? Board: ${found.displayName} (${partialOptions.board})`);
      } else {
        console.log(`  Board '${partialOptions.board}' not found in registry. Available boards:`);
        boardId = await promptSelect(rl, "Board", boardOptions);
      }
    } else {
      boardId = await promptSelect(rl, "Board", boardOptions);
    }

    const board = KNOWN_BOARDS.find((b: KnownBoard) => b.id === boardId)!;

    // 3. Framework selection
    const frameworkOptions: Array<{ label: string; value: string; pkg: string }> = [
      { label: "Arduino (digitalWrite, Wire, SPI)", value: 'arduino', pkg: '@typehal/framework-arduino' },
    ];
    // Offer AVR framework for AVR architecture
    if (board.architecture === 'avr') {
      frameworkOptions.push({ label: "Bare-metal AVR (PORTB, etc.)", value: 'avr', pkg: '@typehal/framework-avr' });
    }

    let framework: string;
    let frameworkPackage: string;
    if (partialOptions?.framework) {
      const match = frameworkOptions.find(f => f.value === partialOptions.framework);
      framework = match?.value ?? partialOptions.framework;
      frameworkPackage = match?.pkg ?? `@typehal/framework-${partialOptions.framework}`;
      console.log(`? Framework: ${framework}`);
    } else if (frameworkOptions.length === 1) {
      framework = frameworkOptions[0].value;
      frameworkPackage = frameworkOptions[0].pkg;
      console.log(`? Framework: ${frameworkOptions[0].label}`);
    } else {
      const selected = await promptSelect(rl, "Framework", frameworkOptions.map(f => ({ label: f.label, value: f.value })));
      const match = frameworkOptions.find(f => f.value === selected)!;
      framework = match.value;
      frameworkPackage = match.pkg;
    }

    // 4. Baud rate
    let baudRate: number;
    if (partialOptions?.baud) {
      baudRate = partialOptions.baud;
      console.log(`? Serial baud rate: ${baudRate}`);
    } else {
      const baudAnswer = await promptText(rl, "Serial baud rate", "9600");
      baudRate = parseInt(baudAnswer, 10);
      if (Number.isNaN(baudRate) || baudRate <= 0) {
        baudRate = 9600;
        console.log("  Using default: 9600");
      }
    }

    // 5. Starter sketch
    let includeSketch: boolean;
    if (partialOptions?.noSketch) {
      includeSketch = false;
      console.log("? Create starter sketch: no");
    } else if (partialOptions?.noSketch === false) {
      includeSketch = true;
      console.log("? Create starter sketch: yes");
    } else {
      includeSketch = await promptConfirm(rl, "Create starter sketch?", true);
    }

    return {
      projectName,
      boardId: board.id,
      boardDisplayName: board.displayName,
      architecture: board.architecture,
      boardPackage: board.boardPackage,
      frameworkPackage,
      framework,
      fqbn: board.fqbn,
      mcu: board.mcu,
      baudRate,
      includeSketch,
    };
  } catch (err) {
    // Handle Ctrl+C gracefully
    if (err && typeof err === 'object' && (err as any).code === 'ERR_USE_AFTER_CLOSE') {
      return null;
    }
    throw err;
  } finally {
    rl.close();
  }
}
