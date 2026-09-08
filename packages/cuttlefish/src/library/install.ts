// ---------------------------------------------------------------------------
// Library installation — `typecad-hal library install <pkg...>`.
//
// Finds the nearest project package.json (walking up from the cwd) and runs
// npm install against it. The Windows spawn handling mirrors the typecad
// binary's package command: npm.cmd must go through cmd.exe, and a resolved
// .cmd/.bat cannot be exec'd directly.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const IS_WIN = process.platform === "win32";
const IS_CMD_EXT = /\.(?:cmd|bat)$/i;

/** Walk up from `fromDir` to the nearest package.json. */
export function findProjectPackageJson(fromDir: string = process.cwd()): string | null {
  let dir = path.resolve(fromDir);
  const root = path.parse(dir).root;
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

/** Installed version spec for a dependency name, or undefined. */
export function installedDependencyVersion(packageJsonPath: string, name: string): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      const deps = pkg[section];
      if (deps && typeof deps === "object" && typeof deps[name] === "string") {
        return deps[name] as string;
      }
    }
  } catch {
    // unreadable manifest — treat as not installed
  }
  return undefined;
}

function resolveNpmExecutable(): string | undefined {
  const isWin = IS_WIN;
  const cmd = isWin ? "npm.cmd" : "npm";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

/**
 * Install npm packages into the project owning `cwd`. Returns the directory
 * the install ran in. Throws with npm's stderr on failure.
 */
export function npmInstall(packageNames: string[], cwd: string): void {
  const resolved = resolveNpmExecutable();
  if (IS_WIN && (!resolved || IS_CMD_EXT.test(resolved))) {
    execFileSync("cmd.exe", ["/d", "/s", "/c", "npm", "install", ...packageNames], {
      cwd,
      stdio: "pipe",
      timeout: 300_000,
    });
  } else {
    execFileSync(resolved ?? "npm", ["install", ...packageNames], {
      cwd,
      stdio: "pipe",
      timeout: 300_000,
    });
  }
}
