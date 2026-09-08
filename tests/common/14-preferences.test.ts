import { describe, done } from '@typecad/hal/testing';
// Persistent-key suite — the ZMS/settings lowering against real on-chip
// flash through the synthesized storage partition (boards whose DTS ships
// no storage_partition get one near the top of flash; boards that have
// one use their own). These roundtrips prove the whole persist path.
import { Store } from '@typecad/hal';

describe("Store int roundtrip")
  .it("setInt then getInt returns the stored value")
  .expect(
    (() => {
      const store = new Store('test');
      store.setInt('count', 42);
      return store.getInt('count', 0);
    })
  ).toBe(42)
  .it("getInt falls back to the default for a missing key")
  .expect(
    (() => {
      const store = new Store('test');
      return store.getInt('missing', 7);
    })
  ).toBe(7)

describe("Store float roundtrip")
  .it("setFloat then getFloat returns the stored value (compared in tenths)")
  .expect(
    (() => {
      const store = new Store('test');
      store.setFloat('ratio', 2.5);
      const v = store.getFloat('ratio', 0.0);
      return Math.round(v * 10);
    })
  ).toBe(25)

describe("Store bool roundtrip")
  .it("setBool(true) then getBool returns true")
  .expect(
    (() => {
      const store = new Store('test');
      store.setBool('flag', true);
      return store.getBool('flag', false) ? 1 : 0;
    })
  ).toBe(1)
  .it("getBool falls back to the default for a missing key")
  .expect(
    (() => {
      const store = new Store('test');
      return store.getBool('missing', false) ? 1 : 0;
    })
  ).toBe(0)

describe("Store overwrite")
  .it("a second setInt overwrites the first value")
  .expect(
    (() => {
      const store = new Store('test');
      store.setInt('slot', 10);
      store.setInt('slot', 99);
      return store.getInt('slot', 0);
    })
  ).toBe(99)

done();
