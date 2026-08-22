import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ComplianceContext } from "../../../../packages/cuttlefish/src/emit/compliance/compliance-context";
import { runSelfCheck } from "../../../../packages/cuttlefish/src/emit/compliance/rule-engine";

// ---------------------------------------------------------------------------
// Library-package shims are emitted into generated applications verbatim, so
// they must pass --autosar=strict exactly like framework shims (AGENTS.md).
// This guards the shipped bytes of @typecad/zephyr-esp32s3-rgb.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const shimsDir = join(here, "..", "..", "..", "..", "packages", "zephyr-esp32s3-rgb", "shims");

describe("@typecad/zephyr-esp32s3-rgb shims under --autosar=strict", () => {
  it("__tc_rgbled.h/.cpp produce no unrecorded AUTOSAR violations", () => {
    const header = readFileSync(join(shimsDir, "__tc_rgbled.h"), "utf8").split("\n");
    const source = readFileSync(join(shimsDir, "__tc_rgbled.cpp"), "utf8").split("\n");
    const ctx = new ComplianceContext("strict");
    const findings = runSelfCheck(ctx, source, header);
    expect(findings).toEqual([]);
  });
});
