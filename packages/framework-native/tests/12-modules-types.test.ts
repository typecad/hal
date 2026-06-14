import { describe, done } from '@typecad/expect';
import { clampToWindow, RollingCounter } from './transpiler-support';

describe("Modules and imports")
  .it("local module function import")
  .expect(
    (() => {
      return clampToWindow(120, { low: 10, high: 90 });
    })
  ).toBe(90)
  .expect(
    (() => {
      return clampToWindow(-5, { low: 10, high: 90 });
    })
  ).toBe(10)
  .it("local module class import")
  .expect(
    (() => {
      const counter = new RollingCounter(5);
      counter.add(2);
      counter.add(3);
      return counter.value;
    })
  ).toBe(10)

describe("Imported types and function expressions")
  .it("module type alias through function signature")
  .expect(
    (() => {
      return clampToWindow(55, { low: 10, high: 90 });
    })
  ).toBe(55)
  .it("function expression")
  .expect(
    (() => {
      const bump = function(value: number): number {
        return value + 1;
      };
      return bump(41);
    })
  ).toBe(42)

describe("Optional chaining")
  .it("property access with fallback")
  .expect(
    (() => {
      const wrapper = { sensor: { reading: 21 } };
      return wrapper.sensor?.reading ?? 0;
    })
  ).toBe(21)
  .expect(
    (() => {
      const config = { timeout: undefined, fallback: 250 };
      return config.timeout ?? config.fallback;
    })
  ).toBe(250)

done();
