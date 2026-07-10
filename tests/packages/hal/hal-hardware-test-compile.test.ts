import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { preprocess } from "../../../packages/expect/src/host/preprocessor.ts";
import { transpile } from "../../setup";

const halTestsDir = path.join("packages", "hal", "tests");
const testFiles = fs
  .readdirSync(halTestsDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

describe("HAL hardware test compile coverage", () => {
  for (const file of testFiles) {
    it(`${file} transpiles for AVR without errors`, () => {
      const source = fs.readFileSync(path.join(halTestsDir, file), "utf8");
      const preprocessed = preprocess(source, file, { isAvr: true });
      const result = transpile(preprocessed, {
        target: "arduino",
        boardPackage: "@typecad/board-arduino-uno",
      });

      const errors = result.diagnostics.filter((d) => d.severity === "error");
      if (errors.length) {
        console.log(`${file} errors:`, errors);
      }
      expect(errors).toEqual([]);
      expect(result.cpp).not.toContain("Typecad.h");
      expect(result.cpp).not.toContain("this->_lastFreq");
      expect(result.cpp).not.toContain("Pulse::");
      expect(result.cpp).not.toContain("Shift.write(");
    });
  }
});
