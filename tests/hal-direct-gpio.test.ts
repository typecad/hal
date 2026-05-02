import { describe, it } from "vitest";
import { expectCppContains, expectCppNotContains, transpile, transpileArduino } from "./setup";

// The GPIO HAL module using emit() for C++ injection.
const GPIO_HAL_WITH_EMIT = `
  declare function emit(text: string): void;

  declare const INPUT: number;
  declare const OUTPUT: number;
  declare const INPUT_PULLUP: number;
  declare const HIGH: number;
  declare const LOW: number;
  declare const LED_BUILTIN: number;

  declare function digitalRead(pin: number): number;
  declare function delay(ms: number): void;

  class Pin {
    private _pin: number;
    constructor(pin: number) { this._pin = pin; }
    asOutput(value: number = LOW): Pin {
      emit(\`pinMode(\${this._pin}, OUTPUT);\`);
      emit(\`digitalWrite(\${this._pin}, \${value});\`);
      return this;
    }
    asInput(): Pin {
      emit(\`pinMode(\${this._pin}, INPUT);\`);
      return this;
    }
    high(): void {
      emit(\`digitalWrite(\${this._pin}, HIGH);\`);
    }
    low(): void {
      emit(\`digitalWrite(\${this._pin}, LOW);\`);
    }
    toggle(): void {
      emit(\`digitalWrite(\${this._pin}, digitalRead(\${this._pin}) == LOW ? HIGH : LOW);\`);
    }
    read(): number { return digitalRead(this._pin); }
  }
`;

describe("emit() C++ injection", () => {
  it("injects raw C++ text from a string literal", () => {
    const result = transpile(`
      declare function emit(text: string): void;
      emit("pinMode(13, OUTPUT);");
    `);

    expectCppContains(result, ["pinMode(13, OUTPUT);"]);
  });

  it("resolves template literal interpolation in emit()", () => {
    const result = transpile(`
      declare function emit(text: string): void;
      const pin: number = 13;
      emit(\`pinMode(\${pin}, OUTPUT);\`);
    `);

    expectCppContains(result, ["pinMode(pin, OUTPUT);"]);
  });

  it("resolves this._pin inside emit template in class method", () => {
    const result = transpile(GPIO_HAL_WITH_EMIT + `
      const led: Pin = new Pin(13);
      led.asOutput(HIGH);
    `);

    expectCppContains(result, [
      "pinMode(this->_pin, OUTPUT);",
      "digitalWrite(this->_pin, value);",
    ]);
  });

  it("emits multiple emit() calls as separate statements", () => {
    const result = transpile(GPIO_HAL_WITH_EMIT + `
      const led: Pin = new Pin(LED_BUILTIN);
      led.asOutput(HIGH);
    `);

    // asOutput has two emit() calls — both should appear in the method body
    const cpp = result.cpp;
    expectCppContains(result, [
      "pinMode(this->_pin, OUTPUT);",
      "digitalWrite(this->_pin, value);",
    ]);
  });
});

describe("GPIO HAL with emit()", () => {
  it("emits Pin class with _pin field and methods", () => {
    const result = transpile(GPIO_HAL_WITH_EMIT + `
      const D13: Pin = new Pin(13);
    `);

    expectCppContains(result, [
      "class Pin",
      "this->_pin",
      "pinMode(this->_pin, OUTPUT);",
      "digitalWrite(this->_pin, ",
    ]);
  });

  it("toggle emits inline digitalRead/digitalWrite via emit()", () => {
    const result = transpile(GPIO_HAL_WITH_EMIT + `
      const led: Pin = new Pin(13);
      led.toggle();
    `);

    expectCppContains(result, [
      "digitalRead(this->_pin)",
      "digitalWrite(this->_pin,",
    ]);
  });

  it("read() uses declare function digitalRead as expression", () => {
    const result = transpile(GPIO_HAL_WITH_EMIT + `
      const led: Pin = new Pin(13);
      const val: number = led.read();
    `);

    expectCppContains(result, ["digitalRead(this->_pin)"]);
  });

  it("passes Arduino constants through unescaped", () => {
    const result = transpile(GPIO_HAL_WITH_EMIT + `
      const led: Pin = new Pin(LED_BUILTIN);
      led.asOutput(HIGH);
    `);

    expectCppContains(result, ["HIGH", "OUTPUT", "LED_BUILTIN"]);
    expectCppNotContains(result, ["_HIGH", "_LOW", "_OUTPUT"]);
  });

  it("emits blink sketch with setup/loop for Arduino target", () => {
    const result = transpileArduino(GPIO_HAL_WITH_EMIT + `
      const LED: Pin = new Pin(LED_BUILTIN);
      const led = LED.asOutput(HIGH);

      while (true) {
        led.toggle();
        delay(1000);
      }
    `);

    expectCppContains(result, [
      "void setup()",
      "void loop()",
      "pinMode(this->_pin, OUTPUT);",
      "toggle()",
      "delay(1000)",
    ]);
  });

  it("creates pin constants via constructor", () => {
    const result = transpile(GPIO_HAL_WITH_EMIT + `
      const D13: Pin = new Pin(13);
      const D7: Pin = new Pin(7);
      D13.asOutput(HIGH);
      D7.asInput();
    `);

    // Pin methods are inlined — no class, direct Arduino calls
    expectCppContains(result, [
      "pinMode(13, OUTPUT);",
      "digitalWrite(13, HIGH);",
      "pinMode(7, INPUT);",
    ]);
  });
});
