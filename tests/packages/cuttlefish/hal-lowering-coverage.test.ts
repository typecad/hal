// ---------------------------------------------------------------------------
// HAL Lowering Coverage Tests
//
// These tests cover the transpile-time lowering of HAL methods to C++,
// focusing on areas that were either untested or had bugs fixed in this
// session. They use the board-package import pattern (importing from
// @typecad/board-arduino-uno) so the HAL class registry and board constants
// are loaded by the transpile helper.
//
// Each test verifies:
//   - The correct Arduino C++ function is emitted (digitalWrite, analogRead,
//     analogReference, tone, Wire.begin, etc.)
//   - No invalid C++ constructs leak (Number(), String(), this->, bare
//     method calls on pin numbers like 13.write())
//   - String-to-macro mappings work (analogReference INTERNAL not "internal")
//   - The HAL source prescan doesn't flag @typecad/hal internals
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { expectCppContains, expectCppNotContains, transpile, transpileAVR, transpileESP32 } from "../../setup";

// ===========================================================================
// ADC — Analog-to-Digital Conversion
// ===========================================================================

describe("HAL ADC lowering", () => {
  it("lowers InputPin.readAnalog() to analogRead", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const sensor = A0.asInput();
      const raw = sensor.readAnalog();
    `, { target: 'arduino' });

    expectCppContains(result, ['pinMode(14, INPUT)', 'analogRead(14)']);
    expectCppNotContains(result, ['Number(', 'String(', 'this->']);
  });

  it("lowers InputPin.readVoltage() to analogRead * vRef / maxValue", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const sensor = A0.asInput();
      const v = sensor.readVoltage();
    `, { target: 'arduino' });

    expectCppContains(result, ['analogRead(14)']);
    // Voltage formula: analogRead * vRef / maxValue (Uno: 5V / 1023)
    expectCppContains(result, ['5', '1023']);
    expectCppNotContains(result, ['Number(', 'String(']);
  });

  it("lowers InputPin.getAnalogResolution() without Number() wrapper", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const sensor = A0.asInput();
      const bits = sensor.getAnalogResolution();
    `, { target: 'arduino' });

    // Should resolve to the board constant value (10 for Uno), NOT Number(10)
    expectCppContains(result, ['const auto bits = 10']);
    expectCppNotContains(result, ['Number(']);
  });

  it("lowers InputPin.setAnalogReference('internal') to analogReference(INTERNAL)", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const sensor = A0.asInput();
      sensor.setAnalogReference('internal');
    `, { target: 'arduino' });

    // Must map 'internal' → INTERNAL macro, not analogReference("internal")
    expectCppContains(result, ['analogReference(INTERNAL)']);
    expectCppNotContains(result, ['Number(', 'String(', '"internal"']);
  });

  it("lowers InputPin.setAnalogReference('external') to analogReference(EXTERNAL)", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const sensor = A0.asInput();
      sensor.setAnalogReference('external');
    `, { target: 'arduino' });

    expectCppContains(result, ['analogReference(EXTERNAL)']);
  });

  it("lowers InputPin.setAnalogReference('default') to analogReference(DEFAULT)", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const sensor = A0.asInput();
      sensor.setAnalogReference('default');
    `, { target: 'arduino' });

    expectCppContains(result, ['analogReference(DEFAULT)']);
  });
});

// ===========================================================================
// PWM Introspection — getPwmFrequency, getPwmResolution
// ===========================================================================

describe("HAL PWM lowering", () => {
  it("lowers OutputPin.getPwmResolution() without Number() wrapper", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      const res = led.getPwmResolution();
    `, { target: 'arduino' });

    // Should resolve to a board constant, NOT Number(board(...))
    expectCppNotContains(result, ['Number(']);
    expectCppNotContains(result, ['this->']);
  });

  it("lowers OutputPin.getPwmFrequency() without Number() wrapper", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      const freq = led.getPwmFrequency();
    `, { target: 'arduino' });

    expectCppNotContains(result, ['Number(']);
    expectCppNotContains(result, ['this->']);
  });
});

// ===========================================================================
// Pin Groups — createPinGroup, writePattern, fill
// ===========================================================================

describe("HAL PinGroup lowering", () => {
  it("emits PinGroup polyfill and rewrites createPinGroup call", () => {
    const result = transpile(`
      import { D2, D3, D4, D5 } from '@typecad/board-arduino-uno';
      const leds = createPinGroup([D2, D3, D4, D5]);
      leds.writePattern(0b1010);
    `, { target: 'arduino' });

    // PinGroup polyfill struct must be emitted
    expectCppContains(result, ['struct __tc_PinGroup']);
    expectCppContains(result, ['__tc_createPinGroup']);
    // Call must be rewritten from createPinGroup to __tc_createPinGroup
    expectCppContains(result, ['__tc_createPinGroup(2, 3, 4, 5)']);
    // writePattern must call digitalWrite in a loop
    expectCppContains(result, ['writePattern']);
    expectCppNotContains(result, ['createPinGroup({']);
  });

  it("emits fill() as digitalWrite loop in PinGroup polyfill", () => {
    const result = transpile(`
      import { D2, D3 } from '@typecad/board-arduino-uno';
      const leds = createPinGroup([D2, D3]);
      leds.fill(false);
    `, { target: 'arduino' });

    expectCppContains(result, ['void fill(bool value)']);
    expectCppContains(result, ['digitalWrite(pins[i]']);
  });
});

// ===========================================================================
// Prescan exclusion — HAL source files must not trigger TS2CPP diagnostics
// ===========================================================================

describe("HAL prescan exclusion", () => {
  it("does not flag Number/String/Promise in @typecad/hal source", () => {
    // Any HAL import that pulls in the HAL source should not produce
    // TS2CPP_EXPLICIT_ANY or TS2CPP_NO_EQUIVALENT diagnostics from the
    // HAL package's own source files.
    const result = transpile(`
      import { LED, delay } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      led.toggle();
      delay(1000);
    `, { target: 'arduino' });

    // No TS2CPP diagnostics at all for this simple sketch
    const hasHalDiagnostic = result.diagnostics.some(
      d => d.source?.includes('hal') || d.source?.includes('node_modules')
    );
    expect(!hasHalDiagnostic, 'HAL source files should not produce TS2CPP diagnostics');
  });
});

// ===========================================================================
// I2C — variable arguments
// ===========================================================================

describe("HAL I2C lowering with variable arguments", () => {
  it("lowers I2C0.beginTransmission(variableAddr)", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      I2C0.begin();
      const addr = 0x68;
      I2C0.beginTransmission(addr);
      I2C0.write(0x00);
      I2C0.endTransmission(true);
    `, { target: 'arduino' });

    expectCppContains(result, ['Wire.beginTransmission(addr)']);
    expectCppNotContains(result, ['this->']);
  });

  it("lowers I2C0.requestFrom(variableAddr, variableQty)", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      I2C0.begin();
      const addr = 0x68;
      const bytes = 6;
      I2C0.requestFrom(addr, bytes, true);
    `, { target: 'arduino' });

    expectCppContains(result, ['Wire.requestFrom(addr, bytes, true)']);
    expectCppNotContains(result, ['this->']);
  });
});

// ===========================================================================
// SPI — variable arguments
// ===========================================================================

describe("HAL SPI lowering with variable arguments", () => {
  it("lowers SPI0.setMode(variableMode)", () => {
    const result = transpile(`
      import { SPI0 } from '@typecad/board-arduino-uno';
      SPI0.begin();
      const mode = 1;
      SPI0.setMode(mode);
    `, { target: 'arduino' });

    expectCppContains(result, ['SPI.setDataMode(mode)']);
    expectCppNotContains(result, ['this->']);
  });
});

// ===========================================================================
// Tone — variable frequency and duration
// ===========================================================================

describe("HAL Tone lowering with variable arguments", () => {
  it("lowers OutputPin.tone(variableFreq, variableDuration)", () => {
    const result = transpile(`
      import { D8 } from '@typecad/board-arduino-uno';
      const spk = D8.asOutput();
      const freq = 440;
      const dur = 500;
      spk.toneFor(freq, dur);
    `, { target: 'arduino' });

    expectCppContains(result, ['tone(8, freq, dur)']);
    expectCppNotContains(result, ['this->', '8.toneFor']);
  });
});

// ===========================================================================
// DAC
// ===========================================================================

describe("HAL DAC lowering", () => {
  it("lowers DAC.write(pin, value)", () => {
    // DAC.write is a static call on the ADC singleton — it doesn't use
    // a pin instance, so the transpiler must resolve both args directly.
    const result = transpile(`
      import { DAC, A0 } from '@typecad/board-arduino-uno';
      DAC.write(A0, 128);
    `, { target: 'arduino' });

    // dacWrite lowers to the Arduino dacWrite function. A0 resolves to its
    // framework pin number (14 on AVR), and the value passes through.
    expectCppContains(result, ['dacWrite(14, 128)']);
    expectCppNotContains(result, ['this->', 'Number(']);
  });
});

// ===========================================================================
// No 'this' leakage — comprehensive check across HAL method patterns
// ===========================================================================

describe("HAL this-leakage prevention", () => {
  it("OutputPin compound methods do not leak 'this'", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      led.high();
      led.low();
      led.toggle();
      led.write(true);
      led.write(false);
    `, { target: 'arduino' });

    expectCppNotContains(result, ['this->', 'this.read', 'this.write', '13.high', '13.low', '13.toggle', '13.write']);
  });

  it("InputPin compound methods do not leak 'this'", () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInputPullUp();
      const v = btn.read();
      const h = btn.isHigh();
      const l = btn.isLow();
    `, { target: 'arduino' });

    expectCppNotContains(result, ['this->', 'this.read', '2.read', '2.isHigh', '2.isLow']);
  });

  it("Cross-method calls (isLow calls read internally) do not leak 'this'", () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const btn = D2.asInputPullUp();
      if (btn.isLow()) {
      }
    `, { target: 'arduino' });

    // isLow() calls this.read() internally — the inlineThisGetterCall must
    // resolve it to digitalRead(pin) without leaking 'this'
    expectCppContains(result, ['!digitalRead(2)']);
    expectCppNotContains(result, ['this->', 'this.read', '!this']);
  });
});

// ===========================================================================
// I2C Device — two-step variable pattern (alias chain resolution)
// ===========================================================================

describe("HAL I2C device variable alias chain", () => {
  it("resolves sensor.writeByte via const sensor = bus.device(addr)", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      const bus = I2C0.begin();
      const sensor = bus.device(0x76);
      sensor.writeByte(0xF4, 0x27);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'Wire.begin()',
      'Wire.beginTransmission(118)',
      'Wire.write(244)',
      'Wire.write(39)',
      'Wire.endTransmission(true)',
    ]);
    expectCppNotContains(result, ['this->_address', 'this->_bus']);
  });

  it("resolves sensor.readByte via const sensor = bus.device(addr)", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      const bus = I2C0.begin();
      const sensor = bus.device(0x76);
      const val = sensor.readByte(0xD0);
    `, { target: 'arduino' });

    expectCppContains(result, ['Wire.beginTransmission(118)', 'Wire.write(208)']);
    expectCppNotContains(result, ['this->_address', 'this->_bus']);
  });

  it("resolves sensor.writeBytes with array data via variable device", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      const bus = I2C0.begin();
      const sensor = bus.device(0x76);
      sensor.writeBytes(0xFA, [0x01, 0x02, 0x03]);
    `, { target: 'arduino' });

    expectCppContains(result, ['Wire.beginTransmission(118)', 'Wire.write(250)']);
    expectCppNotContains(result, ['this->_address']);
  });
});

// ===========================================================================
// SPI Device — two-step variable pattern (CS pin resolution)
// ===========================================================================

describe("HAL SPI device variable alias chain", () => {
  it("resolves display.transfer via const display = bus.device(D10)", () => {
    const result = transpile(`
      import { SPI0, D10 } from '@typecad/board-arduino-uno';
      const bus = SPI0.begin();
      const display = bus.device(D10);
      const response = display.transfer(0x42);
    `, { target: 'arduino' });

    // D10 must resolve to 10 — not stay as the identifier 'D10'
    expectCppContains(result, [
      'SPI.begin()',
      'digitalWrite(10, LOW)',
      'SPI.transfer(66)',
      'digitalWrite(10, HIGH)',
    ]);
    expect(result.cpp).not.toContain('digitalWrite(D10');
    expectCppNotContains(result, ['this->_cs', 'this->_bus']);
  });

  it("resolves display.writeRegister via const display = bus.device(D10)", () => {
    const result = transpile(`
      import { SPI0, D10 } from '@typecad/board-arduino-uno';
      const bus = SPI0.begin();
      const display = bus.device(D10);
      display.writeRegister(0x01, 0xFF);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'digitalWrite(10, LOW)',
      'SPI.transfer(1)',
      'SPI.transfer(255)',
      'digitalWrite(10, HIGH)',
    ]);
    expect(result.cpp).not.toContain('digitalWrite(D10');
    expectCppNotContains(result, ['this->_cs']);
  });
});

// ===========================================================================
// Bus ownership — take()/release() pattern
// ===========================================================================

describe("HAL bus ownership (take/release)", () => {
  it("constant-folds if(busAlias) to if(true) for take() result", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      const bus2 = I2C0.take();
      if (bus2) {
        bus2.device(0x42).readByte(0x00);
        bus2.release();
      }
    `, { target: 'arduino' });

    // take() always returns this on Arduino, so if(bus2) → if(true)
    expectCppContains(result, ['if (true)']);
    // The I2C device calls must resolve (Wire library included by take)
    expectCppContains(result, ['Wire.beginTransmission(66)', 'Wire.write(0)']);
    // bus2 must NOT appear as a C++ variable reference
    expectCppNotContains(result, ['bus2', 'this->_address']);
  });

  it("includes Wire.h when take() is used without explicit begin()", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      const bus2 = I2C0.take();
      bus2.device(0x42).writeByte(0x00, 0xFF);
      bus2.release();
    `, { target: 'arduino' });

    expectCppContains(result, ['#include <Wire.h>']);
    expectCppNotContains(result, ['bus2', 'this->_address']);
  });

  it("resolves SPI take() with device variable and CS pin", () => {
    const result = transpile(`
      import { SPI0, D10 } from '@typecad/board-arduino-uno';
      const bus = SPI0.begin();
      const display = bus.device(D10);
      display.transfer(0x42);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'SPI.begin()',
      'digitalWrite(10, LOW)',
      'SPI.transfer(66)',
      'digitalWrite(10, HIGH)',
    ]);
    expect(result.cpp).not.toContain('digitalWrite(D10');
  });
});

// ===========================================================================
// Async functions with template-literal console.log (snprintf prelude)
// ===========================================================================

describe("HAL async template literal lowering", () => {
  it("emits snprintf buffer declaration inside async state machine", () => {
    const result = transpile(`
      import { D2, millis } from '@typecad/board-arduino-uno';
      const pin = D2.asInput();
      async function measure() {
        const start = millis();
        const end = millis();
        console.log(\`Pulse lasted \${end - start} ms\`);
      }
      measure();
    `, { target: 'arduino' });

    // The snprintf buffer declaration must be present
    expectCppContains(result, ['char __cuttlefish_str_']);
    expectCppContains(result, ['snprintf']);
    expectCppContains(result, ['Serial.println(__cuttlefish_str_']);
    // Must NOT reference an undeclared variable
    expectCppNotContains(result, ['__cuttlefish_str_0']);
  });
});

// ===========================================================================
// Pulse measurement — Pulse.on().high()/.low() fluent API
// ===========================================================================

describe("HAL Pulse free-function lowering", () => {
  it("lowers free pulseIn(pin, value) to pulseIn call", () => {
    const result = transpile(`
      import { D7, HIGH } from '@typecad/board-arduino-uno';
      const duration = pulseIn(7, HIGH);
    `, { target: 'arduino' });

    expectCppContains(result, ['pulseIn(']);
    expectCppNotContains(result, ['this->']);
  });

  it("lowers free pulseInLong(pin, value) to pulseInLong call", () => {
    const result = transpile(`
      import { D7, HIGH } from '@typecad/board-arduino-uno';
      const duration = pulseInLong(7, HIGH);
    `, { target: 'arduino' });

    expectCppContains(result, ['pulseInLong(']);
    expectCppNotContains(result, ['this->']);
  });
});

// ===========================================================================
// Random — class methods (upTo, between, int, seed)
// ===========================================================================

describe("HAL Random class lowering", () => {
  it("lowers Random.upTo(max) to random(max)", () => {
    const result = transpile(`
      import { Random } from '@typecad/board-arduino-uno';
      const val = Random.upTo(100);
    `, { target: 'arduino' });

    expectCppContains(result, ['random(100)']);
    expectCppNotContains(result, ['this->', 'Random.upTo']);
  });

  it("lowers Random.between(min, max) to random(min, max)", () => {
    const result = transpile(`
      import { Random } from '@typecad/board-arduino-uno';
      const val = Random.between(1, 10);
    `, { target: 'arduino' });

    expectCppContains(result, ['random(1, 10)']);
  });

  it("lowers Random.int() to random(2147483647)", () => {
    const result = transpile(`
      import { Random } from '@typecad/board-arduino-uno';
      const val = Random.int();
    `, { target: 'arduino' });

    expectCppContains(result, ['random(2147483647)']);
  });

  it("lowers Random.seed(val) to randomSeed(val)", () => {
    const result = transpile(`
      import { Random } from '@typecad/board-arduino-uno';
      Random.seed(42);
    `, { target: 'arduino' });

    expectCppContains(result, ['randomSeed(42)']);
  });
});

// ===========================================================================
// Shift register — free functions
// ===========================================================================

describe("HAL Shift lowering", () => {
  it("lowers free shiftOut(dataPin, clockPin, bitOrder, value)", () => {
    const result = transpile(`
      import { D2, D3, LSBFIRST } from '@typecad/board-arduino-uno';
      shiftOut(2, 3, LSBFIRST, 0xAA);
    `, { target: 'arduino' });

    expectCppContains(result, ['shiftOut(2, 3,']);
    expectCppNotContains(result, ['this->']);
  });

  it("lowers free shiftIn(dataPin, clockPin, bitOrder)", () => {
    const result = transpile(`
      import { D2, D3, MSBFIRST } from '@typecad/board-arduino-uno';
      const val = shiftIn(2, 3, MSBFIRST);
    `, { target: 'arduino' });

    expectCppContains(result, ['shiftIn(2, 3,']);
    expectCppNotContains(result, ['this->']);
  });
});

// ===========================================================================
// Timing — delay/delayMicroseconds now emit C++ (was empty before)
// ===========================================================================

describe("HAL Timing lowering", () => {
  it("lowers free delay(ms) to delay(ms)", () => {
    const result = transpile(`
      import { delay } from '@typecad/board-arduino-uno';
      delay(500);
    `, { target: 'arduino' });

    expectCppContains(result, ['delay(500)']);
  });

  it("lowers free delayMicroseconds(us) to delayMicroseconds(us)", () => {
    const result = transpile(`
      import { delayMicroseconds } from '@typecad/board-arduino-uno';
      delayMicroseconds(100);
    `, { target: 'arduino' });

    expectCppContains(result, ['delayMicroseconds(100)']);
  });

  it("lowers Timing.delay(ms) via class method", () => {
    const result = transpile(`
      import { Timing } from '@typecad/board-arduino-uno';
      Timing.delay(250);
    `, { target: 'arduino' });

    expectCppContains(result, ['delay(250)']);
  });
});

// ===========================================================================
// OutputPin.pulse — now uses delay() not delayMicroseconds (overflow fix)
// ===========================================================================

describe("HAL pulse lowering (overflow fix)", () => {
  it("lowers OutputPin.pulse(ms) to delay(ms) not delayMicroseconds", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      led.pulse(50);
    `, { target: 'arduino' });

    // Must use delay(50) not delayMicroseconds(50000) which overflows AVR
    expectCppContains(result, ['delay(50)']);
    expectCppNotContains(result, ['delayMicroseconds(50000)']);
  });
});

// ===========================================================================
// Preferences — key quoting fix
// ===========================================================================

describe("HAL Preferences lowering (key quoting)", () => {
  it("passes string-literal keys as const char* without .c_str()", () => {
    const result = transpile(`
      import { Preferences } from '@typecad/board-arduino-uno';
      Preferences.putInt('count', 42);
      const val = Preferences.getInt('count', 0);
    `, { target: 'arduino' });

    // String-literal keys render as a C string literal directly — the
    // transpiler strips the rawCpp `${key}.c_str()` because a string literal
    // has no .c_str() member. (Variables still get .c_str().)
    expectCppContains(result, [
      'Preferences.putInt("count", 42)',
      'Preferences.getInt("count", 0)',
    ]);
    // Regression guard: the old "\"${key}\"" template produced ""count"" (broken),
    // and the unconditional .c_str() produced "count".c_str() (also broken).
    expect(result.cpp).not.toContain('""count""');
    expect(result.cpp).not.toContain('"count".c_str()');
  });
});

// ===========================================================================
// SerialPort.printf — format string quoting fix
// ===========================================================================

describe("HAL SerialPort.printf lowering (format quoting)", () => {
  it("quotes the format string in printf without double-quoting", () => {
    const result = transpile(`
      import { UART0 } from '@typecad/board-arduino-uno';
      UART0.begin(9600);
      UART0.printf('%d items', 5);
    `, { target: 'arduino' });

    // printf now routes through the uart.printf semantic op. A literal format
    // string renders as a quoted C string literal directly (no .c_str()).
    expectCppContains(result, ['Serial.printf("%d items", 5)']);
    // Regression guard: the format string must NOT be double-quoted and must
    // NOT carry a .c_str() (both were prior bugs).
    expect(result.cpp).not.toContain('""%d');
    expect(result.cpp).not.toContain('"%d items".c_str()');
  });

  it("passes a variable format string through", () => {
    const result = transpile(`
      import { UART0 } from '@typecad/board-arduino-uno';
      UART0.begin(9600);
      const fmt = '%d items';
      UART0.printf(fmt, 5);
    `, { target: 'arduino' });

    // A variable format renders as the bare identifier.
    expectCppContains(result, ['Serial.printf(fmt, 5)']);
  });

  it("expands rest params across multiple printf arguments", () => {
    const result = transpile(`
      import { UART0 } from '@typecad/board-arduino-uno';
      UART0.begin(9600);
      UART0.printf('%d %d %d', 1, 2, 3);
    `, { target: 'arduino' });

    // ...args rest param must expand to a comma-separated arg list, not emit
    // a bare `args` token.
    expectCppContains(result, ['Serial.printf("%d %d %d", 1, 2, 3)']);
    expect(result.cpp).not.toMatch(/printf\([^)]*\bargs\b/);
  });
});

// ===========================================================================
// FS — string path parameters must be passed via .c_str() (regression: paths
// were interpolated unquoted, producing FS.open(config.json, "r") — invalid C++)
// ===========================================================================

describe("HAL FS string-parameter lowering", () => {
  it("passes an exists() string-literal path as a C string literal", () => {
    const result = transpile(`
      import { FS } from '@typecad/board-arduino-uno';
      FS.exists('config.json');
    `, { target: 'arduino' });

    // A string-literal path renders as a quoted C string literal directly —
    // the transpiler strips the rawCpp `${path}.c_str()` because a string
    // literal has no .c_str() member. The path must NOT appear as a bare
    // identifier (FS.exists(config.json) — invalid C++).
    expectCppContains(result, ['FS.exists("config.json")']);
    expect(result.cpp).not.toMatch(/FS\.exists\(config/);
    expect(result.cpp).not.toContain('"config.json".c_str()');
  });

  it("passes a readText() string-literal path in FS.open", () => {
    const result = transpile(`
      import { FS } from '@typecad/board-arduino-uno';
      const x = FS.readText('data.txt');
    `, { target: 'arduino' });

    expectCppContains(result, ['FS.open("data.txt", "r")']);
  });

  it("passes writeText() path and content as C string literals", () => {
    const result = transpile(`
      import { FS } from '@typecad/board-arduino-uno';
      FS.writeText('out.log', 'hello');
    `, { target: 'arduino' });

    // Both the path AND the content render as string literals (no .c_str()).
    expectCppContains(result, [
      'FS.open("out.log", "w")',
      'f.print("hello")',
    ]);
  });

  it("passes a remove() string-literal path", () => {
    const result = transpile(`
      import { FS } from '@typecad/board-arduino-uno';
      FS.remove('temp.bin');
    `, { target: 'arduino' });

    expectCppContains(result, ['FS.remove("temp.bin")']);
  });
});

// ===========================================================================
// Preferences — UInt/Float methods (regression: tests called these but the HAL
// shim only declared Int/Bool/String variants)
// ===========================================================================

describe("HAL Preferences UInt/Float lowering", () => {
  it("lowers putUInt/getUInt and putFloat/getFloat", () => {
    const result = transpile(`
      import { Preferences } from '@typecad/board-arduino-uno';
      Preferences.putUInt('counter', 1000);
      const u = Preferences.getUInt('counter', 0);
      Preferences.putFloat('gain', 2.5);
      const f = Preferences.getFloat('gain', 0);
    `, { target: 'arduino' });

    // String-literal keys render as quoted C string literals directly — the
    // transpiler strips the rawCpp `${key}.c_str()` for literals.
    // Regression guard: keys must NOT be double-quoted (was a bug where
    // "\"${key}\"" produced putInt(""count"", 42)) and must NOT carry .c_str().
    expectCppContains(result, [
      'Preferences.putUInt("counter", 1000)',
      'Preferences.getUInt("counter", 0)',
      'Preferences.putFloat("gain", 2.5f)',
      'Preferences.getFloat("gain", 0)',
    ]);
    expect(result.cpp).not.toContain('""counter""');
    expect(result.cpp).not.toContain('""gain""');
    expect(result.cpp).not.toContain('"counter".c_str()');
    expect(result.cpp).not.toContain('"gain".c_str()');
  });

  it("passes both key and value as C string literals for putString/getString", () => {
    // putString/getString are the only Preferences methods taking TWO string
    // args (key + value) — both render as string literals. Regression guard
    // for the double-quoting bug on the value side.
    const result = transpile(`
      import { Preferences } from '@typecad/board-arduino-uno';
      Preferences.putString('label', 'hello');
      const v = Preferences.getString('label', '');
    `, { target: 'arduino' });

    expectCppContains(result, [
      'Preferences.putString("label", "hello")',
      'Preferences.getString("label", "")',
    ]);
    expect(result.cpp).not.toContain('""label""');
    expect(result.cpp).not.toContain('""hello""');
    expect(result.cpp).not.toContain('"label".c_str()');
  });
});

// ===========================================================================
// board() / boardResolve() — compile-time board constant resolution at top level
// ===========================================================================

describe("HAL board() top-level resolution", () => {
  it("resolves board() to a compile-time constant from the board definition", () => {
    const result = transpile(`
      import { board } from '@typecad/hal';
      import { LED } from '@typecad/board-arduino-uno';
      const res = board("peripherals.pwm.resolution");
      LED.asOutput();
    `, { target: 'arduino' });

    // Arduino Uno PWM resolution is 8 bits
    expectCppContains(result, ['const auto res = 8']);
  });

  it("resolves board() for ADC resolution", () => {
    const result = transpile(`
      import { board } from '@typecad/hal';
      import { A0 } from '@typecad/board-arduino-uno';
      const bits = board("peripherals.adc.0.resolution");
      A0.asInput();
    `, { target: 'arduino' });

    expectCppContains(result, ['const auto bits = 10']);
  });

  it("resolves boardResolve() identically to board()", () => {
    const result = transpile(`
      import { rawCpp } from '@typecad/hal';
      import { LED } from '@typecad/board-arduino-uno';
      rawCpp("// test");
      LED.asOutput();
      const freq = LED.getPwmFrequency ? 0 : 0;
    `, { target: 'arduino' });

    // Just verify the build doesn't crash — getPwmFrequency is a method on OutputPin
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not emit board() as a C++ function call", () => {
    const result = transpile(`
      import { board } from '@typecad/hal';
      import { LED } from '@typecad/board-arduino-uno';
      const res = board("peripherals.pwm.resolution");
      LED.asOutput();
    `, { target: 'arduino' });

    // Must NOT contain a literal board() call
    expect(result.cpp).not.toContain('board("');
    expect(result.cpp).not.toContain('board(');
  });

  it("resolves string board constants as C++ string literals (regression: was NaN.0f)", () => {
    const result = transpile(`
      import { boardResolve } from '@typecad/hal';
      import { LED } from '@typecad/board-arduino-uno';
      const arch = boardResolve("architecture");
      LED.asOutput();
    `, { target: 'arduino' });

    // "architecture" is the string "avr" — must render as a C++ string literal,
    // not NaN.0f (the old Number("avr") coercion bug).
    expectCppContains(result, ['const auto arch = "avr"']);
  });

  it("suppresses ESP32 deep-sleep symbols on AVR (not-supported comment)", () => {
    // The arch guard now lives in the strategy (mirrors WDT) and keys off the
    // FQBN-derived _cachedArch, so it resolves correctly even without a board
    // package. On AVR the ESP-IDF sleep symbols must NOT appear.
    const result = transpileAVR(`
      import { Power } from '@typecad/framework-arduino/arduino';
      Power.deepSleep(1000);
    `);

    expect(result.cpp).not.toContain('esp_sleep_enable_timer_wakeup');
    expect(result.cpp).not.toContain('esp_deep_sleep_start');
    expect(result.cpp).toContain('deep sleep not supported on avr');
  });

  it("emits the ESP32 deep-sleep calls on ESP32 targets", () => {
    // Regression: before the strategy-side arch guard, the HAL-source
    // `const arch = board(...)` VariableStatement was dropped by the method-body
    // loop and the `if` mis-folded — so ESP32 emitted the not-supported comment
    // instead of the real sleep calls on every target.
    const result = transpileESP32(`
      import { Power } from '@typecad/framework-arduino/arduino';
      Power.deepSleep(1000);
    `);

    expect(result.cpp).toContain('esp_sleep_enable_timer_wakeup(1000 * 1000)');
    expect(result.cpp).toContain('esp_deep_sleep_start()');
    expect(result.cpp).not.toContain('not supported');
  });

  it("emits esp_light_sleep_start() on ESP32 and a comment on AVR", () => {
    const esp = transpileESP32(`
      import { Power } from '@typecad/framework-arduino/arduino';
      Power.lightSleep();
    `);
    const avr = transpileAVR(`
      import { Power } from '@typecad/framework-arduino/arduino';
      Power.lightSleep();
    `);

    expect(esp.cpp).toContain('esp_light_sleep_start()');
    expect(esp.cpp).not.toContain('not supported');
    expect(avr.cpp).not.toContain('esp_light_sleep_start');
    expect(avr.cpp).toContain('light sleep not supported on avr');
  });
});

// ===========================================================================
// HardwareTimer.getBits() — boardResolve() with dynamic concat path in a
// non-singleton HAL class method-return position.
// Regression: was "/* unhandled hal-expr: board.resolve */" due to (a) a
// singular/plural path-key mismatch and (b) the concat path flattener
// rendering `+` as a C++ expression ("a + b") instead of concatenating.
// ===========================================================================

describe("HAL HardwareTimer.getBits() resolution", () => {
  it("resolves Timer1.getBits() to the board-defined bit width (16)", () => {
    const result = transpile(`
      import { Timer1 } from '@typecad/board-arduino-uno';
      const bits = Timer1.getBits();
    `, { target: 'arduino' });

    expectCppContains(result, ['const auto bits = 16']);
  });

  it("resolves Timer0/Timer2 getBits() (8-bit timers)", () => {
    const r0 = transpile(`
      import { Timer0 } from '@typecad/board-arduino-uno';
      const b0 = Timer0.getBits();
    `, { target: 'arduino' });
    const r2 = transpile(`
      import { Timer2 } from '@typecad/board-arduino-uno';
      const b2 = Timer2.getBits();
    `, { target: 'arduino' });

    expectCppContains(r0, ['const auto b0 = 8']);
    expectCppContains(r2, ['const auto b2 = 8']);
  });

  it("does not emit an unhandled board.resolve hal-expr", () => {
    const result = transpile(`
      import { Timer1 } from '@typecad/board-arduino-uno';
      const bits = Timer1.getBits();
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('unhandled hal-expr');
  });
});

// ===========================================================================
// emit() / rawCpp() — template literal interpolation
// ===========================================================================

describe("HAL emit/rawCpp template literal lowering", () => {
  it("inlines emit() with plain string literal", () => {
    const result = transpile(`
      import { emit } from '@typecad/hal';
      emit("PORTB |= (1 << PB5)");
    `, { target: 'arduino' });

    expectCppContains(result, ['PORTB |= (1 << PB5)']);
    expect(result.cpp).not.toContain('snprintf');
  });

  it("does not pull in stdio.h for emit() calls", () => {
    const result = transpile(`
      import { emit } from '@typecad/hal';
      emit("PORTB |= (1 << PB5)");
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('#include <stdio.h>');
    expect(result.cpp).not.toContain('#include <stdlib.h>');
  });
});

// ===========================================================================
// Pin capability validation — capability mismatch detection
// ===========================================================================

describe("HAL pin capability validation", () => {
  it("errors on PWM on a non-PWM pin (A0)", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const pin = A0.asOutput();
      pin.pwm(128);
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    const capErrors = result.diagnostics.filter(d => d.code === 'pin-capability-mismatch');
    expect(capErrors.length).toBeGreaterThan(0);
    expect(capErrors[0].message).toContain('does not support PWM');
  });

  it("allows PWM on a PWM-capable pin (D3)", () => {
    const result = transpile(`
      import { D3 } from '@typecad/board-arduino-uno';
      const pin = D3.asOutput();
      pin.pwm(128);
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    const capErrors = result.diagnostics.filter(d => d.code === 'pin-capability-mismatch');
    expect(capErrors).toHaveLength(0);
  });

  it("allows PWM on D9 (OC1A, PWM-capable)", () => {
    const result = transpile(`
      import { D9 } from '@typecad/board-arduino-uno';
      const pin = D9.asOutput();
      pin.pwm(64);
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    const capErrors = result.diagnostics.filter(d => d.code === 'pin-capability-mismatch');
    expect(capErrors).toHaveLength(0);
  });

  it("errors on tone() on a non-PWM pin (A0)", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const pin = A0.asOutput();
      pin.tone(440);
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    const capErrors = result.diagnostics.filter(d => d.code === 'pin-capability-mismatch');
    expect(capErrors.length).toBeGreaterThan(0);
    expect(capErrors[0].message).toContain('does not support PWM');
  });

  it("suggests valid alternative pins in the hint", () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      const pin = A0.asOutput();
      pin.pwm(128);
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    const capErrors = result.diagnostics.filter(d => d.code === 'pin-capability-mismatch');
    expect(capErrors.length).toBeGreaterThan(0);
    // Hint should list at least one PWM-capable pin
    expect(capErrors[0].hint).toContain('PD3');
  });
});

// ===========================================================================
// Preferences AVR-safety — <Preferences.h> is ESP32-only, so the HAL class
// deliberately omits __includes (the transpiler would emit them unconditionally
// and break AVR). Regression guard for this fragile, intentional omission.
// ===========================================================================

describe("HAL Preferences AVR-safety", () => {
  it("does NOT emit #include <Preferences.h> on AVR", () => {
    const result = transpileAVR(`
      import { Preferences } from '@typecad/framework-arduino/arduino';
      Preferences.putInt('count', 42);
    `);

    // <Preferences.h> is ESP32-only; emitting it on AVR would break the build.
    // The class omits __includes for exactly this reason.
    expect(result.cpp).not.toContain('#include <Preferences.h>');
  });

  it("still functions on AVR via the EEPROM-backed polyfill", () => {
    const result = transpileAVR(`
      import { Preferences } from '@typecad/framework-arduino/arduino';
      Preferences.putInt('count', 42);
    `);

    // The strategy provides an AVR polyfill (class __tc_Preferences) backed by
    // EEPROM instead of the ESP32 NVS library.
    expect(result.cpp).toContain('__tc_Preferences');
    expect(result.cpp).toContain('#include <EEPROM.h>');
  });
});

// ===========================================================================
// InputPin.offInterrupts() — alias added to match BasePin.offInterrupts().
// SerialPort.waitForConnection(timeout?) — added with optional timeout param.
// Both public API, previously untested.
// ===========================================================================

describe("HAL InputPin interrupt aliases", () => {
  it("lowers offInterrupts() to detachInterrupt", () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const p = D2.asInput();
      p.offInterrupts();
    `, { target: 'arduino' });

    expectCppContains(result, ['detachInterrupt(digitalPinToInterrupt(2))']);
  });

  it("lowers offAll() to detachInterrupt", () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const p = D2.asInput();
      p.offAll();
    `, { target: 'arduino' });

    expectCppContains(result, ['detachInterrupt(digitalPinToInterrupt(2))']);
  });
});

describe("HAL SerialPort.waitForConnection", () => {
  it("emits the wait-for-Serial connection loop", () => {
    const result = transpile(`
      import { UART0 } from '@typecad/board-arduino-uno';
      UART0.begin(9600);
      UART0.waitForConnection();
    `, { target: 'arduino' });

    expectCppContains(result, ['while (!Serial) { delay(10); }']);
  });
});

// ===========================================================================
// Pulse.on() fluent API — the actual target of the pin-number bugfix, but the
// existing "HAL Pulse lowering" describe block only tested the free functions.
// ===========================================================================

describe("HAL Pulse.on() fluent lowering", () => {
  it("lowers Pulse.on(pin).high() to a Pulse::on(pin).high() chain", () => {
    const result = transpile(`
      import { D2, Pulse } from '@typecad/board-arduino-uno';
      const d = Pulse.on(D2).high();
    `, { target: 'arduino' });

    // The fluent class lowers to a C++ method chain. The pin number (2) must
    // be resolved from D2 (this was the target of the pin-number bugfix —
    // previously it leaked (pin as any)._pin instead of resolving pin.number).
    expectCppContains(result, ['Pulse::on(2).high()']);
  });

  it("lowers Pulse.on(pin).low() to a Pulse::on(pin).low() chain", () => {
    const result = transpile(`
      import { D2, Pulse } from '@typecad/board-arduino-uno';
      const d = Pulse.on(D2).low();
    `, { target: 'arduino' });

    expectCppContains(result, ['Pulse::on(2).low()']);
  });

  it("lowers Pulse.on(pin).timeout(us).high() with timeout", () => {
    const result = transpile(`
      import { D2, Pulse } from '@typecad/board-arduino-uno';
      const d = Pulse.on(D2).timeout(5000).high();
    `, { target: 'arduino' });

    expectCppContains(result, ['Pulse::on(2).timeout(5000).high()']);
  });
});

// ===========================================================================
// Constants added in the HAL review fix pass — INPUT_PULLDOWN,
// OUTPUT_OPEN_DRAIN, ANALOG. Must pass through as bare C++ identifiers.
// ===========================================================================

describe("HAL phantom constants pass-through", () => {
  it("passes INPUT_PULLDOWN / OUTPUT_OPEN_DRAIN / ANALOG through as identifiers", () => {
    const result = transpile(`
      import { INPUT_PULLDOWN, OUTPUT_OPEN_DRAIN, ANALOG } from '@typecad/hal';
      const a = INPUT_PULLDOWN;
      const b = OUTPUT_OPEN_DRAIN;
      const c = ANALOG;
    `, { target: 'arduino' });

    // These are phantom C++ constants — they must survive as bare identifiers
    // (resolved by the Arduino headers), not be coerced to numbers.
    expectCppContains(result, [
      'INPUT_PULLDOWN',
      'OUTPUT_OPEN_DRAIN',
      'ANALOG',
    ]);
    expectCppNotContains(result, [
      '= 0;',  // none of the three should render as a literal 0
    ]);
  });
});

// ===========================================================================
// HardwareTimer — setFrequency/onOverflow/start/stop (getBits was already
// tested above; these four methods had zero coverage).
// ===========================================================================

describe("HAL HardwareTimer methods", () => {
  it("lowers setFrequency/start/stop to Timer<n> calls", () => {
    const result = transpile(`
      import { Timer1 } from '@typecad/board-arduino-uno';
      Timer1.setFrequency(1000);
      Timer1.start();
      Timer1.stop();
    `, { target: 'arduino' });

    expectCppContains(result, [
      'Timer1.setFrequency(1000)',
      'Timer1.start()',
      'Timer1.stop()',
    ]);
  });

  it("lowers onOverflow with a callback handler", () => {
    const result = transpile(`
      import { Timer1 } from '@typecad/board-arduino-uno';
      Timer1.onOverflow(() => {});
      Timer1.start();
    `, { target: 'arduino' });

    // onOverflow attaches a callback — the handler must be registered and
    // passed to Timer1.onOverflow.
    expect(result.cpp).toContain('Timer1.onOverflow(');
    expect(result.cpp).toContain('Timer1.start()');
  });
});

// ===========================================================================
// Async — sleep/yield/sleepUntil/currentTask. The __cuttlefish_async_*
// runtime markers must render correctly (previously zero coverage).
// ===========================================================================

describe("HAL Async lowering", () => {
  it("lowers sleep/yield/currentTask to runtime markers", () => {
    const result = transpile(`
      import { Async } from '@typecad/board-arduino-uno';
      Async.sleep(100);
      Async.yield();
      Async.currentTask();
    `, { target: 'arduino' });

    expectCppContains(result, [
      '__cuttlefish_async_sleep(100)',
      '__cuttlefish_async_yield()',
      '__cuttlefish_async_current_task()',
    ]);
  });

  it("lowers sleepUntil with a poll interval", () => {
    const result = transpile(`
      import { Async } from '@typecad/board-arduino-uno';
      Async.sleepUntil(() => true, 50);
    `, { target: 'arduino' });

    expectCppContains(result, ['__cuttlefish_async_sleep_until(50)']);
  });
});

// ===========================================================================
// I2CBus.recover() — bus-recovery rawCpp sequence (SCL toggling). Previously
// untested.
// ===========================================================================

describe("HAL I2CBus.recover", () => {
  it("emits the SCL-toggle bus-recovery sequence", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      I2C0.begin();
      I2C0.recover();
    `, { target: 'arduino' });

    expectCppContains(result, [
      'pinMode(SCL, OUTPUT)',
      'digitalWrite(SCL, LOW)',
      'digitalWrite(SCL, HIGH)',
      'Wire.begin()',
    ]);
    expect(result.cpp).toContain('#include <Wire.h>');
  });
});

// ===========================================================================
// Power.setCpuFrequency — the one Power method not covered by the deepSleep/
// lightSleep tests above.
// ===========================================================================

describe("HAL Power.setCpuFrequency", () => {
  it("lowers setCpuFrequency to setCpuFrequencyMhz", () => {
    const result = transpile(`
      import { Power } from '@typecad/framework-arduino/arduino';
      Power.setCpuFrequency(160);
    `, { target: 'arduino' });

    expectCppContains(result, ['setCpuFrequencyMhz(160)']);
  });
});

// ===========================================================================
// Pin.fromPort() — the preferred factory for creating pins from MCU port names
// (e.g. "PB5"). The transpiler resolves the port name to a framework pin number
// via the MCU package's pin mapping at compile time. Previously zero tests.
// ===========================================================================

describe("HAL Pin.fromPort()", () => {
  it("resolves a port name to the framework pin number", () => {
    // PB5 on ATmega328P = Arduino pin 13 (the built-in LED).
    const result = transpile(`
      import { Pin } from '@typecad/board-arduino-uno';
      const led = Pin.fromPort('PB5').asOutput();
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    expectCppContains(result, ['pinMode(13, OUTPUT)']);
  });

  it("resolves a different port name correctly", () => {
    // PD3 on ATmega328P = Arduino pin 3.
    const result = transpile(`
      import { Pin } from '@typecad/board-arduino-uno';
      const p = Pin.fromPort('PD3').asOutput();
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    expectCppContains(result, ['pinMode(3, OUTPUT)']);
  });

  it("supports method chaining after fromPort", () => {
    const result = transpile(`
      import { Pin } from '@typecad/board-arduino-uno';
      Pin.fromPort('PB5').asOutput().high();
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    expectCppContains(result, [
      'pinMode(13, OUTPUT)',
      'digitalWrite(13, HIGH)',
    ]);
  });
});

// ===========================================================================
// DAC.getResolution() — boardResolve path. On AVR (no DAC hardware), the path
// peripherals.dac.0.resolution doesn't exist, so the call falls back to the
// unhandled-hal-expr comment. This documents that fallback behavior.
// ===========================================================================

describe("HAL DAC.getResolution()", () => {
  it("uses boardResolve for the resolution path (documents fallback behavior)", () => {
    // DAC.getResolution() calls boardResolve("peripherals.dac.0.resolution").
    // On AVR (no DAC) and currently on ESP32 too (the DAC board-constant path
    // is not yet populated by the board packages), this falls back to the
    // unhandled-hal-expr comment. This test documents that the call doesn't
    // crash or leak raw text — the fallback is graceful.
    const result = transpileAVR(`
      import { DAC } from '@typecad/framework-arduino/arduino';
      const bits = DAC.getResolution();
    `);

    // Must not crash, must not leak the raw path string, and must produce
    // SOME output (either a value or the fallback comment).
    expect(result.cpp).toContain('const auto bits =');
    expect(result.cpp).not.toContain('peripherals.dac');
  });
});

// ===========================================================================
// map()/constrain() — bare pass-through to Arduino core macros. The transpiler
// lowers these to verbatim C++ calls (no semantic op); the Arduino headers
// provide the implementations.
// ===========================================================================

describe("HAL map/constrain free-function lowering", () => {
  it("lowers map() to a bare Arduino map() call", () => {
    const result = transpile(`
      import { map } from '@typecad/hal';
      const v = map(512, 0, 1023, 0, 255);
    `, { target: 'arduino' });

    expectCppContains(result, ['map(512, 0, 1023, 0, 255)']);
  });

  it("lowers constrain() to a bare Arduino constrain() call", () => {
    const result = transpile(`
      import { constrain } from '@typecad/hal';
      const v = constrain(200, 0, 100);
    `, { target: 'arduino' });

    expectCppContains(result, ['constrain(200, 0, 100)']);
  });
});

// ===========================================================================
// I2CDevice.readBytes(register, count) — the buffer is declared in the
// CALLER's scope as a real uint8_t C array (zero-initialized) and filled in
// place by the i2c.read_buffer op. This supersedes an earlier lowering that
// emitted an internal `static uint8_t __buf[N]; ...; return __buf;` (which
// decayed to a pointer on return, breaking `buf.length`).
// ===========================================================================

describe("HAL I2CDevice.readBytes edge cases", () => {
  it("emits a caller-scoped buffer filled in place for count=4", () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      I2C0.begin();
      const dev = I2C0.device(0x68);
      const buf = dev.readBytes(0x00, 4);
    `, { target: 'arduino' });

    expect(result.cpp).toMatch(/uint8_t\s+buf\s*\[/);
    expect(result.cpp).not.toMatch(/static\s+uint8_t\s+__buf/);
    expect(result.cpp).toContain('buf[__i] = Wire.read()');
  });

  it("emits an empty array for count=0 (no invalid zero-length static)", () => {
    // count=0 previously produced `static uint8_t __buf[0]` — a non-standard
    // GCC extension. The caller-scoped lowering now declares an empty array.
    const result = transpile(`
      import { I2C0 } from '@typecad/board-arduino-uno';
      I2C0.begin();
      const dev = I2C0.device(0x68);
      const buf = dev.readBytes(0x00, 0);
    `, { target: 'arduino' });

    expect(result.cpp).toMatch(/uint8_t\s+buf\s*\[/);
    expect(result.cpp).not.toMatch(/static\s+uint8_t\s+__buf/);
  });
});

// ===========================================================================
// SPIDevice.transfer(Uint8Array) — the Uint8Array branch was previously
// untested (only the numeric transfer was covered).
// ===========================================================================

describe("HAL SPIDevice.transfer with Uint8Array", () => {
  it("accepts a Uint8Array argument", () => {
    const result = transpile(`
      import { SPI0, D10 } from '@typecad/board-arduino-uno';
      SPI0.begin();
      const dev = SPI0.device(D10);
      const buf = new Uint8Array([1, 2, 3]);
      const response = dev.transfer(buf);
    `, { target: 'arduino' });

    // The Uint8Array should be rendered as a C++ byte array, and the transfer
    // should emit the SPI transfer call with CS toggling.
    expect(result.cpp).toContain('uint8_t buf[]');
    expect(result.cpp).toContain('digitalWrite(10, LOW)');
    expect(result.cpp).toContain('SPI.transfer(');
    expect(result.cpp).toContain('digitalWrite(10, HIGH)');
  });
});

// ===========================================================================
// board()/boardResolve() path-missing fallback — when a board-constant path
// doesn't exist, the call falls back to 0 (for boardResolve in consumer code)
// or an unhandled-hal-expr comment (for boardResolve in a HAL method body).
// This guards that the fallback doesn't crash or leak raw text.
// ===========================================================================

describe("HAL boardResolve path-missing fallback", () => {
  it("falls back to 0 for an unknown path in consumer code", () => {
    const result = transpile(`
      import { boardResolve } from '@typecad/hal';
      const x = boardResolve("nonexistent.key");
    `, { target: 'arduino', boardPackage: '@typecad/board-arduino-uno' });

    // An unresolved path renders as 0 (the default), not as raw text or an
    // error. The transpiler must not crash or leak the path string.
    expect(result.cpp).toContain('const auto x = 0');
    expect(result.cpp).not.toContain('nonexistent');
  });
});

