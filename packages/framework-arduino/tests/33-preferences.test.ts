import { describe, done } from '@typehal/expect';

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
