import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { safeVariablePolyfill } from "../../../../packages/cuttlefish/src/safety/runtime/safe-variable";

// Behavioral verification of SafeVariable: compile the actual polyfill C++
// and exercise the SEU-correction / fault-signaling logic. To corrupt
// individual replicas we use `#define private public` (a standard test-only
// technique) so the probe can reach the private replica fields directly.

function resolveCompiler(): { cmd: string; env: NodeJS.ProcessEnv } | null {
  const env = { ...process.env };
  if (process.platform === "win32") {
    for (const binDir of ["C:\\msys64\\ucrt64\\bin", "C:\\msys64\\mingw64\\bin"]) {
      if (fs.existsSync(path.join(binDir, "g++.exe"))) {
        env.PATH = `${binDir};${env.PATH ?? ""}`;
        return { cmd: "g++", env };
      }
    }
  }
  if (spawnSync("g++", ["--version"], { encoding: "utf8" }).status === 0) return { cmd: "g++", env };
  if (spawnSync("clang++", ["--version"], { encoding: "utf8" }).status === 0) return { cmd: "clang++", env };
  return null;
}

const COMPILER = resolveCompiler();

function compileAndRun(source: string): string[] {
  if (!COMPILER) throw new Error("no compiler");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-sv-"));
  try {
    const cppFile = path.join(tmpDir, "main.cpp");
    fs.writeFileSync(cppFile, source);
    const exeExt = process.platform === "win32" ? ".exe" : ".out";
    const exeFile = cppFile.replace(/\.cpp$/, exeExt);
    const compile = spawnSync(
      COMPILER.cmd,
      ["-std=c++17", "-O2", "-Wall", "-Werror", "-o", exeFile, cppFile],
      { encoding: "utf8", timeout: 60_000, env: COMPILER.env },
    );
    if (compile.status !== 0) {
      throw new Error(`Compilation failed:\n${compile.stdout ?? ""}\n${compile.stderr ?? ""}`);
    }
    const run = spawnSync(exeFile, [], { encoding: "utf8", timeout: 10_000 });
    if (run.error) throw new Error(`Execution failed: ${run.error.message}`);
    return (run.stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("[TC:") && l.endsWith("]"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function field(lines: string[], key: string): string {
  const line = lines.find((l) => l.startsWith(`[TC:${key}=`));
  if (!line) throw new Error(`missing protocol field ${key} in ${lines.join("|")}`);
  return line.slice(`[TC:${key}=`.length, -1);
}

// The polyfill source. Tests that need to corrupt replicas wrap this with
// `#define private public`; tests that only check the public API or verify
// static_assert compile-failures include it verbatim.
const SAFE_VARIABLE_SRC = safeVariablePolyfill().helperFunctions.join("\n");

/** Harness for SafeVariable<int32_t> with replica-corruption capability. */
function buildIntHarness(args: {
  corrupt: "none" | "A" | "B" | "C" | "all";
  corruptValue?: number;
}): string {
  return `
#define private public   // test-only: reach replica fields to simulate SEU
#include <cstdint>
#include <cstdio>
#include <type_traits>
${SAFE_VARIABLE_SRC}

int main() {
  SafeVariable<int32_t> sv(2000);
${args.corrupt === "A" ? `  sv.replicaA_val = ${args.corruptValue ?? -999};` : ""}
${args.corrupt === "B" ? `  sv.replicaB_val = ${args.corruptValue ?? -999};` : ""}
${args.corrupt === "C" ? `  sv.replicaC_val = ${args.corruptValue ?? -999};` : ""}
${args.corrupt === "all" ? `  sv.replicaA_val = ${args.corruptValue ?? -1}; sv.replicaB_val = ${args.corruptValue ?? -2}; sv.replicaC_val = ${args.corruptValue ?? -3};` : ""}

  const int32_t got = sv.get();
  const bool fault = sv.hasFault();
  const bool valid = sv.valid();
  std::printf("[TC:got=%d]\\n", static_cast<int>(got));
  std::printf("[TC:fault=%d]\\n", fault ? 1 : 0);
  std::printf("[TC:valid=%d]\\n", valid ? 1 : 0);
  return 0;
}
`.trim();
}

describe("SafeVariable<int32_t> (compiled + run)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  it("returns the stored value when no replica is corrupted", () => {
    const out = compileAndRun(buildIntHarness({ corrupt: "none" }));
    expect(field(out, "got")).toBe("2000");
    expect(field(out, "fault")).toBe("0");
    expect(field(out, "valid")).toBe("1");
  });

  it("corrects a single corrupted replica via majority vote (replica A)", () => {
    // Replicas B and C still hold 2000 → majority returns 2000.
    const out = compileAndRun(buildIntHarness({ corrupt: "A", corruptValue: -999 }));
    expect(field(out, "got")).toBe("2000");
    expect(field(out, "fault")).toBe("0");
    expect(field(out, "valid")).toBe("0");  // A disagrees, so valid() is false
  });

  it("corrects a single corrupted replica (replica C)", () => {
    const out = compileAndRun(buildIntHarness({ corrupt: "C", corruptValue: 424242 }));
    expect(field(out, "got")).toBe("2000");
    expect(field(out, "fault")).toBe("0");
  });

  it("flags hasFault()=true on triple corruption (all replicas differ)", () => {
    const out = compileAndRun(buildIntHarness({ corrupt: "all" }));
    expect(field(out, "fault")).toBe("1");
    expect(field(out, "valid")).toBe("0");
  });

  it("set() clears the fault flag after a triple corruption", () => {
    const src = `
#define private public
#include <cstdint>
#include <cstdio>
${SAFE_VARIABLE_SRC}
int main() {
  SafeVariable<int32_t> sv(100);
  sv.replicaA_val = 1;
  sv.replicaB_val = 2;
  sv.replicaC_val = 3;
  (void)sv.get();         // observe the fault
  sv.set(42);             // repair
  const int32_t got = sv.get();
  std::printf("[TC:got=%d]\\n", static_cast<int>(got));
  std::printf("[TC:fault=%d]\\n", sv.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "got")).toBe("42");
    expect(field(out, "fault")).toBe("0");
  });
});

describe("SafeVariable<float> (compiled + run)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  it("float specialization corrects single-replica corruption via majority", () => {
    const src = `
#define private public
#include <cstdint>
#include <cstdio>
${SAFE_VARIABLE_SRC}
int main() {
  SafeVariable<float> sv(1.5f);
  sv.replicaA = 9.9f;   // A corrupted; B and C hold 1.5
  float got = sv.get();
  std::printf("[TC:got=%d]\\n", got == 1.5f ? 1 : 0);
  std::printf("[TC:fault=%d]\\n", sv.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "got")).toBe("1");   // majority returned the true 1.5
    expect(field(out, "fault")).toBe("0");
  });
});

describe("SafeVariable static_assert (compile-fail)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  it("rejects std::string (arithmetic-only constraint)", () => {
    // A SUCCESSFUL compile here is a failure — we expect the static_assert to fire.
    const src = `
#include <string>
${SAFE_VARIABLE_SRC}
int main() {
  SafeVariable<std::string> sv("hello");
  (void)sv;
  return 0;
}`.trim();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-sv-fail-"));
    try {
      const cppFile = path.join(tmpDir, "main.cpp");
      fs.writeFileSync(cppFile, src);
      const exeExt = process.platform === "win32" ? ".exe" : ".out";
      const exeFile = cppFile.replace(/\.cpp$/, exeExt);
      const compile = spawnSync(
        COMPILER!.cmd,
        ["-std=c++17", "-O2", "-o", exeFile, cppFile],
        { encoding: "utf8", timeout: 60_000, env: COMPILER!.env },
      );
      // We expect failure (non-zero status) with a static_assert message.
      expect(compile.status).not.toBe(0);
      const stderr = compile.stderr ?? "";
      expect(stderr).toMatch(/static_assert|requires an integral T/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects bool (bool inversion is ill-defined)", () => {
    const src = `
${SAFE_VARIABLE_SRC}
int main() {
  SafeVariable<bool> sv(true);
  (void)sv;
  return 0;
}`.trim();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-sv-bool-"));
    try {
      const cppFile = path.join(tmpDir, "main.cpp");
      fs.writeFileSync(cppFile, src);
      const exeExt = process.platform === "win32" ? ".exe" : ".out";
      const exeFile = cppFile.replace(/\.cpp$/, exeExt);
      const compile = spawnSync(
        COMPILER!.cmd,
        ["-std=c++17", "-O2", "-o", exeFile, cppFile],
        { encoding: "utf8", timeout: 60_000, env: COMPILER!.env },
      );
      expect(compile.status).not.toBe(0);
      const stderr = compile.stderr ?? "";
      expect(stderr).toMatch(/static_assert|requires an integral T/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
