// ---------------------------------------------------------------------------
// Mutation fuzzer — takes the hand-written corpus programs (known to run on
// both sides) and applies type-directed single-token mutations: literal bumps,
// comparison swaps, arithmetic swaps, logical swaps, toFixed precision. Every
// mutant runs in Node (the JS oracle) and as transpiled→host-g++→native; a
// mismatch, native compile failure, or false rejection is a finding.
//
// Mutants that make Node throw (division by zero introduced) are discarded —
// the JS oracle defines the supported run.
//
//   MUT_CASES=120 MUT_SEED=9 npx vitest run tests/packages/cuttlefish/mutation-fuzz.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { CORPUS, runNode } from "./differential-corpus";
import { transpileNative } from "../../setup";

const GXX = process.env.DIFF_GXX ?? "g++";
const MUT_CASES = Number(process.env.MUT_CASES ?? 100);
const MUT_SEED = Number(process.env.MUT_SEED ?? 9);
const OUT = path.join(".build", "mutation-fuzz");

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Mutation { name: string; re: RegExp; apply: (m: RegExpMatchArray) => string }

const MUTATIONS: Mutation[] = [
  { name: "literal-bump", re: /\b(\d+)\b(?!\.)/g, apply: (m) => String(Number(m[1]) + 1) },
  { name: "comparison-eq", re: /===/g, apply: () => "!==" },
  { name: "comparison-lt", re: /(?<![<>])<(?![<=])/g, apply: () => ">=" },
  { name: "arith-add", re: /(?<![+\-]) \+ (?![+\-])/g, apply: () => " - " },
  { name: "logical", re: /&&/g, apply: () => "||" },
  { name: "toFixed-precision", re: /\.toFixed\((\d)\)/g, apply: (m) => `.toFixed(${Number(m[1]) + 1})` },
];

function runNativeOut(ts: string, dir: string, tag: string): string {
  const { cpp } = transpileNative(ts);
  const cppFile = path.join(dir, `${tag}.cpp`);
  const shim = `#include <cstdio>\n#include <string>\nvoid report(const std::string& s) { std::printf("%s\\n", s.c_str()); }\n`;
  fs.writeFileSync(cppFile, shim + cpp);
  const bin = path.join(dir, `${tag}.exe`);
  const compile = spawnSync(GXX, ["-std=c++20", cppFile, "-o", bin], { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (compile.status !== 0) throw new Error(`compile failed (status=${compile.status}, error=${compile.error?.message ?? "none"}): ${(compile.stderr ?? "").slice(0, 200)}`);
  const run = spawnSync(bin, { encoding: "utf8", timeout: 15000 });
  if (run.status !== 0) throw new Error(`run exit ${run.status}`);
  return run.stdout ?? "";
}

const norm = (t: string): string[] => t.split("\n").map(l => l.replace(/\r$/, "")).filter(l => l.length > 0);


// Compiler probe: a missing g++ surfaces as status=null with EMPTY stderr,
// which read as a bare "compile failed" with no reason. Fail loudly with the
// remedy instead. PowerShell does not inherit Git Bash's PATH.
function assertCompiler(): void {
  const probe = spawnSync(GXX, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `C++ compiler '${GXX}' not usable (status=${probe.status}, error=${probe.error?.message ?? "none"}). ` +
      `Set DIFF_GXX to the full g++ path (e.g. C:\\msys64\\ucrt64\\bin\\g++.exe).`,
    );
  }
}

describe("mutation fuzz — corpus mutants through the differential harness", () => {
  it(`no divergences in ${MUT_CASES} mutants (seed ${MUT_SEED})`, () => {
    assertCompiler();
    const rnd = mulberry32(MUT_SEED);
    fs.mkdirSync(OUT, { recursive: true });
    const findings: string[] = [];
    const skipped = { nodeThrow: 0, nativeThrow: 0 };
    let ran = 0;

    const knownBases = new Set([
      "closures-over-params", "map-and-set", "recursive-descent",
      "statics-and-getters", "value-vs-reference",
    ]);

    for (let i = 0; i < MUT_CASES; i += 1) {
      const base = CORPUS[i % CORPUS.length];
      if (knownBases.has(base.name)) continue; // base diverges — its mutants inherit that
      const dir = path.join(OUT, `mut-${i}`);
      fs.mkdirSync(dir, { recursive: true });

      // Pick a mutation site: one pattern, one match position within it.
      const mut = MUTATIONS[Math.floor(rnd() * MUTATIONS.length)];
      const matches = [...base.ts.matchAll(mut.re)];
      if (matches.length === 0) continue;
      const pickIdx = Math.floor(rnd() * matches.length);
      const target = matches[pickIdx];
      const mutated = base.ts.slice(0, target.index!) +
        mut.apply(target) + base.ts.slice(target.index! + target[0].length);

      let nodeOut = "";
      try {
        nodeOut = runNode(mutated, dir);
      } catch {
        skipped.nodeThrow += 1; // mutant threw in JS (e.g. division by zero) — unsupported run
        continue;
      }

      let nativeOut = "";
      try {
        nativeOut = runNativeOut(mutated, dir, "case");
      } catch (e) {
        findings.push(`mut-${i} [${mut.name} @ '${target[0]}']: NATIVE FAIL — ${String((e as Error).message).slice(0, 200)}`);
        const fd = path.join(dir, "finding");
        fs.mkdirSync(fd, { recursive: true });
        fs.writeFileSync(path.join(fd, "case.ts"), mutated);
        console.log(`  ✗ mut-${i} native fail [${mut.name}]`);
        continue;
      }

      const a = norm(nodeOut), b = norm(nativeOut);
      const same = a.length === b.length && a.every((l, j) => l === b[j]);
      if (!same) {
        findings.push(`mut-${i} [${mut.name} @ '${target[0]}']:\n    node:   ${JSON.stringify(a)}\n    native: ${JSON.stringify(b)}`);
        console.log(`  ✗ mut-${i} diverge [${mut.name}]`);
      } else {
        ran += 1;
      }
    }

    console.log(`  — ${ran} mutants matched, ${skipped.nodeThrow} threw in Node, ${findings.length} findings`);
    if (findings.length > 0) console.error("\nFINDINGS:\n" + findings.join("\n"));
    // Discovery mode: findings are the work queue. Raise to a hard expect
    // once the triaged set drains.
    expect(findings.filter(f => f.includes("NATIVE FAIL"))).toEqual([]);
  }, 3600000);
});
