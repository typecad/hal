import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { transpileFile } from "../../../packages/cuttlefish/src/transpile";
import {
  generateGenericBreakpointCode,
  generateGenericLogpointCode,
  generateGenericInitCode,
} from "../../../packages/cuttlefish/src/platform/generic-debug-codegen";

// The generic/native --debug path. The pre-2026 codegen injected raw
// `std::cout << ...` C++ text as "TypeScript"; the TS parser read `std::cout`
// as a label and the emitted C++ was `std: :` noise that never compiled.
// The codegen now routes every line through rawCpp() (verbatim C++ via
// __EMIT__), halts on stdin, and the 's' key skips a breakpoint via a static
// flag. These tests pin that contract at both the generator and pipeline
// level, and compile+run the emitted C++ when a host compiler is available.

describe("generic debug codegen (generator)", () => {
  /** Decode a rawCpp("...") TS statement back to its verbatim C++ text. */
  function decodeCpp(line: string): string {
    const m = line.trim().match(/^rawCpp\(("(?:[^"\\]|\\.)*")\);$/s);
    expect(m, `not a rawCpp passthrough: ${line}`).toBeTruthy();
    return JSON.parse(m![1]);
  }

  it("wraps every emitted line in a rawCpp() passthrough call", () => {
    const lines = generateGenericBreakpointCode(
      "main.ts", 3, 'const x = 1;', [], undefined, 0,
    );
    const code = lines.filter((l) => l.trim().startsWith("rawCpp("));
    expect(code.length).toBeGreaterThan(0);
    // Every rawCpp line must be a single-statement call — parseable TS.
    for (const line of code) {
      expect(line.trim()).toMatch(/^rawCpp\(".*"\);$/s);
    }
  });

  it("emits the static skip flag and a stdin halt for a halting breakpoint", () => {
    const lines = generateGenericBreakpointCode(
      "main.ts", 3, "beats = beats + 1;", [], undefined, 7,
    );
    const text = lines.map((l) => (l.trim().startsWith("rawCpp(") ? decodeCpp(l) : l)).join("\n");
    expect(text).toContain("static bool __tc_bp7_skipped = false;");
    expect(text).toContain("if (!__tc_bp7_skipped) {");
    expect(text).toContain("getchar()");
    expect(text).toContain("__tc_bp7_skipped = true;");
    expect(text).toContain("EOF");
  });

  it("wraps the breakpoint body in the normalized condition", () => {
    const lines = generateGenericBreakpointCode(
      "main.ts", 5, "work();", [], "n > 5", 0,
    );
    const text = lines.join("\n");
    expect(text).toContain("if (n > 5) {");
    expect(text).toContain("(condition: n > 5)");
    // Condition closes after the raw block.
    expect(lines[lines.length - 2]).toBe("  }");
  });

  it("formats variables by type category", () => {
    const vars = [
      { name: "count", cppType: "long" as const },
      { name: "ratio", cppType: "float" as const },
      { name: "label", cppType: "string" as const },
      { name: "ok", cppType: "bool" as const },
      { name: "mystery", cppType: "unknown" as const },
    ];
    const text = generateGenericBreakpointCode("m.ts", 1, "x;", vars, undefined, 0)
      .map((l) => (l.trim().startsWith("rawCpp(") ? decodeCpp(l) : l))
      .join("\n");
    expect(text).toContain('printf("  - %s = %lld\\n", "count", static_cast<long long>(count));');
    expect(text).toContain('printf("  - %s = %g\\n", "ratio", static_cast<double>(ratio));');
    expect(text).toContain('printf("  - %s = %s\\n", "label", label.c_str());');
    expect(text).toContain('printf("  - %s = %d\\n", "ok", static_cast<int>(ok));');
    expect(text).toContain('printf("  - %s = %g\\n", "mystery", static_cast<double>(mystery));');
  });

  it("escapes quotes and backslashes in echoed source text", () => {
    const text = generateGenericBreakpointCode(
      "m.ts", 2, 'printf("a\\b");', [], undefined, 0,
    ).map((l) => (l.trim().startsWith("rawCpp(") ? decodeCpp(l) : l)).join("\n");
    // The echoed line must arrive as a safe C++ string literal.
    expect(text).toContain('\\"a\\\\b\\"');
  });

  it("prints logpoint text parts and in-scope variables, placeholder otherwise", () => {
    const lines = generateGenericLogpointCode(
      "m.ts", 9,
      [{ type: "text", value: "val=" }, { type: "variable", value: "x" }, { type: "variable", value: "ghost" }],
      [{ name: "x", cppType: "long" }],
    );
    const text = lines.map((l) => (l.trim().startsWith("rawCpp(") ? decodeCpp(l) : l)).join("\n");
    expect(text).toContain('[LOG m.ts:9]');
    expect(text).toContain('printf("%lld", static_cast<long long>(x));');
    expect(text).toContain('{ghost}');
    expect(text).not.toContain("std::cout");
  });

  it("the init banner is a printf, not a stream expression", () => {
    const text = generateGenericInitCode().join("\n");
    expect(text).toContain("Debug Mode Active");
    expect(text).toContain("printf(");
    expect(text).not.toContain("std::cout");
  });
});

// ---------------------------------------------------------------------------
// Pipeline e2e — breakpoints.json through transpileFile on the native target.
// ---------------------------------------------------------------------------

/** Resolve a C++ compiler, preferring the MSYS2 roots then PATH. Returns null
 *  when none is reachable (the compile test skips). Same probe order as the
 *  safety behavioral-compile suite. */
function resolveCompiler(): { cmd: string; env: NodeJS.ProcessEnv; includeDirArgs: string[] } | null {
  const env = { ...process.env };
  if (process.platform === "win32") {
    for (const binDir of ["C:\\msys64\\ucrt64\\bin", "C:\\msys64\\mingw64\\bin"]) {
      if (fs.existsSync(path.join(binDir, "g++.exe"))) {
        env.PATH = `${binDir};${env.PATH ?? ""}`;
        return { cmd: "g++", env, includeDirArgs: [] };
      }
    }
  }
  const probe = spawnSync("g++", ["--version"], { encoding: "utf8" });
  if (probe.status === 0) return { cmd: "g++", env, includeDirArgs: [] };
  const probe2 = spawnSync("clang++", ["--version"], { encoding: "utf8" });
  if (probe2.status === 0) return { cmd: "clang++", env, includeDirArgs: [] };
  return null;
}

const COMPILER = resolveCompiler();

function makeDebugProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-debug-"));
  // `out` is written at top level and read by the line-8 breakpoint dump —
  // that read is what keeps `out = work(21)` (and with it the call) alive
  // under tree-shaking, so the in-function breakpoints actually execute.
  fs.writeFileSync(path.join(dir, "main.ts"), [
    "const limit: number = 10;",
    "let out: number = 0;",
    "",
    "function work(n: number): number {",
    "  const doubled: number = n * 2;",
    "  return doubled;",
    "}",
    "",
    "out = work(21);",
  ].join("\n"));
  fs.mkdirSync(path.join(dir, ".typecad-hal"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".typecad-hal", "breakpoints.json"), JSON.stringify({
    version: 1,
    breakpoints: [
      { file: "main.ts", line: 5 },
      // The condition must reference variables in scope AT the breakpoint —
      // n lives inside work().
      { file: "main.ts", line: 6, condition: "n > 5" },
      { file: "main.ts", line: 9 },
    ],
  }));
  return dir;
}

describe("generic debug path end-to-end (transpileFile)", () => {
  let dir: string;
  let cpp: string;
  let sourcePath: string;

  beforeAll(async () => {
    dir = makeDebugProject();
    const result = await transpileFile({
      inputFile: path.join(dir, "main.ts"),
      emitMode: "cpp",
      // Real native projects set framework in typecad-hal.config.ts — the
      // emitting strategy (NativeStrategy) decides tree-shaking and includes.
      frameworkPackage: "@typecad/framework-native",
      emitMaps: false,
      debug: true,
    });
    sourcePath = result.sourcePath;
    cpp = fs.readFileSync(sourcePath, "utf8");
  });

  it("transpiles breakpoints into compiling C++ — no parser garbage, no rawCpp residue", () => {
    // The old failure mode: `std::cout` injected as TS lowered to label noise.
    expect(cpp).not.toMatch(/std:\s*$/m);
    expect(cpp).not.toContain("__break_");
    expect(cpp).not.toContain("std::cout");
    // The passthrough must fully lower — rawCpp never reaches the output.
    expect(cpp).not.toContain("rawCpp(");
    // The new contract: printf dump + static skip flag + stdin halt.
    expect(cpp).toContain("#include <cstdio>");
    expect(cpp).toContain('[BREAK] main.ts:5');
    expect(cpp).toContain("static bool __tc_bp");
    expect(cpp).toContain("getchar()");
    // Module-scope variables are main() locals — a breakpoint inside work()
    // must NOT reference them (pre-2026 the dump did, and the C++ did not
    // compile: 'limit' was not declared in this scope). Slice from the
    // DEFINITION (the prototype line matches first otherwise).
    const defIdx = cpp.search(/double work\(double n\)\s*\{/);
    const workBody = cpp.slice(defIdx, cpp.lastIndexOf("int main()"));
    expect(workBody).toContain('"n"');
    expect(workBody).not.toContain('"limit"');
    expect(workBody).not.toContain('"out"');
  });

  it("compiles and runs under a host compiler (skip when none installed)", () => {
    if (!COMPILER) {
      console.warn("  (no host g++/clang++ — compile check skipped)");
      return;
    }
    const outExe = path.join(dir, "dbg.exe");
    const compile = spawnSync(COMPILER.cmd, [
      "-std=c++17", "-I", path.dirname(sourcePath),
      "-o", outExe, sourcePath,
    ], { encoding: "utf8", env: COMPILER.env });
    if (compile.status !== 0) {
      throw new Error(`debug C++ failed to compile:\n${compile.stdout}\n${compile.stderr}`);
    }
    // Three halts (banner does not halt) feed on ENTERs; clean exit plus the
    // expected dump lines prove the halt/resume wiring runs. The line-6 dump
    // reads doubled AFTER its declaration; the line-9 dump reads out BEFORE
    // its assignment runs (dumps inject at the start of the line), so 0.
    const run = spawnSync(outExe, {
      input: "\n\n\n",
      encoding: "utf8",
      env: COMPILER.env,
      timeout: 30000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("[TypeCAD] Debug Mode Active");
    expect(run.stdout).toContain("[BREAK] main.ts:5");
    expect(run.stdout).toContain("- n = 21");
    expect(run.stdout).toContain("[BREAK] main.ts:6 (condition: n > 5)");
    expect(run.stdout).toContain("- doubled = 42");
    expect(run.stdout).toContain("- out = 0");
  });
});
