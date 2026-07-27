import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";
import { resolve } from "path";
import { readFileSync } from "fs";

/**
 * Task 2.8 — Golden-path snapshot for demo-weather.
 *
 * Freezes the deviation set that demo-weather produces under --autosar=warn.
 * Any PR that adds a deviation must update this snapshot (visible in code
 * review). Any PR that removes a deviation (renderer improved) also updates
 * the snapshot, surfacing the win.
 *
 * The snapshot captures only the AUTOSAR_* diagnostic codes + counts — not
 * the full emitted text — so it's robust against unrelated emit changes.
 */
describe("demo-weather deviation snapshot", () => {
  it("matches the recorded deviation set for demo-weather", () => {
    const demoSrc = readFileSync(
      resolve(__dirname, "../../../../demos/demo-weather/src/main.ts"),
      "utf-8",
    );
    const result = transpile(demoSrc, { target: "arduino", autosar: "warn" });

    // Build a stable summary: sorted list of {code, severity, count}.
    const counts = new Map<string, { code: string; severity: string; count: number }>();
    for (const d of result.diagnostics) {
      if (typeof d.code !== "string" || !d.code.startsWith("AUTOSAR_")) continue;
      const key = `${d.code}|${d.severity}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { code: d.code, severity: d.severity, count: 1 });
      }
    }
    const summary = [...counts.values()].sort((a, b) =>
      a.code < b.code ? -1 : a.code > b.code ? 1 : a.severity < b.severity ? -1 : 1,
    );
    expect(summary).toMatchSnapshot();
  });
});
