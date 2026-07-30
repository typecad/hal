import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { emitResultStructs } from "../../../packages/safety/src/runtime/result-struct";

// Behavioral verification of the .ok/.fail/.fault/.always chain methods:
// compile the actual result struct C++ and exercise the dispatch semantics.

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
const STRUCTS = emitResultStructs();

function compileAndRun(source: string): string[] {
  if (!COMPILER) throw new Error("no compiler");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-chain-"));
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

function buildHarness(args: { status: string; value: number }): string {
  return `
#include <cstdint>
#include <cstdio>
${STRUCTS}

int main() {
  SafeReadResult r;
  r.status   = static_cast<SafetyStatus>(${args.status});
  r.value    = ${args.value};
  r.category = SafetyFaultCategory::Ok;
  r.code     = SafetyFaultCode::Ok;

  int fired = 0;
  r.ok([&](const SafeReadResult&)     { fired += 1; })
   .fail([&](const SafeReadResult&)   { fired += 2; })
   .always([&](const SafeReadResult&) { fired += 4; });
  std::printf("[TC:fired=%d]\\n", fired);
  std::printf("[TC:status=%u]\\n", static_cast<unsigned>(r.status));
  return 0;
}
`.trim();
}

const STATUS_OK    = 0x5A5A5A5A;
const STATUS_FAULT = 0xA5A5A5A5;

describe("result chaining (compiled + run)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  it(".ok fires on Ok, .fail does not (fired = ok|always = 5)", () => {
    const out = compileAndRun(buildHarness({ status: `0x${STATUS_OK.toString(16)}`, value: 1 }));
    expect(field(out, "fired")).toBe("5");
  });

  it(".fail fires on Fault, .ok does not (fired = fail|always = 6)", () => {
    const out = compileAndRun(buildHarness({ status: `0x${STATUS_FAULT.toString(16)}`, value: 0 }));
    expect(field(out, "fired")).toBe("6");
  });

  it("result is still inspectable after the chain (status unchanged)", () => {
    const out = compileAndRun(buildHarness({ status: `0x${STATUS_OK.toString(16)}`, value: 1 }));
    expect(field(out, "status")).toBe(String(STATUS_OK >>> 0));
  });

  it(".fault is an alias of .fail (fires on Fault)", () => {
    const src = `
#include <cstdint>
#include <cstdio>
${STRUCTS}
int main() {
  SafeReadResult r;
  r.status = static_cast<SafetyStatus>(0x${STATUS_FAULT.toString(16)});
  r.value = 0; r.category = SafetyFaultCategory::Ok; r.code = SafetyFaultCode::Ok;
  int fired = 0;
  r.fault([&](const SafeReadResult&){ fired += 1; });
  std::printf("[TC:fired=%d]\\n", fired);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fired")).toBe("1");
  });

  it("chain order: .always first runs before .ok", () => {
    const src = `
#include <cstdint>
#include <cstdio>
${STRUCTS}
int main() {
  SafeReadResult r;
  r.status = static_cast<SafetyStatus>(0x${STATUS_OK.toString(16)});
  r.value = 0; r.category = SafetyFaultCategory::Ok; r.code = SafetyFaultCode::Ok;
  int seq = 0;
  int alwaysSeq = 0, okSeq = 0;
  r.always([&](const SafeReadResult&){ alwaysSeq = ++seq; })
   .ok([&](const SafeReadResult&){ okSeq = ++seq; });
  std::printf("[TC:always=%d]\\n", alwaysSeq);
  std::printf("[TC:ok=%d]\\n", okSeq);
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "always")).toBe("1");
    expect(field(out, "ok")).toBe("2");
  });
});
