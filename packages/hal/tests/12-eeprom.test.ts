import { describe, done } from '@typecad/expect';

// @typecad-skip-target esp32, stm32f411: ESP32 EEPROMClass has no update()
//   method, and framework-zephyr ships no EEPROM shim at all — EEPROM.*
//   lowers to raw `EEPROM.write(...)` C++ against the Arduino EEPROM library
//   object, which does not exist on Zephyr (compile error). Persistent
//   storage on this target goes through Preferences (ZMS settings on the
//   synthesized storage_partition) instead — see 14-preferences.test.ts.

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
  .it("EEPROM.put then EEPROM.get returns the stored value")
  .expect(
    (() => {
      const seed = { temp: 25, count: 3 };
      EEPROM.put(4, seed);
      const out = EEPROM.get(4, seed);
      return out.count;
    })
  ).toBe(3)

done();
