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


// String values, remove(), and clear() — a FRESH namespace so persistence
// across re-flashing can never leak state into the typed-value groups
// above (Store values live in the board's storage partition, not the app
// image).
describe("Store string values")
  .it("getString() of an absent key returns the default")
  .expectString(
    (() => {
      const s = new Store('strings-fresh');
      return s.getString('name', 'fallback');
    })
  ).toBe("fallback")
  .it("setString() then getString() roundtrips")
  .expectString(
    (() => {
      const s = new Store('strings-fresh');
      s.setString('name', 'blackpill');
      return s.getString('name', '?');
    })
  ).toBe("blackpill")

describe("Store remove()")
  .it("remove() of a present key returns true")
  .expect(
    (() => {
      const s = new Store('strings-fresh');
      s.setString('doomed', 'x');
      return s.remove('doomed') ? 1 : 0;
    })
  ).toBe(1)
  .it("remove() of an absent key returns false")
  .expect(
    (() => {
      const s = new Store('strings-fresh');
      return s.remove('never-was') ? 1 : 0;
    })
  ).toBe(0)
  .it("after remove(), getString() falls back again")
  .expectString(
    (() => {
      const s = new Store('strings-fresh');
      return s.getString('doomed', 'gone');
    })
  ).toBe("gone")

describe("Store clear()")
  .it("clear() empties every key in the namespace")
  .expect(
    (() => {
      const s = new Store('strings-fresh');
      s.setInt('k1', 1);
      s.setString('k2', 'v');
      s.clear();
      const gone = s.getInt('k1', -1) === -1 && s.getString('k2', '?') === '?';
      return gone ? 1 : 0;
    })
  ).toBe(1)

done();
