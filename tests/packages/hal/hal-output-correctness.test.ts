import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { preprocess } from "../../../packages/expect/src/host/preprocessor.ts";
import { transpile } from "../../setup";

/**
 * Golden-correctness guard: transpile each HAL hardware test source and assert
 * the generated C++ contains the *correct* constructs (not just "transpiles
 * without errors"). This locks the bug fixes in commit 80c73e3's follow-up:
 *
 *  - SPI setBitOrder('msb') → MSBFIRST (not LSBFIRST)
 *  - I2C readByte → Wire.requestFrom() present before Wire.read()
 *  - WDT enable('250ms') → wdt_enable(WDTO_250MS) (not the raw string)
 *  - free attachInterrupt → unquoted FALLING/RISING/CHANGE macros
 *
 * Without this, `hal-hardware-test-compile.test.ts` only checks for transpiler
 * diagnostics, so silently-wrong C++ (compiles via -fpermissive but does the
 * wrong thing at runtime) ships undetected.
 */

const halTestsDir = path.join("packages", "hal", "tests");

function transpileHw(file: string) {
  const source = fs.readFileSync(path.join(halTestsDir, file), "utf8");
  const preprocessed = preprocess(source, file, { isAvr: true });
  return transpile(preprocessed, {
    target: "arduino",
    boardPackage: "@typecad/board-arduino-uno",
  });
}

describe("HAL hardware-test output correctness (golden guards)", () => {
  it("09-i2c.test.ts: readByte emits requestFrom before read (no dropped op)", () => {
    const { cpp } = transpileHw("09-i2c.test.ts");
    // Every readByte path must request bytes before reading. The dropped-op bug
    // emitted Wire.read() with no preceding requestFrom.
    expect(cpp).toContain("Wire.requestFrom(");
    // No statement should be silently dropped to an unhandled-op comment.
    expect(cpp).not.toContain("unhandled hal-op");
  });

  it("10-spi.test.ts (uno variant): setBitOrder maps 'msb' → MSBFIRST", () => {
    // The spi group moved under tests/boards/<board>/ with the per-board
    // suite split; the uno variant carries the AVR-compatible D-pin names.
    const { cpp } = transpileHw("boards/uno/10-spi.test.ts");
    expect(cpp).toContain("SPI.setBitOrder(MSBFIRST)");
  });

  it("13-wdt.test.ts: WDT.enable('8s') emits the WDTO_8S macro", () => {
    // The hw test uses 8 s timeouts (STM32 IWDG cannot be disabled once
    // started — a short timeout resets the board mid-protocol). The string
    // must map to the macro on AVR exactly the same way.
    const { cpp } = transpileHw("13-wdt.test.ts");
    expect(cpp).toContain("wdt_enable(WDTO_8S)");
    // The raw string must never reach the macro (garbage timeout on hardware).
    expect(cpp).not.toMatch(/wdt_enable\("8s"\)/);
  });

  it("07-interrupts.test.ts: free attachInterrupt emits unquoted mode macros", () => {
    const { cpp } = transpileHw("07-interrupts.test.ts");
    // The free-function path previously emitted the mode as a quoted string
    // ("FALLING"), which compiles via -fpermissive but registers the wrong
    // interrupt mode. It must emit the unquoted Arduino macro.
    expect(cpp).toMatch(/attachInterrupt\([^,]+,[^,]+,\s*(?:FALLING|RISING|CHANGE)\)/);
    expect(cpp).not.toMatch(/attachInterrupt\([^)]*"(?:FALLING|RISING|CHANGE)"/);
  });
});
