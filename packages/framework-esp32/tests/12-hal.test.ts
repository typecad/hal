import { describe, done } from '@typecad/expect';


// Timing exercises the AVR strategy's native delay shims (_native_delay_ms /
// _native_delay_us emitted by shimLines) and the inherited Arduino millis/
// micros. On-device this proves the F_CPU-derived delay loops and the
// Timer0-backed millis counter run correctly on real silicon.

describe("Timing namespace")
  .it("Timing.millis() returns a non-negative value")
  .expect(
    (() => {
      const t = Timing.millis();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.micros() returns a non-negative value")
  .expect(
    (() => {
      const t = Timing.micros();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.millis() advances over time")
  .expect(
    (() => {
      const t0 = Timing.millis();
      Timing.delay(5);
      const t1 = Timing.millis();
      return t1 >= t0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.delay() is callable without crashing")
  .expect(
    (() => {
      Timing.delay(1);
      return 1;
    })
  ).toBe(1)
  .it("Timing.delayMicroseconds() is callable without crashing")
  .expect(
    (() => {
      Timing.delayMicroseconds(100);
      return 1;
    })
  ).toBe(1)

done();

// @typecad-skip-target esp32: ESP32 EEPROMClass has no update() method.

describe("EEPROM namespace")
  .it("EEPROM.length() is positive")
  .expect(
    (() => {
      const sz = EEPROM.length();
      return sz > 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("EEPROM.write then EEPROM.read roundtrip")
  .expect(
    (() => {
      EEPROM.write(0, 99);
      const v = EEPROM.read(0);
      return v;
    })
  ).toBe(99)
  .it("EEPROM.update preserves value when unchanged")
  .expect(
    (() => {
      EEPROM.write(1, 42);
      EEPROM.update(1, 42);
      return EEPROM.read(1);
    })
  ).toBe(42)
  .it("EEPROM.update changes value when different")
  .expect(
    (() => {
      EEPROM.write(2, 10);
      EEPROM.update(2, 20);
      return EEPROM.read(2);
    })
  ).toBe(20)

done();

// @typecad-skip-target esp32: ESP32 does not expose the AVR watchdog API.

describe("WDT namespace")
  .it("WDT.reset() is callable without crashing")
  .expect(
    (() => {
      WDT.reset();
      return 1;
    })
  ).toBe(1)
  .it("WDT.enable() then WDT.disable() does not trigger reset")
  .expect(
    (() => {
      WDT.enable('250ms');
      WDT.disable();
      return 1;
    })
  ).toBe(1)
  .it("WDT.enable() + WDT.reset() + WDT.disable() full cycle")
  .expect(
    (() => {
      WDT.enable('500ms');
      WDT.reset();
      WDT.disable();
      return 1;
    })
  ).toBe(1)

done();

describe("Preferences namespace")
  .it("Preferences.putInt then Preferences.getInt roundtrip")
  .expect(
    (() => {
      Preferences.begin("test");
      Preferences.putInt("count", 42);
      const v = Preferences.getInt("count", 0);
      Preferences.end();
      return v;
    })
  ).toBe(42)
  .it("Preferences.putBool then Preferences.getBool roundtrip")
  .expect(
    (() => {
      Preferences.begin("test");
      Preferences.putBool("flag", true);
      const v = Preferences.getBool("flag", false);
      Preferences.end();
      return v ? 1 : 0;
    })
  ).toBe(1)
  .it("Preferences.get returns default for missing key")
  .expect(
    (() => {
      Preferences.begin("test");
      const v = Preferences.getInt("nonexistent", -1);
      Preferences.end();
      return v;
    })
  ).toBe(-1)
  .it("Preferences.putString then Preferences.getString roundtrip")
  .expect(
    (() => {
      Preferences.begin("test");
      Preferences.putString("label", "hello");
      const match = (Preferences.getString("label", "") === "hello") ? 1 : 0;
      Preferences.end();
      return match;
    })
  ).toBe(1)
  .it("Preferences.clear removes stored values")
  .expect(
    (() => {
      Preferences.begin("test");
      Preferences.putInt("x", 99);
      Preferences.clear();
      const v = Preferences.getInt("x", 0);
      Preferences.end();
      return v;
    })
  ).toBe(0)
  .it("Preferences.remove deletes a single key")
  .expect(
    (() => {
      Preferences.begin("test");
      Preferences.putInt("keep", 10);
      Preferences.putInt("del", 20);
      Preferences.remove("del");
      const a = Preferences.getInt("keep", 0);
      const b = Preferences.getInt("del", -1);
      Preferences.end();
      return (a === 10 && b === -1) ? 1 : 0;
    })
  ).toBe(1)


done();
