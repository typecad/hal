import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";
import * as fs from "fs";
import * as path from "path";

describe("transpile() helper with autosar option", () => {
  it("writes a sidecar deviation registry when autosar is 'warn'", () => {
    // Use a fresh outDir by relying on transpile()'s default (generic target
    // writes to .build/tests/<id>. The .cpp is deleted by transpile() but
    // the .autosar-deviations.json sidecar remains — assert its presence
    // and shape.
    const result = transpile("const x: number = 5;", { autosar: "warn" });
    expect(result.cpp).toBeDefined();

    // The sidecar is written next to the emitted source. transpile() deletes
    // the source but not the sidecar, so we find it by scanning .build/tests
    // for the most recent .autosar-deviations.json.
    const testOutDir = path.resolve(".build/tests");
    const candidates = fs
      .readdirSync(testOutDir)
      .filter((f) => f.endsWith(".autosar-deviations.json"))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(testOutDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    expect(candidates.length).toBeGreaterThan(0);
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(testOutDir, candidates[0].name), "utf-8"),
    );
    expect(sidecar.standard).toBe("AUTOSAR C++14");
    expect(sidecar.tool).toBe("cuttlefish");

    // Cleanup: remove the sidecar so it doesn't accumulate across runs.
    fs.unlinkSync(path.join(testOutDir, candidates[0].name));
  });

  it("does not write a sidecar when autosar is omitted (default off)", () => {
    // Snapshot the existing sidecar count, run a default transpile, confirm
    // no NEW sidecar appeared.
    const testOutDir = path.resolve(".build/tests");
    const before = fs.existsSync(testOutDir)
      ? fs.readdirSync(testOutDir).filter((f) => f.endsWith(".autosar-deviations.json")).length
      : 0;
    transpile("const y: number = 7;");
    const after = fs.readdirSync(testOutDir).filter((f) => f.endsWith(".autosar-deviations.json")).length;
    expect(after).toBe(before);
  });
});
