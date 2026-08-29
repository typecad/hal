import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { modeTablePolyfill } from "../../../../packages/cuttlefish/src/safety/runtime/mode-table";
import { voterPolyfill } from "../../../../packages/cuttlefish/src/safety/runtime/vote";

// Behavioral verification: compile the actual safety polyfill C++ and run it.
// This catches logic bugs that substring-match tests cannot — e.g. the
// previously-shipped SafeInt32::safeSub UB, or a voter branch that compiles
// but returns the wrong fault code. Models on
// packages/cuttlefish/src/frameworks/native (see the native tests).

/** Resolve a C++ compiler + env, preferring g++ then clang++. Returns null if
 *  no compiler is reachable (test suite skips in that case). */
function resolveCompiler(): { cmd: string; env: NodeJS.ProcessEnv } | null {
  const env = { ...process.env };
  if (process.platform === "win32") {
    const candidates = [
      "C:\\msys64\\ucrt64\\bin",
      "C:\\msys64\\mingw64\\bin",
    ];
    for (const binDir of candidates) {
      const gpp = path.join(binDir, "g++.exe");
      if (fs.existsSync(gpp)) {
        env.PATH = `${binDir};${env.PATH ?? ""}`;
        return { cmd: "g++", env };
      }
    }
  }
  // Non-Windows: rely on PATH.
  const probe = spawnSync("g++", ["--version"], { encoding: "utf8" });
  if (probe.status === 0) return { cmd: "g++", env };
  const probe2 = spawnSync("clang++", ["--version"], { encoding: "utf8" });
  if (probe2.status === 0) return { cmd: "clang++", env };
  return null;
}

const COMPILER = resolveCompiler();

/** Compile + run a C++ source string. Returns parsed [TC:...] protocol lines
 *  from stdout. Throws on compile failure (so the test fails loudly rather
 *  than silently skipping). */
function compileAndRun(source: string): string[] {
  if (!COMPILER) {
    throw new Error("no compiler — caller must guard with COMPILER");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-safety-"));
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
      throw new Error(
        `Compilation failed:\n${compile.stdout ?? ""}\n${compile.stderr ?? ""}`,
      );
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

/** Build a standalone C++ program that links the safety polyfills against a
 *  controllable mock __tc_gpio_read / __tc_delay_us. The mock lets the test
 *  inject the read sequence (for vote-disagreement) and record delay calls. */
function buildVoterHarness(args: {
  pinMode: number;        // TrackedMode raw value to pre-load
  readSequence: number[]; // values returned by mock __tc_gpio_read, in order
}): string {
  const tableSrc = modeTablePolyfill().helperFunctions.join("\n");
  const voterSrc = voterPolyfill().helperFunctions.join("\n");
  return `
#include <cstdint>
#include <cstdio>

${tableSrc}

${voterSrc}

// ── Mocks ──────────────────────────────────────────────────────────────────
static int g_read_index = 0;
static int g_reads[16];
static int g_delay_calls = 0;

int __tc_gpio_read(uint32_t /*pin*/) {
  int v = g_reads[g_read_index];
  ++g_read_index;
  return v;
}
void __tc_delay_us(uint32_t /*us*/) { ++g_delay_calls; }

int main() {
  // Pre-load the pin mode for pin 7 (global free function).
  __tc_safety_record_pin_mode(7U, static_cast<uint32_t>(${args.pinMode}));

  // Load the read sequence.
  for (size_t i = 0; i < sizeof(g_reads)/sizeof(g_reads[0]); ++i) g_reads[i] = 0;
${args.readSequence.map((v, i) => `  g_reads[${i}] = ${v};`).join("\n")}

  const SafeReadResult r = __tc_safety::__tc_safety_read_safe(7U);

  // Report the outcome + observable side effects as protocol lines.
  std::printf("[TC:status=%u]\\n", static_cast<unsigned>(r.status));
  std::printf("[TC:code=%u]\\n", static_cast<unsigned>(r.code));
  std::printf("[TC:category=%u]\\n", static_cast<unsigned>(r.category));
  std::printf("[TC:value=%u]\\n", static_cast<unsigned>(r.value));
  std::printf("[TC:delays=%d]\\n", g_delay_calls);
  return 0;
}
`.trim();
}

function field(lines: string[], key: string): string {
  const line = lines.find((l) => l.startsWith(`[TC:${key}=`));
  if (!line) throw new Error(`missing protocol field ${key} in ${lines.join("|")}`);
  return line.slice(`[TC:${key}=`.length, -1);
}

// TrackedMode raw values (must match runtime/mode-table.ts).
const MODE_INPUT        = 0x5A5A5A5A;
const MODE_OUTPUT       = 0xA5A5A5A5;
const MODE_INPUTPULLUP  = 0x3C3C3C3C;
const MODE_INPUTPULLDOWN = 0xC3C3C3C3;
// Status / code raw values (must match runtime/result-struct.ts).
const STATUS_OK    = 0x5A5A5A5A;
const STATUS_FAULT = 0xA5A5A5A5;
const CODE_OK               = 0x3C3C3C3C;
const CODE_VOTEDISAGREEMENT = 0x5A5A5A5A;
const CODE_PINMODEMISMATCH  = 0x55AA55AA;
const CODE_PINMODEUNKNOWN   = 0xAA55AA55;

describe("safety voter (compiled + run)", { skip: !COMPILER && "no C++ compiler on PATH" }, () => {
  it("returns Ok with value=0xFFFFFFFF when all three reads agree on HIGH", () => {
    const out = compileAndRun(buildVoterHarness({
      pinMode: MODE_INPUT,
      readSequence: [1, 1, 1],
    }));
    expect(field(out, "status")).toBe(String(STATUS_OK));
    expect(field(out, "code")).toBe(String(CODE_OK));
    expect(field(out, "value")).toBe(String(0xFFFFFFFF >>> 0));
    // Two settle delays between three reads.
    expect(field(out, "delays")).toBe("2");
  });

  it("returns Ok with value=0 when all three reads agree on LOW", () => {
    const out = compileAndRun(buildVoterHarness({
      pinMode: MODE_INPUT,
      readSequence: [0, 0, 0],
    }));
    expect(field(out, "status")).toBe(String(STATUS_OK));
    expect(field(out, "value")).toBe("0");
  });

  it("returns VoteDisagreement when reads differ (r0,r1,r2 = 0,1,0)", () => {
    const out = compileAndRun(buildVoterHarness({
      pinMode: MODE_INPUT,
      readSequence: [0, 1, 0],
    }));
    expect(field(out, "status")).toBe(String(STATUS_FAULT));
    expect(field(out, "code")).toBe(String(CODE_VOTEDISAGREEMENT));
    // value is left 0 on fault per the voter contract.
    expect(field(out, "value")).toBe("0");
  });

  it("returns PinModeMismatch when the pin is configured OUTPUT", () => {
    const out = compileAndRun(buildVoterHarness({
      pinMode: MODE_OUTPUT,
      readSequence: [1, 1, 1],
    }));
    expect(field(out, "status")).toBe(String(STATUS_FAULT));
    expect(field(out, "code")).toBe(String(CODE_PINMODEMISMATCH));
    // Mode mismatch short-circuits before any reads/delays.
    expect(field(out, "delays")).toBe("0");
  });

  it("returns PinModeUnknown for an untracked pin (mode left at 0)", () => {
    // Pin 99 is never record_pin_mode'd, so get_pin_mode returns Unknown (0).
    const src = `
#include <cstdint>
#include <cstdio>
${modeTablePolyfill().helperFunctions.join("\n")}
${voterPolyfill().helperFunctions.join("\n")}
int __tc_gpio_read(uint32_t) { return 0; }
void __tc_delay_us(uint32_t) {}
int main() {
  const SafeReadResult r = __tc_safety::__tc_safety_read_safe(99U);
  std::printf("[TC:code=%u]\\n", static_cast<unsigned>(r.code));
  return 0;
}`.trim();
    const out = compileAndRun(src);
    expect(field(out, "code")).toBe(String(CODE_PINMODEUNKNOWN));
  });

  it("accepts InputPullup as a valid read mode (no false PinModeMismatch)", () => {
    const out = compileAndRun(buildVoterHarness({
      pinMode: MODE_INPUTPULLUP,
      readSequence: [0, 0, 0],
    }));
    expect(field(out, "status")).toBe(String(STATUS_OK));
  });

  it("accepts InputPulldown as a valid read mode (D4 regression guard)", () => {
    const out = compileAndRun(buildVoterHarness({
      pinMode: MODE_INPUTPULLDOWN,
      readSequence: [1, 1, 1],
    }));
    expect(field(out, "status")).toBe(String(STATUS_OK));
    expect(field(out, "code")).toBe(String(CODE_OK));
  });
});
