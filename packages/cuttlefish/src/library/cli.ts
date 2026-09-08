// ---------------------------------------------------------------------------
// `typecad-hal library <subcommand>` — CLI glue for the library manager.
// Subcommands: search, install, init, validate. The catalog modules own the
// logic; this module owns argument interpretation and presentation.
// ---------------------------------------------------------------------------

import chalk from "chalk";
import path from "node:path";
import type { LibraryCommandOptions } from "../types.js";
import { LIBRARY_CATEGORIES, libraryCategory } from "./catalog.js";
import { searchLibraryPackages } from "./registry-search.js";
import { findProjectPackageJson, installedDependencyVersion, npmInstall } from "./install.js";
import { runLibraryInit } from "./init.js";
import { validateLibraryPackage, printValidationReport } from "./validate.js";

function requireCategory(category: string | undefined, command: string): string | undefined {
  if (category === undefined) return undefined;
  if (!libraryCategory(category)) {
    throw new Error(
      `Unknown category '${category}' for 'library ${command}'. Known categories: ` +
        LIBRARY_CATEGORIES.map((c) => c.id).join(", ") +
        ".",
    );
  }
  return category.toLowerCase();
}

function stripVersionPrefix(v: string): string {
  return v.replace(/^[^0-9]*/, "");
}

async function runSearch(options: LibraryCommandOptions): Promise<void> {
  const category = requireCategory(options.category, "search");
  const text = options.positionals.join(" ");

  let results;
  try {
    results = await searchLibraryPackages(text || undefined, category);
  } catch (e) {
    throw new Error(`Failed to search npm: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (options.json) {
    const pkgPath = findProjectPackageJson();
    console.log(
      JSON.stringify(
        results.map((r) => ({
          name: r.name,
          version: r.version,
          description: r.description,
          category: r.category,
          npmUrl: r.npmUrl,
          installed: pkgPath ? installedDependencyVersion(pkgPath, r.name) !== undefined : false,
        })),
        null,
        2,
      ),
    );
    return;
  }

  const header = category
    ? `cuttlefish libraries — category: ${libraryCategory(category)!.label}`
    : "cuttlefish libraries";
  console.log(chalk.green("+") + " " + chalk.white.bold(header) + chalk.gray(`  (npm keyword: typecad-hal-library${category ? ` + typecad-hal-${category}` : ""})`));
  console.log();

  if (results.length === 0) {
    console.log(chalk.yellow("No matching library packages on npm yet."));
    console.log(`  Scaffold the first one: ${chalk.cyan("typecad-hal library init")}`);
    return;
  }

  const pkgPath = findProjectPackageJson();
  for (const r of results) {
    const cat = r.category ? libraryCategory(r.category) : undefined;
    const installedSpec = pkgPath ? installedDependencyVersion(pkgPath, r.name) : undefined;
    const state = installedSpec
      ? stripVersionPrefix(installedSpec) === r.version
        ? chalk.gray(" (installed)")
        : chalk.yellow(` (installed v${stripVersionPrefix(installedSpec)}, latest v${r.version})`)
      : "";
    console.log(`  ${chalk.white.bold(r.name)} ${chalk.dim(`v${r.version}`)}${state}`);
    if (cat) {
      console.log(`    ${chalk.cyan(`[${cat.label}]`)} ${r.description ?? ""}`);
    } else {
      console.log(`    ${r.description ?? ""}`);
    }
  }
  console.log();
  console.log(chalk.gray(`  Install with: typecad-hal library install <name>`));
}

function runInstall(options: LibraryCommandOptions): void {
  const names = options.positionals;
  if (names.length === 0) {
    throw new Error("Usage: typecad-hal library install <package...>");
  }
  const pkgPath = findProjectPackageJson();
  if (!pkgPath) {
    throw new Error(
      "No package.json found in this directory or any parent — run inside a cuttlefish project.",
    );
  }
  const pkgDir = path.dirname(pkgPath);
  if (options.json) {
    const before = Object.fromEntries(
      names.map((n) => [n, installedDependencyVersion(pkgPath, n) ?? null]),
    );
    try {
      npmInstall(names, pkgDir);
    } catch (e) {
      const err = e as { stderr?: { toString(): string } };
      const detail = err.stderr?.toString().trim() || (e instanceof Error ? e.message : String(e));
      throw new Error(`Failed to install packages: ${detail}`);
    }
    console.log(JSON.stringify({ installed: names, projectRoot: pkgDir, previous: before }, null, 2));
    return;
  }
  console.log(chalk.green("+") + ` Installing ${names.join(", ")}...`);
  try {
    npmInstall(names, pkgDir);
  } catch (e) {
    const err = e as { stderr?: { toString(): string } };
    const detail = err.stderr?.toString().trim() || (e instanceof Error ? e.message : String(e));
    throw new Error(`Failed to install packages: ${detail}`);
  }
  for (const name of names) {
    console.log(chalk.green("+") + ` ${name}`);
    console.log(chalk.gray(`  https://www.npmjs.com/package/${name}`));
  }
  console.log(chalk.green("✔") + " Done");
}

async function runInit(options: LibraryCommandOptions): Promise<void> {
  if (options.category !== undefined) {
    requireCategory(options.category, "init");
  }
  await runLibraryInit({
    name: options.positionals[0],
    framework: options.framework,
    category: options.category,
    targets: options.targets,
    dir: options.dir,
    yes: options.yes,
  });
}

function runValidate(options: LibraryCommandOptions): void {
  const dir = options.positionals[0] ?? process.cwd();
  const report = validateLibraryPackage(dir);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          valid: report.valid,
          dir: report.dir,
          errors: report.errors,
          warnings: report.warnings,
          autosarFindings: report.autosarFindings,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(chalk.white.bold(`typecad-hal library validate`) + chalk.gray(`  ${report.dir}`));
    console.log();
    const code = printValidationReport(report);
    if (code !== 0) {
      process.exitCode = code;
    }
  }
  if (!report.valid && options.json) {
    process.exitCode = 1;
  }
}

export async function runLibraryCommand(options: LibraryCommandOptions): Promise<void> {
  switch (options.subcommand) {
    case "search":
      await runSearch(options);
      return;
    case "install":
      runInstall(options);
      return;
    case "init":
      await runInit(options);
      return;
    case "validate":
      runValidate(options);
      return;
  }
}
