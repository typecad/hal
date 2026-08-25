import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { preprocess } from "../../../packages/expect/src/host/preprocessor.ts";
import { boardTestPins, buildTestPinsSubstitutions, PIN_ROLE_CONSTS, FACT_ROLE_CONSTS } from "../../../packages/expect/src/host/test-pins.ts";
import { transpile } from "../../setup";

// Compile gate for the HAL hardware suite (packages/hal/tests). These files
// only run when a board is attached (`npm run test:hw` / `npm run hal` in a
// board package); this gate runs the same preprocess + transpile steps on
// the host so they cannot rot silently between hardware runs. The board/
// groups import role names from '@typecad/test-pins' — exactly like the
// hardware runner, the gate substitutes the configured board's pins (the
// Uno here) before transpiling, and additionally asserts that no role name
// survives into the emitted C++ (a leaked identifier means the substitution
// or lowering regressed and the sketch would not compile on device).

const halTestsRoot = path.join("packages", "hal", "tests");
const suiteDirs = ["common", "board", "wired"];

const testPins = boardTestPins("@typecad/board-arduino-uno", path.resolve("."));
const substitutions = testPins ? buildTestPinsSubstitutions(testPins) : undefined;

function listSuiteFiles(): { file: string; relative: string }[] {
  const files: { file: string; relative: string }[] = [];
  for (const dir of suiteDirs) {
    const abs = path.join(halTestsRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs).sort()) {
      if (entry.endsWith(".test.ts")) {
        files.push({
          file: path.join(abs, entry),
          relative: path.join("tests", dir, entry),
        });
      }
    }
  }
  return files;
}

describe("HAL hardware test compile coverage", () => {
  it("resolves the Uno test-pins.json for substitution", () => {
    expect(testPins).toBeDefined();
    expect(substitutions).toBeDefined();
  });

  for (const { file, relative } of listSuiteFiles()) {
    it(`${relative} transpiles for AVR without errors`, () => {
      const source = fs.readFileSync(file, "utf8");
      const preprocessed = preprocess(source, path.basename(file), {
        isAvr: true,
        testPins: substitutions,
      });
      const result = transpile(preprocessed, {
        target: "arduino",
        boardPackage: "@typecad/board-arduino-uno",
      });

      const errors = result.diagnostics.filter((d) => d.severity === "error");
      if (errors.length) {
        console.log(`${relative} errors:`, errors);
      }
      expect(errors).toEqual([]);

      // No role const may survive preprocessing or lowering — every role
      // must have become a real pin symbol (or numeric literal) and then a
      // lowered Arduino call.
      const roleNames = [...Object.values(PIN_ROLE_CONSTS), ...Object.values(FACT_ROLE_CONSTS)];
      for (const role of roleNames) {
        expect(preprocessed, `${role} must be substituted during preprocessing`).not.toContain(role);
        expect(result.cpp, `${role} must not leak into emitted C++`).not.toContain(role);
      }

      expect(result.cpp).not.toContain("Typecad.h");
      expect(result.cpp).not.toContain("this->_lastFreq");
      expect(result.cpp).not.toContain("Pulse::");
      expect(result.cpp).not.toContain("Shift.write(");
    });
  }
});
