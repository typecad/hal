// ---------------------------------------------------------------------------
// Native C++ compilation toolchain
//
// Compiles generated C++ into a native executable using g++ or clang++.
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import type { CompileResult, ToolchainOptions } from "@typecad/cuttlefish/api/shared";
import { parseCompileErrors } from "@typecad/cuttlefish/api/shared";
import type { NativeCompileConfig } from "./native-config";

function findCppSource(outputDir: string, sourcePath: string): string {
  if (sourcePath.endsWith(".cpp") && fs.existsSync(sourcePath)) {
    return sourcePath;
  }
  if (fs.existsSync(outputDir)) {
    const entries = fs.readdirSync(outputDir);
    const cppFile = entries.find((e) => e.endsWith(".cpp"));
    if (cppFile) return path.join(outputDir, cppFile);
  }
  throw new Error(`No .cpp source file found in ${outputDir}`);
}

function detectCompiler(): { cmd: string; env: NodeJS.ProcessEnv | undefined } {
  // On Windows, also try MSYS2/MinGW paths that may not be in PATH
  const candidates = ["g++", "clang++"];
  if (process.platform === "win32") {
    candidates.unshift(
      "C:\\msys64\\ucrt64\\bin\\g++.exe",
      "C:\\msys64\\mingw64\\bin\\g++.exe",
    );
  }
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });
      if (r.status === 0) {
        // On Windows, ensure the compiler's bin dir is first in PATH
        // so g++ can find its internal tools (as, ld, cc1plus, etc.)
        let env: NodeJS.ProcessEnv | undefined;
        if (process.platform === "win32" && cmd.includes("\\")) {
          const binDir = path.dirname(cmd);
          const pathSep = ";";
          const existing = process.env.PATH ?? "";
          env = { ...process.env, PATH: `${binDir}${pathSep}${existing}` };
        }
        return { cmd, env };
      }
    } catch { /* not found */ }
  }
  throw new Error(
    "No C++ compiler found. Install g++ or clang++ and ensure it is in your PATH." +
    (process.platform === "win32"
      ? " On Windows, install MSYS2 (https://www.msys2.org/) and add C:\\msys64\\ucrt64\\bin to your PATH."
      : ""),
  );
}

function warningFlags(level?: string): string[] {
  switch (level) {
    case "none": return ["-w"];
    case "all": return ["-Wall"];
    case "extra": return ["-Wall", "-Wextra"];
    case "error": return ["-Wall", "-Wextra", "-Werror"];
    default: return ["-Wall"];
  }
}

export const NativeToolchain = {
  compile(options: ToolchainOptions): CompileResult {
    const nativeConfig = (options.frameworkConfig ?? {}) as NativeCompileConfig;

    const cppFile = findCppSource(options.outputDir, options.sourcePath);
    const exeExt = process.platform === "win32" ? ".exe" : ".out";
    const exeFile = cppFile.replace(/\.cpp$/, exeExt);

    // Use configured compiler or auto-detect
    const detected = detectCompiler();
    const compiler = nativeConfig.compiler ?? detected.cmd;
    const env = detected.env;

    const flags: string[] = [];

    // C++ standard
    flags.push(`-std=${nativeConfig.cxxStandard ?? "c++17"}`);

    // Optimization
    if (options.optimize === "size") flags.push("-Os");
    else if (options.optimize === "speed") flags.push("-O3");
    else flags.push("-O2");

    // Warning level
    flags.push(...warningFlags(nativeConfig.warnings));

    // Static linking (default: true on Windows, false elsewhere)
    const staticLink = nativeConfig.staticLink ?? (process.platform === "win32");
    if (staticLink) flags.push("-static");

    // Include paths
    if (nativeConfig.includePaths) {
      for (const p of nativeConfig.includePaths) flags.push(`-I${p}`);
    }

    // Library paths
    if (nativeConfig.libraryPaths) {
      for (const p of nativeConfig.libraryPaths) flags.push(`-L${p}`);
    }

    // Generic extra flags and defines
    if (options.extraFlags) flags.push(...options.extraFlags);
    if (options.defines) {
      for (const [k, v] of Object.entries(options.defines)) {
        flags.push(`-D${k}=${v}`);
      }
    }

    // Build args: flags + source + output, then -l flags last (GCC ordering)
    const linkLibs = nativeConfig.libraries?.map(lib => `-l${lib}`) ?? [];
    const args = [...flags, cppFile, "-o", exeFile, ...linkLibs];

    const result = spawnSync(compiler, args, {
      encoding: "utf8",
      timeout: 120000,
      env: env ?? process.env,
    });

    let output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();

    if (result.status === 0) {
      output = `${compiler} -> ${exeFile}`;
    } else if (result.error) {
      output = `Compiler error: ${result.error.message}\n${output}`.trim();
    } else if (!output) {
      output = `Compiler exited with code ${result.status} (no output). Command: ${compiler} ${args.join(" ")}`;
    }

    const errors = parseCompileErrors(output, options.outputDir);

    return { success: result.status === 0, output, errors };
  },
};
