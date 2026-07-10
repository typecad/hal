import { describe, it, expect } from "vitest";
import { transpileArduino } from "../../setup";

/**
 * Regression tests for HAL bugs found in the post-audit review (commit 80c73e3).
 * Each test pins a specific correct-C++ behavior that was broken.
 */

describe("HAL bugfix: SPI setBitOrder maps msb→MSBFIRST lsb→LSBFIRST", () => {
  it("setBitOrder('msb') emits MSBFIRST (not LSBFIRST)", () => {
    const result = transpileArduino(`
      import { SPI0 } from '@typecad/framework-arduino/arduino';
      SPI0.begin();
      SPI0.setBitOrder('msb');
    `);
    expect(result.cpp).toContain("SPI.setBitOrder(MSBFIRST)");
    expect(result.cpp).not.toMatch(/SPI\.setBitOrder\(LSBFIRST\)/);
  });

  it("setBitOrder('lsb') emits LSBFIRST", () => {
    const result = transpileArduino(`
      import { SPI0 } from '@typecad/framework-arduino/arduino';
      SPI0.begin();
      SPI0.setBitOrder('lsb');
    `);
    expect(result.cpp).toContain("SPI.setBitOrder(LSBFIRST)");
  });
});

describe("HAL bugfix: I2C readByte emits requestFrom before read", () => {
  it("I2C0.device(addr).readByte(reg) emits requestFrom then read", () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const v = I2C0.device(0x68).readByte(0x00);
    `);
    // Must have requestFrom for 1 byte before the read
    expect(result.cpp).toContain("Wire.requestFrom(104, 1, true)");
    expect(result.cpp).toMatch(/v\s*=\s*Wire\.read\(\)/);
  });

  it("I2C0.readByte(addr, reg) bus-level also emits requestFrom", () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const v = I2C0.readByte(0x68, 0x00);
    `);
    expect(result.cpp).toContain("Wire.requestFrom(104, 1, true)");
    expect(result.cpp).toMatch(/v\s*=\s*Wire\.read\(\)/);
  });
});

describe("HAL bugfix: WDT enable maps timeout strings to WDTO_* macros", () => {
  it("WDT.enable('250ms') emits wdt_enable(WDTO_250MS)", () => {
    const result = transpileArduino(`
      import { WDT } from '@typecad/framework-arduino/arduino';
      WDT.enable('250ms');
    `);
    expect(result.cpp).toContain("wdt_enable(WDTO_250MS)");
    expect(result.cpp).not.toMatch(/wdt_enable\("250ms"\)/);
  });

  it("WDT.enable('500ms') emits wdt_enable(WDTO_500MS)", () => {
    const result = transpileArduino(`
      import { WDT } from '@typecad/framework-arduino/arduino';
      WDT.enable('500ms');
    `);
    expect(result.cpp).toContain("wdt_enable(WDTO_500MS)");
  });

  it("WDT.enable(4) passes numeric timeout through to wdt_enable", () => {
    const result = transpileArduino(`
      import { WDT } from '@typecad/framework-arduino/arduino';
      WDT.enable(4);
    `);
    expect(result.cpp).toContain("wdt_enable(4)");
    expect(result.cpp).not.toMatch(/wdt_enable\("4"\)/);
  });
});

describe("HAL bugfix: free attachInterrupt maps mode strings to macros", () => {
  it("attachInterrupt(pin, fn, 'FALLING') emits unquoted FALLING", () => {
    const result = transpileArduino(`
      import { D2, attachInterrupt } from '@typecad/framework-arduino/arduino';
      function isr() {}
      attachInterrupt(D2, isr, 'FALLING');
    `);
    expect(result.cpp).toMatch(/attachInterrupt\([^,]+, isr, FALLING\)/);
    expect(result.cpp).not.toMatch(/"FALLING"/);
  });

  it("attachInterrupt(pin, fn, 'RISING') emits unquoted RISING", () => {
    const result = transpileArduino(`
      import { D2, attachInterrupt } from '@typecad/framework-arduino/arduino';
      function isr() {}
      attachInterrupt(D2, isr, 'RISING');
    `);
    expect(result.cpp).toMatch(/attachInterrupt\([^,]+, isr, RISING\)/);
  });

  it("attachInterrupt(pin, fn, 'CHANGE') emits unquoted CHANGE", () => {
    const result = transpileArduino(`
      import { D2, attachInterrupt } from '@typecad/framework-arduino/arduino';
      function isr() {}
      attachInterrupt(D2, isr, 'CHANGE');
    `);
    expect(result.cpp).toMatch(/attachInterrupt\([^,]+, isr, CHANGE\)/);
  });
});

describe("HAL bugfix: I2C readBytes uses static buffer (no dangling pointer)", () => {
  it("readBytes emits a static buffer, not a stack-local return", () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const buf = I2C0.device(0x68).readBytes(0x00, 2);
    `);
    // static buffer (matches the SPI readRegister pattern), so the returned
    // reference outlives the call instead of pointing at a dead stack frame.
    expect(result.cpp).toMatch(/static\s+uint8_t\s+__buf/);
    expect(result.cpp).toMatch(/__buf\[__i\]\s*=\s*Wire\.read/);
  });
});

// Note: async.currentTask rawCpp missing-semicolon is a source-consistency nit,
// not a behavioral bug (the statement renderer already terminates the call).
// It is fixed in the cleanup phase for source consistency with sleep/yield.
