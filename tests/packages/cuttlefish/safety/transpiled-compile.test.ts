import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { transpileNative } from "../../../setup";

// End-to-end compile verification of the safety authoring surface: TypeScript
// in -> real transpile pipeline -> emitted C++ -> host g++ -> run. The other
// safety tests either substring-match the emitted cpp or compile the polyfill
// sources against hand-written harnesses; this file is the only place the
// REAL transpiler output must compile. It exists because both regressions it
// guards were real: safety-typed `let`s were promoted to `const` (making
// .set()/.add() ill-formed) and SafeInt<number> resolved to SafeInt<double>
// (tripping the polyfill's static_assert).

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

interface CompileOutcome {
  status: number | null;
  stderr: string;
  cpp: string;
}

function compileTranspiled(tsCode: string): CompileOutcome {
  if (!COMPILER) throw new Error("no compiler");
  const result = transpileNative(tsCode);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-safety-e2e-"));
  try {
    const cppFile = path.join(tmpDir, "main.cpp");
    fs.writeFileSync(cppFile, result.cpp);
    const exeFile = cppFile.replace(/\.cpp$/, process.platform === "win32" ? ".exe" : ".out");
    const compile = spawnSync(
      COMPILER.cmd,
      ["-std=c++17", "-O2", "-o", exeFile, cppFile],
      { encoding: "utf8", timeout: 60_000, env: COMPILER.env },
    );
    if (compile.status === 0) {
      const run = spawnSync(exeFile, [], { encoding: "utf8", timeout: 10_000 });
      return { status: run.status, stderr: run.stderr ?? "", cpp: result.cpp };
    }
    return { status: compile.status, stderr: compile.stderr ?? "", cpp: result.cpp };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("transpiled safety program compiles + runs", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  it("control: plain let mutation still compiles (promotion only skips safety types)", () => {
    const out = compileTranspiled(`
let x = 10;
x = 20;
const _keep = x;
`);
    expect(out.stderr).toBe("");
    expect(out.status).toBe(0);
  });

  it("function-scoped SafeVariable + SafeInt (documented usage)", () => {
    const out = compileTranspiled(`
import { SafeVariable, SafeInt } from "@typecad/safety";

function run(): void {
  let speed: SafeVariable<number> = 1000;
  speed.set(2000);
  const _keep1 = speed.get();

  let count: SafeInt<number> = SafeInt(10);
  count.add(5).mul(2);
  const _keep2 = count.get();
}

run();
`);
    expect(out.stderr).toBe("");
    expect(out.status).toBe(0);
  });

  it("top-level SafeVariable + SafeInt (documented usage)", () => {
    const out = compileTranspiled(`
import { SafeVariable, SafeInt } from "@typecad/safety";

let speed: SafeVariable<number> = 1000;
speed.set(2000);
const _keep1 = speed.get();

let count: SafeInt<number> = SafeInt(10);
count.add(5).mul(2);
const _keep2 = count.get();
`);
    expect(out.stderr).toBe("");
    expect(out.status).toBe(0);
  });

  it("const-declared SafeVariable/SafeInt mutated via methods demote and compile", () => {
    // TS `const` is binding-const: method mutation is legal TS, so the
    // emitted C++ must drop the qualifier (ownership-const-content-mutated).
    const out = compileTranspiled(`
import { SafeVariable, SafeInt } from "@typecad/safety";

const speed: SafeVariable<number> = 1000;
speed.set(2000);
const _keep1 = speed.get();

const count: SafeInt<number> = SafeInt(10);
count.add(5).mul(2);
const _keep2 = count.get();
`);
    expect(out.stderr).toBe("");
    expect(out.status).toBe(0);
  });

  it("SafeInt<number> resolves to SafeInt<int32_t>, not the number→double mapping", () => {
    const result = transpileNative(`
import { SafeInt } from "@typecad/safety";
let count: SafeInt<number> = SafeInt(10);
const _keep = count;
`);
    expect(result.cpp).toContain("SafeInt<int32_t> count = SafeInt<int32_t>(10)");
    expect(result.cpp).not.toContain("SafeInt<double>");
  });

  it("explicit SafeInt<float> annotation still trips the polyfill static_assert", () => {
    // The number→int32_t rewrite is scoped to the `number` keyword; an
    // explicit floating-point annotation passes through so the designed
    // compile-time rejection fires (a successful compile here is a failure).
    const out = compileTranspiled(`
import { SafeInt } from "@typecad/safety";
let bad: SafeInt<float> = SafeInt(1.5);
const _keep = bad;
`);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/static assertion failed: SafeInt/);
  });
});
