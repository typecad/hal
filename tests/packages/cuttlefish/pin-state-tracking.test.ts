// ---------------------------------------------------------------------------
// Output Pin State Tracking Tests
//
// OutputPin.read()/isHigh()/isLow() must never lower to a hardware pin read
// (reading back a direction-only output is not portable, e.g. Zephyr).
// Instead the transpiler tracks the driven level:
//   - statically-known level → folds to a compile-time constant
//   - unknown level (loops, runtime writes, function bodies) → lowers to a
//     shadow variable that generated writes keep updated
// ---------------------------------------------------------------------------

import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { expectCppContains, expectCppNotContains, transpile } from "../../setup";
import { transpileFile } from "../../../packages/cuttlefish/src/testing";

describe("Output pin state tracking", () => {
  it("folds isLow()/isHigh() to constants when the level is statically known", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput(false);
      if (led.isLow()) { delay(1); }
      led.high();
      if (led.isHigh()) { delay(2); }
    `, { target: 'arduino' });

    // asOutput(false) → low; isLow folds to !false. After the unconditional
    // high(), isHigh folds to true.
    expectCppContains(result, ['if (!false)', 'if (true)']);
    expectCppNotContains(result, ['digitalRead(13)', '__tc_pin_state_']);
  });

  it("folds read() to the tracked constant", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput(true);
      const v = led.read();
    `, { target: 'arduino' });

    expectCppContains(result, ['= true']);
    expectCppNotContains(result, ['digitalRead(13)']);
  });

  it("uses a shadow variable inside loops and keeps writes updated", () => {
    const result = transpile(`
      import { LED, delay } from '@typecad/board-arduino-uno';
      const led = LED.asOutput(false);
      while (true) {
        led.toggle();
        if (led.isHigh()) { delay(10); }
      }
    `, { target: 'arduino' });

    // Declaration seeded with the pre-loop level
    expectCppContains(result, ['bool __tc_pin_state_13 = false']);
    // Toggle updates hardware and shadow
    expectCppContains(result, ['__tc_pin_state_13 = (!__tc_pin_state_13)']);
    // Read inside the loop consults the shadow, not the pin
    expectCppContains(result, ['if (__tc_pin_state_13)']);
    expectCppNotContains(result, ['digitalRead(13)']);
  });

  it("uses a shadow variable for runtime-valued writes", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      import { D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInputPullUp();
      const led = LED.asOutput(false);
      led.write(btn.read());
      const on = led.isHigh();
    `, { target: 'arduino' });

    // The input pin still reads hardware
    expectCppContains(result, ['digitalRead(2)']);
    // The output pin does not
    expectCppNotContains(result, ['digitalRead(13)']);
    expectCppContains(result, ['__tc_pin_state_13']);
  });

  it("invalidates the level across conflicting branches", () => {
    const result = transpile(`
      import { LED, D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInputPullUp();
      const led = LED.asOutput(false);
      if (btn.read()) { led.high(); } else { led.low(); }
      const on = led.isHigh();
    `, { target: 'arduino' });

    // Branch join disagrees → shadow variable, hardware write still emitted
    expectCppContains(result, ['__tc_pin_state_13']);
    expectCppContains(result, ['digitalWrite(13, HIGH)']);
    expectCppNotContains(result, ['digitalRead(13)', 'bool on = true', 'bool on = false']);
  });

  it("keeps branches that agree foldable", () => {
    const result = transpile(`
      import { LED, D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInputPullUp();
      const led = LED.asOutput(false);
      if (btn.read()) { led.high(); } else { led.high(); }
      const on = led.isHigh();
    `, { target: 'arduino' });

    expectCppContains(result, ['= true']);
    expectCppNotContains(result, ['digitalRead(13)', '__tc_pin_state_']);
  });

  it("folds reads after a conditional write via the shadow form", () => {
    // After `if (c) led.high()` the level depends on the condition, so a
    // subsequent read must consult the tracked variable, not fold.
    const result = transpile(`
      import { LED, D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInputPullUp();
      const led = LED.asOutput(false);
      if (btn.read()) { led.high(); }
      const on = led.isHigh();
    `, { target: 'arduino' });

    expectCppContains(result, ['__tc_pin_state_13']);
    expectCppNotContains(result, ['digitalRead(13)']);
  });

  it("forces the shadow form inside function bodies", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput(false);
      function check(): boolean {
        return led.isLow();
      }
    `, { target: 'arduino' });

    // Static level is known at the definition site, but the function runs
    // at an unmodeled time — must not fold
    expectCppContains(result, ['__tc_pin_state_13']);
    expectCppNotContains(result, ['digitalRead(13)', 'return true', 'return false']);
  });

  it("leaves input pin reads as hardware reads", () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInputPullUp();
      while (btn.isLow()) { }
    `, { target: 'arduino' });

    expectCppContains(result, ['digitalRead(2)']);
    expectCppNotContains(result, ['__tc_pin_state_']);
  });

  it("invalidates the tracked level after pwm() and tone()", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput(true);
      const b = led.isHigh();
      led.pwm(128);
      const a = led.isHigh();
      led.tone(440);
      const c = led.read();
    `, { target: 'arduino' });

    // Before pwm the level folds to true; after pwm/tone the reads must
    // consult the shadow variable instead of the stale literal
    expectCppContains(result, ['const auto b = true', '__tc_pin_state_13']);
    expectCppNotContains(result, ['digitalRead(13)', 'const auto a = true', 'const auto c = true']);
  });

  it("keeps shadow updates intact in multi-file programs (regression)", async () => {
    // All files' IRs are built (each build resetting the pin tracker) before
    // any file emits — the write ops must carry the shadow-update flag baked
    // in at build time, or writes in earlier-built files never update the
    // shadow variable their reads consult.
    const dir = fs.mkdtempSync(path.resolve(".build/tests/pinshadow-"));
    try {
      fs.writeFileSync(path.join(dir, "pins.ts"), [
        "import { LED, D2, delay } from '@typecad/board-arduino-uno';",
        "export const btn = D2.asInputPullUp();",
        "export const led = LED.asOutput(false);",
        "export function drive(): void {",
        "  led.write(btn.read());",
        "  if (led.isHigh()) { delay(1); }",
        "}",
        "",
      ].join("\n"), "utf8");
      fs.writeFileSync(path.join(dir, "main.ts"), [
        'import { drive } from "./pins.js";',
        "function main(): void {",
        "  drive();",
        "}",
        "",
      ].join("\n"), "utf8");

      await transpileFile({
        inputFile: path.join(dir, "main.ts"),
        emitMode: "split",
        target: "arduino",
        emitMaps: false,
        outDir: path.join(dir, "out"),
      });

      const walk = (d: string): string[] => {
        const files: string[] = [];
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) files.push(...walk(p));
          else if (/\.(cpp|h|ino)$/.test(e.name)) files.push(p);
        }
        return files;
      };
      const text = walk(path.join(dir, "out"))
        .map(f => fs.readFileSync(f, "utf8"))
        .join("\n");

      // The runtime-valued write must update the shadow variable the read
      // consults — not just drive the pin and leave the shadow stale.
      expect(text).toMatch(/bool __tc_pin_state_13 = false/);
      expect(text).toMatch(/__tc_pin_state_13 = \(\(digitalRead\(2\)\) != 0\)/);
      expect(text).toMatch(/if \(__tc_pin_state_13\)/);
      expect(text).not.toMatch(/digitalRead\(13\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
