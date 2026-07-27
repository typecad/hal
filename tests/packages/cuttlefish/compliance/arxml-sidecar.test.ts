import { describe, it, expect } from "vitest";
import {
  buildProgramIR,
  emitCpp,
} from "../../../../packages/cuttlefish/src/testing";
import * as fs from "fs";
import * as path from "path";

/**
 * Verifies the --autosar-arxml flag actually writes the .arxml sidecar
 * alongside the JSON sidecar, end-to-end through emitCpp.
 */
describe("--autosar-arxml sidecar emission", () => {
  it("writes both .json and .arxml sidecars when autosarArxml is true", () => {
    // Use emitCpp directly so we can keep the outDir and inspect both files.
    const outDir = path.resolve(".build/tests/arxml-probe");
    fs.mkdirSync(outDir, { recursive: true });
    // Clean any previous artifacts.
    for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

    const programIR = buildProgramIR("probe.ts", "const x = 5;");
    const result = emitCpp(programIR, {
      outDir,
      emitMode: "cpp",
      target: "generic",
      libdefs: new Map(),
      emitMaps: false,
      autosar: "warn",
      autosarArxml: true,
      toolVersion: "test-1.0",
    });

    const jsonPath = path.join(outDir, path.basename(result.sourcePath).replace(/\.\w+$/, ".autosar-deviations.json"));
    const arxmlPath = path.join(outDir, path.basename(result.sourcePath).replace(/\.\w+$/, ".autosar-deviations.arxml"));
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(arxmlPath)).toBe(true);

    const arxml = fs.readFileSync(arxmlPath, "utf-8");
    expect(arxml).toContain("<?xml");
    expect(arxml).toContain("<AUTOSAR");

    // Cleanup
    for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
    fs.rmdirSync(outDir);
  });
});
