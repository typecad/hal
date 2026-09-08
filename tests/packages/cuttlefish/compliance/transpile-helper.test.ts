import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";
import * as fs from "fs";
import * as path from "path";

describe("transpile() helper with autosar option", () => {
  // ~20s standalone; under full-suite parallel load it can stretch well past
  // the 60s default ceiling — give it headroom so it fails on regressions,
  // not on worker contention.
  it("writes a sidecar deviation registry when autosar is 'warn'", { timeout: 180_000 }, () => {
    // Snapshot the existing sidecar files so we can identify the ones this
    // call creates (and clean them up — transpile() deletes the .cpp but
    // leaves the sidecar).
    // transpile() now uses a per-call unique out dir (parallel-worker race fix),
    // so scan the whole tree for the freshly created sidecar.
    const testOutRoot = path.resolve(".build/tests");
    const walkSidecars = (dir: string): string[] =>
      !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walkSidecars(full)
          : e.name.endsWith(".autosar-deviations.json") ? [full] : [];
      });
    const before = new Set(walkSidecars(testOutRoot));

    const result = transpile("const x: number = 5;", { autosar: "warn" });
    expect(result.cpp).toBeDefined();

    const created = walkSidecars(testOutRoot).filter((f) => !before.has(f));
    expect(created.length).toBeGreaterThan(0);

    const sidecar = JSON.parse(fs.readFileSync(created[0], "utf-8"));
    expect(sidecar.standard).toBe("AUTOSAR C++14");
    expect(sidecar.tool).toBe("typecad-hal");

    // Cleanup: remove every sidecar this test created.
    for (const f of created) {
      fs.unlinkSync(f);
    }
  });

  it("does not write a sidecar when autosar is omitted (default off)", () => {
    // The default-off path must not write a sidecar. We assert this by
    // checking the emitted cpp carries no AUTOSAR Deviation marker (which
    // would only be present if compliance was enabled). Avoids the flaky
    // count-the-directory approach that breaks under parallel test workers.
    const result = transpile("const y: number = 7;");
    expect(result.cpp).not.toContain("// AUTOSAR Deviation");
    expect(result.cpp).not.toContain("AUTOSAR Deviation");
  });
});
