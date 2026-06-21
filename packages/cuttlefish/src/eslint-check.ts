import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import chalk from "chalk";

const selfRequire = createRequire(import.meta.url);

export interface ESLintError {
  filePath: string;
  line: number;
  column: number;
  message: string;
  ruleId: string;
  sourceLine: string;
}

export async function runEslintCheck(projectRoot: string): Promise<ESLintError[]> {
  const configNames = ["eslint.config.mjs", "eslint.config.js", "eslint.config.cjs"];
  const hasConfig = configNames.some(name =>
    fs.existsSync(path.join(projectRoot, name))
  );
  if (!hasConfig) return [];

  let ESLintCls: any;
  try {
    // Prefer the user project's own eslint install (handles pinned versions),
    // then fall back to the cuttlefish package's install (monorepo / global).
    let eslintPath: string | undefined;
    try {
      const projectRequire = createRequire(path.join(projectRoot, "package.json"));
      eslintPath = projectRequire.resolve("eslint");
    } catch {
      eslintPath = selfRequire.resolve("eslint");
    }
    const eslintModule = await import(pathToFileURL(eslintPath!).href);
    ESLintCls = eslintModule.ESLint;
  } catch {
    return [];
  }
  if (!ESLintCls) return [];

  const eslint = new ESLintCls({ cwd: projectRoot });
  const srcDir = path.join(projectRoot, "src");
  if (!fs.existsSync(srcDir)) return [];

  const results = await eslint.lintFiles([srcDir]);

  const errors: ESLintError[] = [];
  for (const result of results) {
    if (result.errorCount === 0) continue;
    const sourceLines: string[] = result.source
      ? result.source.split("\n")
      : fs.existsSync(result.filePath)
        ? fs.readFileSync(result.filePath, "utf-8").split("\n")
        : [];
    for (const msg of result.messages) {
      if (msg.severity !== 2) continue;
      errors.push({
        filePath: path.relative(projectRoot, result.filePath),
        line: msg.line,
        column: msg.column,
        message: msg.message,
        ruleId: msg.ruleId ?? "unknown",
        sourceLine: sourceLines[msg.line - 1] ?? "",
      });
    }
  }

  return errors;
}

export function printEslintErrors(errors: ESLintError[]): void {
  for (const err of errors) {
    const location = `${err.filePath}(${err.line},${err.column})`;
    const rule = chalk.gray(`[${err.ruleId}]`);
    console.error(`${chalk.red.bold("error")} ${location} ${rule}: ${chalk.white(err.message)}`);

    if (err.sourceLine) {
      const prefix = "    ";
      console.error(prefix + err.sourceLine);
      console.error(chalk.gray(prefix + " ".repeat(Math.max(0, err.column - 1)) + "^"));
    }
  }

  console.error("");
  console.error(chalk.red(`✖ ${errors.length} ESLint error${errors.length === 1 ? "" : "s"} — build stopped`));
}
