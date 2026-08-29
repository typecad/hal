// ---------------------------------------------------------------------------
// Native C++ compilation toolchain
//
// Compiles generated C++ into a native executable using g++ or clang++.
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import type { CompileResult, ToolchainOptions } from '../../api/shared/index.js';
import { parseCompileErrors, collectCppFiles } from '../../api/shared/index.js';
import type { NativeCompileConfig } from "./native-config.js";

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

/**
 * Resolve the -l link libraries for a native build.
 *
 * The SDL display driver (#include <SDL2/SDL.h>) requires core SDL2 at link
 * time on every platform; Windows/MSYS2 additionally needs -lmingw32 and
 * -lSDL2main for the Win32 GUI entry-point glue (the SDL_MAIN_HANDLED define
 * + SDL_SetMainReady() in display_init). Because the cuttlefish config loader
 * is AST-only (it cannot evaluate process.platform conditionals), these libs
 * are auto-provided here when the `sdl` display driver is active, so a single
 * config links on both Windows and Linux without a platform-specific
 * `native.libraries` array. User-supplied libraries are appended (deduped).
 */
export function resolveLinkLibraries(
  display: Record<string, unknown> | undefined,
  userLibs: string[],
): string[] {
  const libs: string[] = [];
  if (display?.driver === "sdl") {
    if (process.platform === "win32") {
      // mingw32 (WinMain CRT glue) → SDL2main (SDL_main) → SDL2 (core).
      libs.push("mingw32", "SDL2main", "SDL2");
    } else {
      libs.push("SDL2");
    }
  }
  for (const lib of userLibs) {
    if (!libs.includes(lib)) libs.push(lib);
  }
  return libs;
}

export const NativeToolchain = {
  compile(options: ToolchainOptions): CompileResult {
    const nativeConfig = (options.frameworkConfig ?? {}) as NativeCompileConfig;

    let cppFiles = collectCppFiles(options.outputDir);
    if (cppFiles.length === 0) {
      const fallback = findCppSource(options.outputDir, options.sourcePath);
      cppFiles.push(fallback);
    }
    const exeExt = process.platform === "win32" ? ".exe" : ".out";
    const exeFile = cppFiles[0].replace(/\.cpp$/, exeExt);

    // Use configured compiler or auto-detect
    const detected = detectCompiler();
    const compiler = nativeConfig.compiler ?? detected.cmd;
    const env = detected.env;

    const flags: string[] = [];

    // C++ standard
    flags.push(`-std=${nativeConfig.cxxStandard ?? "c++17"}`);

    // Optimization: always -O2. The old `output.optimize` config knob was
    // removed from cuttlefish ("framework territory" — see config-loader's
    // deprecation note); nothing can populate a ToolchainOptions.optimize, so
    // these branches were dead code that never type-checked.
    flags.push("-O2");

    // Warning level
    flags.push(...warningFlags(nativeConfig.warnings));

    // Static linking (default: true on Windows, false elsewhere)
    const staticLink = nativeConfig.staticLink ?? (process.platform === "win32");
    if (staticLink) flags.push("-static");

    // Windows GUI subsystem: link as a windowed app, not a console app. Without
    // -mwindows, MinGW produces a console-subsystem executable that spawns a
    // cmd.exe window behind the SDL window on launch. This is the standard flag
    // for any SDL/Win32 GUI program built with g++ on MSYS2/MinGW. No-op on
    // Linux/macOS (no console-subsystem concept there).
    if (process.platform === "win32") flags.push("-mwindows");

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

    // Build args: flags + source + output, then -l flags last (GCC ordering).
    // SDL2 link libs are auto-provided when the `sdl` display driver is active
    // (see resolveLinkLibraries) — the AST config loader can't evaluate
    // platform conditionals, so this keeps a single config portable across
    // Windows/Linux/macOS. User-supplied native.libraries are merged in.
    const linkLibs = resolveLinkLibraries(options.display, nativeConfig.libraries ?? []).map(
      (lib) => `-l${lib}`,
    );
    const args = [...flags, ...cppFiles, "-o", exeFile, ...linkLibs];

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
