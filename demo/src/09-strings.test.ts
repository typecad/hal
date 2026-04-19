import { describe, done } from '@typecode/expect';

describe("String literals")
  .it("string length")
  .expectString(
    (() => {
      const greeting = "hello";
      return greeting;
    })
  ).toBe("hello")
  .it("string property access via length")
  .expect(
    (() => {
      const greeting = "hello";
      return greeting.length;
    })
  ).toBe(5)

describe("String concatenation")
  .it("concat with + operator")
  .expectString(
    (() => {
      const first = "hello";
      const second = " world";
      return first + second;
    })
  ).toBe("hello world")

describe("Template literals")
  .it("basic template literal")
  .expectString(
    (() => {
      const name = "TypeCode";
      return `Hello ${name}`;
    })
  ).toBe("Hello TypeCode")
  .it("template literal with expression")
  .expectString(
    (() => {
      const a = 3;
      const b = 4;
      return `${a} + ${b} = ${a + b}`;
    })
  ).toBe("3 + 4 = 7")
  .it("template literal with number interpolation")
  .expect(
    (() => {
      const template = `value`;
      return template.length;
    })
  ).toBe(5)

done();
