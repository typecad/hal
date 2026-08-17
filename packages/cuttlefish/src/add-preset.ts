// ---------------------------------------------------------------------------
// `cuttlefish add <preset>` — scaffold copy-and-own assets into a project.
//
// Presets are files shipped with the package under assets/. The command COPIES
// them into the user's project (never injected at build time): the user owns
// the file from day one and the build only reads what they reference. This is
// the same philosophy as shadcn/ui — components as source you keep, not a
// runtime dependency.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddCommandOptions } from "./types.js";
import chalk from "chalk";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets");

interface Preset {
  /** Source file inside the package's assets/ directory. */
  source: string;
  /** Destination path relative to the project root. */
  dest: string;
  /** One-line description for listings. */
  description: string;
  /** Post-install instructions (already indented; printed verbatim). */
  nextSteps: string[];
}

const PRESETS: Record<string, Preset> = {
  shadcn: {
    source: "shadcn/shadcn.css",
    dest: "src/styles/shadcn.css",
    description: "shadcn-style CSS variable tokens + component class recipes (buttons, cards, badges, alerts, ...)",
    nextSteps: [
      `Link it from a stylesheet (sibling .ui.css file or a <style> block):`,
      ``,
      `    @import "./styles/shadcn.css";`,
      ``,
      `Then use the classes on native elements:`,
      `    <button class="btn btn-primary">Save</button>`,
      `    <view class="card"> ... <text class="card-title">Title</text> ... </view>`,
      ``,
      `Dark theme: the file defines a .dark token set — activate it with`,
      `themeClass: 'dark' in cuttlefish.config.ts's display block.`,
      `The file is yours: tune tokens and prune recipes freely.`,
    ],
  },
};

export function listAddPresets(): string {
  return Object.entries(PRESETS).map(([id, p]) => `  ${id.padEnd(10)} ${p.description}`).join("\n");
}

/** Run `cuttlefish add <preset>`: copy the preset into the project. */
export function runAddPreset(options: AddCommandOptions): void {
  const preset = PRESETS[options.preset];
  if (!preset) {
    throw new Error(`Unknown preset "${options.preset}". Available presets:\n${listAddPresets()}`);
  }

  const src = path.join(ASSETS_DIR, preset.source);
  if (!fs.existsSync(src)) {
    throw new Error(`Preset asset missing from the cuttlefish package: ${src}`);
  }
  const dest = path.resolve(options.projectRoot, preset.dest);
  if (fs.existsSync(dest) && !options.force) {
    throw new Error(`${dest} already exists — re-run with --force to overwrite (your edits will be lost).`);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);

  console.log(chalk.green(`✓`) + ` Added preset ${chalk.cyan(options.preset)} → ${path.relative(options.projectRoot, dest)}`);
  console.log();
  console.log(chalk.bold(`Next steps:`));
  for (const line of preset.nextSteps) {
    console.log(line ? `  ${line}` : ``);
  }
}
