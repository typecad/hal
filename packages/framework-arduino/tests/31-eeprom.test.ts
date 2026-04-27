import { describe, done } from '@typecode/expect';

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
