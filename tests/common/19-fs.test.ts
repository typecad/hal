import { describe, done } from '@typecad/hal/testing';
// Persistent-file suite — the File class against littlefs on the board's
// storage partition (synthesized on boards whose DTS ships none; the board's
// own storage_partition where it does — ESP32's AMP layout). Write/read/
// remove roundtrips prove the mount + the fs API path end to end. String
// reads assert through expectString (the protocol's string-typed form).
import { File } from '@typecad/hal';

describe("File write/read roundtrip")
  .it("write() then read() returns the written text")
  .expectString(
    (() => {
      const f = new File('a.txt');
      f.write('hello fs');
      return f.read();
    })
  ).toBe("hello fs")
  .it("read() of a missing file returns the empty string")
  .expectString(
    (() => {
      const f = new File('missing.txt');
      return f.read();
    })
  ).toBe("")
  .it("a second write() overwrites the file")
  .expectString(
    (() => {
      const f = new File('b.txt');
      f.write('first');
      f.write('second');
      return f.read();
    })
  ).toBe("second");

describe("File exists/remove")
  .it("exists() is true after write() and false after remove()")
  .expect(
    (() => {
      const f = new File('c.txt');
      f.write('x');
      const existed = f.exists();
      f.remove();
      const stillThere = f.exists();
      return (existed ? 1 : 0) * 10 + (stillThere ? 1 : 0);
    })
  ).toBe(10)
  .it("remove() of a missing file is a no-op")
  .expect(
    (() => {
      const f = new File('never.txt');
      f.remove();
      return f.exists() ? 1 : 0;
    })
  ).toBe(0);

done();
