import { describe, it } from "vitest";
import { transpileNative } from "../../setup";
import * as fs from "node:fs";

describe("tf163", () => {
  it("emission", () => {
    const ts = `
      let f1 = 2.03;
      f1 = f1 * 1.5;
      report(\`f1=\${f1.toFixed(2)}\`);
    `;
    const out = transpileNative(ts);
    fs.writeFileSync(".build/tf163.cpp", out.cpp);
    const i = out.cpp.indexOf("__tc_toFixed(f1");
    console.log("CALL:", out.cpp.slice(i - 20, i + 40));
    const j = out.cpp.indexOf("double scale = 1.0");
    console.log(out.cpp.slice(j, j + 420));
  });
});
