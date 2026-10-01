import { describe, it } from "vitest";
import { runDifferentialSuite } from "./differential-corpus";

describe("differential execution — Node oracle vs transpiled native", () => {
  it("the boundary-matrix corpus produces identical output on both sides", () => {
    runDifferentialSuite();
  }, 600000);
});
