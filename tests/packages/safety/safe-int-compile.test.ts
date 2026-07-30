import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { safeIntPolyfill } from "../../../packages/safety/src/runtime/safe-int";

// Behavioral verification of SafeInt: compile the actual polyfill C++ and
// exercise the chaining, sticky-fault, and overflow-detection logic. Models
// on tests/packages/safety/safe-variable-compile.test.ts.

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
const SAFE_INT_SRC = safeIntPolyfill().helperFunctions.join("\n");

function compileAndRun(source: string): string[] {
  if (!COMPILER) throw new Error("no compiler");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-si-"));
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

describe("SafeInt chaining (compiled + run)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  it("chains add/mul/add and mutates the original object", () => {
    // SafeInt<int32_t>(10).add(5).mul(2).add(100) => 10+5=15, *2=30, +100=130
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(10);
  x.add(5).mul(2).add(100);
  std::printf("[TC:value=%d]\\n", static_cast<int>(x.get()));
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  // Second get() confirms mutation persisted.
  std::printf("[TC:again=%d]\\n", static_cast<int>(x.get()));
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "value")).toBe("130");
    expect(field(out, "fault")).toBe("0");
    expect(field(out, "again")).toBe("130");
  });

  it("sub and divide chain correctly", () => {
    // (100).sub(30).divide(2) => 70/2 = 35
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(100);
  x.sub(30).divide(2);
  std::printf("[TC:value=%d]\\n", static_cast<int>(x.get()));
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "value")).toBe("35");
  });

  it("mod and negate chain correctly", () => {
    // (17).mod(5).negate() => 2, then -2
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(17);
  x.mod(5).negate();
  std::printf("[TC:value=%d]\\n", static_cast<int>(x.get()));
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "value")).toBe("-2");
  });

  it("absValue() flips a negative to positive", () => {
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(-42);
  x.absValue();
  std::printf("[TC:value=%d]\\n", static_cast<int>(x.get()));
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "value")).toBe("42");
  });
});

describe("SafeInt sticky fault (compiled + run)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  it("overflow mid-chain sets fault and skips subsequent ops", () => {
    // INT32_MAX + 1 overflows => fault; .mul(2) is a no-op; get() returns INT32_MAX.
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(std::numeric_limits<int32_t>::max());
  x.add(1).mul(2);
  std::printf("[TC:value=%d]\\n", static_cast<int>(x.get()));
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  std::printf("[TC:valid=%d]\\n", x.valid() ? 1 : 0);
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "value")).toBe(String(2147483647));   // last good value
    expect(field(out, "fault")).toBe("1");
    expect(field(out, "valid")).toBe("0");
  });

  it("add overflow: MAX + 1", () => {
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(std::numeric_limits<int32_t>::max());
  x.add(1);
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("sub overflow: MIN - 1 (direct pre-check path)", () => {
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(std::numeric_limits<int32_t>::min());
  x.sub(1);
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("mul overflow: MAX * 2", () => {
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(std::numeric_limits<int32_t>::max());
  x.mul(2);
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("mul: value==MIN && factor==-1 (|MIN| not representable)", () => {
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(std::numeric_limits<int32_t>::min());
  x.mul(-1);
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("divide by zero", () => {
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(100);
  x.divide(0);
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("divide: MIN / -1 (overflow)", () => {
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(std::numeric_limits<int32_t>::min());
  x.divide(-1);
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("mod by zero", () => {
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(100);
  x.mod(0);
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("negate(MIN) overflows", () => {
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(std::numeric_limits<int32_t>::min());
  x.negate();
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("absValue(MIN) overflows", () => {
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(std::numeric_limits<int32_t>::min());
  x.absValue();
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("reset() clears the fault and re-arms the chain", () => {
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int32_t> x(2147483647);
  x.add(1);          // fault
  x.reset(10);
  x.add(5);          // works again
  std::printf("[TC:value=%d]\\n", static_cast<int>(x.get()));
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "value")).toBe("15");
    expect(field(out, "fault")).toBe("0");
  });
});

describe("SafeInt width coverage (compiled + run)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  // Confirm the pre-checks work at every width, including int64_t which has
  // no wider promotion type (the reason we use pre-checks not reconstruction).

  it("int8_t chains and faults at its own bounds", () => {
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int8_t> x(100);
  x.add(20).add(7);   // 100+20=120, +7=127 (ok), next would overflow
  std::printf("[TC:value=%d]\\n", static_cast<int>(x.get()));
  x.add(1);           // 127+1 overflows int8_t
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "value")).toBe("127");
    expect(field(out, "fault")).toBe("1");
  });

  it("int16_t chains and faults at its own bounds", () => {
    const src = `
#include <cstdint>
#include <cstdio>
${SAFE_INT_SRC}
int main() {
  SafeInt<int16_t> x(32000);
  x.mul(2);           // 64000 > 32767 => overflow
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    expect(field(compileAndRun(src), "fault")).toBe("1");
  });

  it("int64_t chains and faults at its own bounds (no wider type)", () => {
    const src = `
#include <cstdint>
#include <cstdio>
#include <limits>
${SAFE_INT_SRC}
int main() {
  SafeInt<int64_t> x(std::numeric_limits<int64_t>::max());
  x.add(1);           // INT64_MAX + 1 overflows; pre-check must catch it
  std::printf("[TC:fault=%d]\\n", x.hasFault() ? 1 : 0);
  // And a valid int64 chain works (well within bounds):
  SafeInt<int64_t> y(4000000000000000000LL);   // 4.0e18
  y.add(1000000000000000000LL);                 // + 1.0e18 = 5.0e18 (< 9.2e18)
  std::printf("[TC:big=%d]\\n", y.hasFault() ? 1 : 0);
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "fault")).toBe("1");
    expect(field(out, "big")).toBe("0");
  });
});

describe("SafeInt static_assert (compile-fail)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  // Each of these must FAIL to compile (the static_assert must fire). A
  // successful compile is a test failure.

  function expectCompileFails(typeArgs: string, ctor: string, label: string): void {
    it(label, () => {
      // Include <string> so std::string is recognized — otherwise g++ fails
      // on the unknown type before the static_assert can fire, and the error
      // message doesn't match the assertion.
      const src = `
#include <cstdint>
#include <string>
${SAFE_INT_SRC}
int main() {
  SafeInt<${typeArgs}> x(${ctor});
  (void)x;
  return 0;
}`.trim();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-si-fail-"));
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
        expect(stderr).toMatch(/static_assert|requires a signed integer T/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }

  expectCompileFails("uint32_t", "0u", "rejects uint32_t (unsigned)");
  expectCompileFails("bool", "true", "rejects bool");
  expectCompileFails("float", "1.0f", "rejects float");
  expectCompileFails("double", "1.0", "rejects double");
  expectCompileFails("std::string", "\"hello\"", "rejects std::string");
});
