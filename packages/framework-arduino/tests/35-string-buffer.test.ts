import { describe, done } from '@typecode/expect';

describe("String buffer non-aliasing")
  .it("trim called twice in same concat does not alias")
  .expectString(
    (() => {
      const a = "  hello  ";
      const b = "  world  ";
      return a.trim() + " " + b.trim();
    })
  ).toBe("hello world")
  .it("toUpperCase and toLowerCase in same expression")
  .expectString(
    (() => {
      const x = "low";
      const y = "HIGH";
      return x.toUpperCase() + y.toLowerCase();
    })
  ).toBe("LOWhigh")
  .it("replace called twice in same concat")
  .expectString(
    (() => {
      const a = "hello world";
      const b = "foo bar";
      return a.replace("world", "earth") + " " + b.replace("foo", "baz");
    })
  ).toBe("hello earth baz bar")
  .it("charAt called twice in same expression")
  .expectString(
    (() => {
      const s = "ABCD";
      return s.charAt(0) + s.charAt(2);
    })
  ).toBe("AC")

done();
