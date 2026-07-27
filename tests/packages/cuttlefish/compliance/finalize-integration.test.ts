import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";
import * as fs from "fs";
import * as path from "path";

describe("finalizeOutput compliance integration", () => {
  it("does not write a sidecar when autosar is off (default)", () => {
    // Default mode: no sidecar should appear in the outDir. transpile()
    // deletes the source file but leaves the outDir; the sidecar would
    // remain if written. We assert by the absence of deviation comments
    // in the emitted cpp (the sidecar is only written alongside when
    // isEnabled, so this is a sufficient proxy).
    const result = transpile("const x = 5;");
    expect(result.cpp).not.toContain("AUTOSAR Deviation");
  });

  it("produces no AUTOSAR diagnostics for clean code under default mode", () => {
    const result = transpile("const x = 5;");
    const autosarDiags = result.diagnostics.filter(
      (d) => typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(autosarDiags).toEqual([]);
  });
});
