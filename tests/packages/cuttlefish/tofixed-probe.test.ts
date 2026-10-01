import { describe, it } from "vitest";
import { transpileNative } from "../../setup";
import { runNode } from "./differential-corpus";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

describe("toFixed probe", () => {
  it("half-way + near-tie values match Node", () => {
    const ts = `
      report(\`a=\${(1.125).toFixed(2)} b=\${(2.675).toFixed(2)} c=\${(-1.005).toFixed(2)} e=\${(0.5).toFixed(0)} f=\${(1.5).toFixed(0)} g=\${(-2.5).toFixed(0)} h=\${(1.305).toFixed(2)} i=\${(2.775).toFixed(2)}\`);
    `;
    const dir = ".build/tofixed";
    fs.mkdirSync(dir, { recursive: true });
    const nodeOut = runNode(ts, dir);
    const { cpp } = transpileNative(ts);
    const shim = ["#include <cstdio>", "#include <cstring>", "#include <string>", "void report(const std::string& s) { std::puts(s.c_str()); }", ""].join(String.fromCharCode(10));
    fs.writeFileSync(path.join(dir, "case.cpp"), shim + cpp);
    const c = spawnSync("g++", ["-std=c++20", path.join(dir, "case.cpp"), "-o", path.join(dir, "case.exe")], { encoding: "utf8" });
    if (c.status !== 0) { console.log("COMPILE FAIL:", (c.stderr ?? "").slice(0, 400)); }
    const run = spawnSync(path.join(dir, "case.exe"), { encoding: "utf8" });
    console.log("node:  ", nodeOut.trim());
    console.log("native:", (run.stdout ?? "").trim());
  });
});
