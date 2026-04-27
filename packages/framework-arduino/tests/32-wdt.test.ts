import { describe, done } from '@typecode/expect';

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
