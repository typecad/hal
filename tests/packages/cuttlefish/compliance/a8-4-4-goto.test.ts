import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * A8-4-4: no goto.
 *
 * TypeCAD lowers TS labeled `break` (`break outerLoop;`) to
 * `goto __break_<label>;` because C++ doesn't have labeled break. This is
 * the only emit site for goto. Under autosar=warn, each goto site should
 * record a deviation; under autosar=strict the build should still succeed
 * (goto is unavoidable here short of a major control-flow rewrite).
 *
 * This test documents the current behavior. A future task could rewrite
 * labeled-break to a structured-flag form and eliminate the goto entirely;
 * until then, it's a documented deviation.
 */
describe("A8-4-4: no goto", () => {
  it("emits goto for TS labeled break (current behavior, off by default)", () => {
    const ts = `
let x = 0;
outer: for (let i = 0; i < 5; i++) {
  for (let j = 0; j < 5; j++) {
    x = x + 1;
    if (x > 3) break outer;
  }
}
`;
    const result = transpile(ts);
    // The renderer emits goto __break_outer; — confirmed present.
    expect(result.cpp).toMatch(/goto\s+__break_/);
  });

  it("does not emit AUTOSAR_A8-4-4 error diagnostic under autosar=warn (deviation path)", () => {
    const ts = `
let x = 0;
outer: for (let i = 0; i < 5; i++) {
  for (let j = 0; j < 5; j++) {
    x = x + 1;
    if (x > 3) break outer;
  }
}
`;
    const result = transpile(ts, { autosar: "warn" });
    const errors = result.diagnostics.filter(
      (d) => d.code === "AUTOSAR_A8-4-4" && d.severity === "error",
    );
    // Advisory: no hard error in warn mode.
    expect(errors).toEqual([]);
  });

  it("a normal (unlabeled) break emits no goto", () => {
    const ts = `
for (let i = 0; i < 5; i++) {
  if (i > 2) break;
}
`;
    const result = transpile(ts, { autosar: "strict" });
    expect(result.cpp).not.toMatch(/goto/);
  });
});
