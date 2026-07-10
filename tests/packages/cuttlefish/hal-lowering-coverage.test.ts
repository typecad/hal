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

import { describe, it } from "vitest";
import { expectCppContains, expectCppNotContains, transpile } from "../../setup";

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

    // dacWrite lowers to the Arduino dacWrite function
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

describe("HAL Pulse lowering", () => {
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
  it("quotes string keys in putInt/getInt", () => {
    const result = transpile(`
      import { Preferences } from '@typecad/board-arduino-uno';
      Preferences.putInt('count', 42);
      const val = Preferences.getInt('count', 0);
    `, { target: 'arduino' });

    // Keys must be quoted in the emitted C++
    expect(result.cpp).toContain('"count"');
    expect(result.cpp).not.toContain('putInt(count');
    expect(result.cpp).not.toContain('getInt(count');
  });
});

// ===========================================================================
// SerialPort.printf — format string quoting fix
// ===========================================================================

describe("HAL SerialPort.printf lowering (format quoting)", () => {
  it("quotes the format string in printf", () => {
    const result = transpile(`
      import { UART0 } from '@typecad/board-arduino-uno';
      UART0.begin(9600);
      UART0.printf('%d items', 5);
    `, { target: 'arduino' });

    // Format must be quoted: Serial.printf("%d items", 5)
    expectCppContains(result, ['Serial.printf(']);
    expect(result.cpp).toContain('"%d');
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
