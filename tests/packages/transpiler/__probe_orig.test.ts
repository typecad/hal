import { describe, it } from "vitest";
import { transpile } from "../../setup";

const single = (code: string) => transpile(code, { target: "native", emitMode: "single" });

describe("PROBE: ORIGINAL (pre-Fix-A) this.m.length on Map field", () => {
  it("shows what the original strategy.ts emitted", () => {
    const r = single(`
      class C {
        private m: Map<int32_t, int32_t> = new Map();
        public n(): int32_t { return this.m.length; }
      }
      export function main(): void {}
    `);
    const out = (r.cpp ?? "") + (r.header ?? "");
    const lines = out.split("\n").filter((l: string) => /strlen|\.size|return.*m|n\(\)/.test(l));
    console.log("[ORIGINAL this.m.length]:");
    for (const l of lines) console.log("   |", l);
  });
});
