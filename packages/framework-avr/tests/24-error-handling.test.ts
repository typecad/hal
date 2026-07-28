import { describe, done } from '@typecad/expect';

describe("Error handling patterns")
  .it("error code return pattern")
  .expect(
    (() => {
      function readSensor(pin: number): number {
        if (pin < 0) {
          return -1;
        }
        return pin * 10;
      }
      const result = readSensor(3);
      return result;
    })
  ).toBe(30)
  .it("error code check on negative result")
  .expect(
    (() => {
      function readSensor(pin: number): number {
        if (pin < 0) {
          return -1;
        }
        return pin * 10;
      }
      const result = readSensor(-1);
      return result === -1 ? 0 : 1;
    })
  ).toBe(0)
  .it("success/fail status pattern")
  .expect(
    (() => {
      let cleanup = 0;
      let result = 0;
      const success = true;
      if (success) {
        result = 42;
      } else {
        result = 0;
      }
      cleanup = 1;
      return result + cleanup;
    })
  ).toBe(43)
  .it("validation with default fallback")
  .expect(
    (() => {
      function safeDivide(a: number, b: number): number {
        if (b === 0) {
          return 0;
        }
        return a / b;
      }
      return safeDivide(10, 2) + safeDivide(10, 0);
    })
  ).toBe(5)
  .it("status code chain")
  .expect(
    (() => {
      function init(): number { return 1; }
      function configure(): number { return 1; }
      function start(): number { return 1; }
      let status = 0;
      if (init() === 1) {
        if (configure() === 1) {
          if (start() === 1) {
            status = 3;
          }
        }
      }
      return status;
    })
  ).toBe(3)

done();
