import { describe, it } from "vitest";
import { transpileNative } from "../../setup";
describe("inline literal forEach", () => {
  it("lowers", () => {
    const out = transpileNative(`
      let total = 0;
      [1, 2, 3].forEach((v) => { total += v; });
      while (true) {}
    `);
    console.log("ERR:", out.diagnostics.filter(d => d.severity === "error").map(d => d.code));
    console.log(out.cpp.split("\n").filter(l => /total|forEach|for \(/.test(l) && !l.includes("//")).slice(0, 8).join("\n"));
  });
});
