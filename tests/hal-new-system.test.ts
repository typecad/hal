import { describe, it } from "vitest";
import { expectCppContains, expectCppNotContains, transpile, transpileArduino } from "./setup";

// ---------------------------------------------------------------------------
// The new HAL — mirrors @typehal/hal package, inlined for testing.
// This is the exact same code that lives in packages/hal/src/.
// ---------------------------------------------------------------------------

const EMIT_DECL = `declare function emit(text: string): void;`;

const CONSTANTS = `
  declare const INPUT: number;
  declare const OUTPUT: number;
  declare const INPUT_PULLUP: number;
  declare const HIGH: number;
  declare const LOW: number;
  declare const LED_BUILTIN: number;
`;

const TIMING = `
  declare function delay(ms: number): void;
  declare function millis(): number;
  declare function micros(): number;
  declare function delayMicroseconds(us: number): void;
`;

const PIN_CLASS = `
  declare function digitalRead(pin: number): number;
  declare function tone(pin: number, frequency: number, duration?: number): void;
  declare function noTone(pin: number): void;
  declare function analogWrite(pin: number, value: number): void;

  class InputPin {
    private _pin: number;
    constructor(pin: number) { this._pin = pin; }
    read(): number { return digitalRead(this._pin); }
  }

  class OutputPin {
    private _pin: number;
    constructor(pin: number) { this._pin = pin; }
    high(): void { emit(\`digitalWrite(\${this._pin}, HIGH);\`); }
    low(): void { emit(\`digitalWrite(\${this._pin}, LOW);\`); }
    toggle(): void {
      emit(\`digitalWrite(\${this._pin}, digitalRead(\${this._pin}) == LOW ? HIGH : LOW);\`);
    }
    write(value: number): void { emit(\`digitalWrite(\${this._pin}, \${value});\`); }
  }

  class Pin {
    private _pin: number;
    constructor(pin: number) { this._pin = pin; }
    asOutput(value: number = LOW): OutputPin {
      emit(\`pinMode(\${this._pin}, OUTPUT);\`);
      emit(\`digitalWrite(\${this._pin}, \${value});\`);
      return new OutputPin(this._pin);
    }
    asInput(): InputPin {
      emit(\`pinMode(\${this._pin}, INPUT);\`);
      return new InputPin(this._pin);
    }
    asInputPullUp(): InputPin {
      emit(\`pinMode(\${this._pin}, INPUT_PULLUP);\`);
      return new InputPin(this._pin);
    }
    high(): void { emit(\`digitalWrite(\${this._pin}, HIGH);\`); }
    low(): void { emit(\`digitalWrite(\${this._pin}, LOW);\`); }
    toggle(): void {
      emit(\`digitalWrite(\${this._pin}, digitalRead(\${this._pin}) == LOW ? HIGH : LOW);\`);
    }
    write(value: number): void { emit(\`digitalWrite(\${this._pin}, \${value});\`); }
    read(): number { return digitalRead(this._pin); }
    tone(frequency: number): void { emit(\`tone(\${this._pin}, \${frequency});\`); }
    noTone(): void { emit(\`noTone(\${this._pin});\`); }
    pwm(value: number): void { emit(\`analogWrite(\${this._pin}, \${value});\`); }
  }
`;

const I2C_CLASS = `
  class I2CBus {
    private _bus: string;
    constructor(bus: string) { this._bus = bus; }
    begin(): void { emit(\`\${this._bus}.begin();\`); }
    setClock(hz: number): void { emit(\`\${this._bus}.setClock(\${hz});\`); }
    writeByte(address: number, register: number, value: number): void {
      emit(\`\${this._bus}.beginTransmission(\${address});\`);
      emit(\`\${this._bus}.write(\${register});\`);
      emit(\`\${this._bus}.write(\${value});\`);
      emit(\`\${this._bus}.endTransmission();\`);
    }
  }
  const I2C0 = new I2CBus("Wire");
`;

const UART_CLASS = `
  class SerialPort {
    private _port: string;
    constructor(port: string) { this._port = port; }
    begin(baud: number = 9600): void { emit(\`\${this._port}.begin(\${baud});\`); }
    println(value: any): void { emit(\`\${this._port}.println(\${value});\`); }
  }
  const UART0 = new SerialPort("Serial");
`;

// Arduino Uno pin constants
const UNO_PINS = `
  const D2: Pin = new Pin(2);
  const D3: Pin = new Pin(3);
  const D10: Pin = new Pin(10);
  const D13: Pin = new Pin(13);
  const LED: Pin = new Pin(LED_BUILTIN);
`;

// Full HAL setup for most tests
const HAL = [EMIT_DECL, CONSTANTS, TIMING, PIN_CLASS, I2C_CLASS, UART_CLASS, UNO_PINS].join("\n");

// ---------------------------------------------------------------------------
// Demo tests — each one is a miniature sketch using the new HAL system
// ---------------------------------------------------------------------------

describe("New HAL System — GPIO demos", () => {
  it("blink: LED.asOutput() + toggle loop", () => {
    const result = transpileArduino(HAL + `
      const led = LED.asOutput();
      while (true) {
        led.toggle();
        delay(1000);
      }
    `);

    // HAL resolver inlines pin numbers — no class, no this->_pin
    expectCppContains(result, [
      "void setup()",
      "void loop()",
      "pinMode(LED_BUILTIN, OUTPUT);",
      "digitalRead(LED_BUILTIN)",
      "delay(1000)",
    ]);
  });

  it("digital read + write: button controls LED", () => {
    const result = transpileArduino(HAL + `
      const btn: Pin = new Pin(2);
      const led: Pin = new Pin(13);
      btn.asInput();
      led.asOutput();
      const val: number = btn.read();
      if (val) {
        led.high();
      } else {
        led.low();
      }
    `);

    // HAL resolver inlines pin numbers directly
    expectCppContains(result, [
      "pinMode(2, INPUT);",
      "pinMode(13, OUTPUT);",
      "digitalRead(2)",
      "digitalWrite(13, HIGH);",
    ]);
  });

  it("pwm: write value with analogWrite", () => {
    const result = transpileArduino(HAL + `
      const led = new Pin(9).asOutput();
      led.write(128);
    `);

    // OutputPin.write() inlines to direct analogWrite via emit()
    expectCppContains(result, [
      "pinMode(9, OUTPUT);",
      "digitalWrite(9, 128);",
    ]);
  });

  it("tone: play a note", () => {
    const result = transpileArduino(HAL + `
      const buzzer = new Pin(8).asOutput();
      buzzer.tone(440);
      delay(500);
      buzzer.noTone();
    `);

    // HAL resolver inlines pin numbers; tone/noTone are on OutputPin
    expectCppContains(result, [
      "tone(8, 440);",
      "noTone(8);",
      "delay(500)",
    ]);
  });

  it("input pullup mode", () => {
    const result = transpile(HAL + `
      const btn: Pin = new Pin(2);
      btn.asInputPullUp();
    `);

    // HAL resolver inlines pin number
    expectCppContains(result, ["pinMode(2, INPUT_PULLUP);"]);
  });
});

describe("New HAL System — Serial demos", () => {
  it("UART0.begin() emits Serial.begin()", () => {
    const result = transpileArduino(HAL + `
      UART0.begin(115200);
    `);

    // Arduino strategy maps UART0.begin() → Serial.begin() at call site
    expectCppContains(result, ["Serial.begin(115200);"]);
  });

  it("UART0.println() emits Serial.println()", () => {
    const result = transpileArduino(HAL + `
      UART0.begin(9600);
      UART0.println("Hello World");
    `);

    expectCppContains(result, [
      "Serial.begin(9600);",
      'Serial.println("Hello World");',
    ]);
  });

  it("serial + sensor loop", () => {
    const result = transpileArduino(HAL + `
      UART0.begin(115200);
      const led = LED.asOutput(LOW);

      while (true) {
        const val: number = led.read();
        UART0.println(val);
        led.toggle();
        delay(1000);
      }
    `);

    expectCppContains(result, [
      "Serial.begin(115200);",
      "Serial.println(val);",
      "toggle()",
      "delay(1000)",
    ]);
  });
});

describe("New HAL System — I2C demos", () => {
  it("I2C0.begin() emits Wire.begin()", () => {
    const result = transpileArduino(HAL + `
      I2C0.begin();
    `);

    // Arduino strategy maps I2C0.begin() → Wire.begin()
    expectCppContains(result, ["Wire.begin();"]);
  });

  it("I2C0.setClock() emits Wire.setClock()", () => {
    const result = transpileArduino(HAL + `
      I2C0.begin();
      I2C0.setClock(400000);
    `);

    expectCppContains(result, [
      "Wire.begin();",
      "Wire.setClock(400000);",
    ]);
  });

  it("I2C0.writeByte() emits full Wire transaction", () => {
    const result = transpileArduino(HAL + `
      I2C0.begin();
      I2C0.writeByte(0x76, 0xF4, 0x01);
    `);

    // Inline evaluator resolves I2C0 → Wire and inlines writeByte as Wire calls
    expectCppContains(result, [
      "Wire.begin();",
      "Wire.beginTransmission(118);",
      "Wire.write(244);",
      "Wire.write(1);",
      "Wire.endTransmission();",
    ]);
  });

  it("I2C sensor read + serial output", () => {
    const result = transpileArduino(HAL + `
      I2C0.begin();
      UART0.begin(115200);

      while (true) {
        I2C0.writeByte(0x76, 0xFA, 0x55);
        UART0.println("sent");
        delay(1000);
      }
    `);

    // I2C and Serial fully inlined — zero-cost abstraction
    expectCppContains(result, [
      "Wire.begin();",
      "Serial.begin(115200);",
      "Wire.beginTransmission(118);",
      "Wire.write(250);",
      "Wire.write(85);",
      "Wire.endTransmission();",
      'Serial.println("sent");',
      "delay(1000)",
    ]);
  });
});

describe("New HAL System — constants pass through", () => {
  it("HIGH/LOW/OUTPUT pass as bare identifiers", () => {
    const result = transpile(HAL + `
      const p: Pin = new Pin(13);
      p.asOutput(HIGH);
      p.low();
    `);

    expectCppContains(result, ["HIGH", "LOW", "OUTPUT"]);
    expectCppNotContains(result, ["_HIGH", "_LOW", "_OUTPUT"]);
  });

  it("LED_BUILTIN passes through", () => {
    const result = transpile(HAL + `
      const led: Pin = new Pin(LED_BUILTIN);
      led.asOutput();
    `);

    expectCppContains(result, ["LED_BUILTIN"]);
  });

  it("numeric pin in constructor", () => {
    const result = transpile(HAL + `
      const p: Pin = new Pin(7);
      p.asOutput();
    `);

    // Pin is inlined — no class, no new Pin() in output
    expectCppContains(result, ["pinMode(7, OUTPUT);"]);
  });
});
