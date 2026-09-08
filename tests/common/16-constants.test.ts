import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles gpioOut, gpioIn
// Constant pass-through smoke tests, adapted to the thin surface. The GPIO.*
// flag tokens exist only as construction arguments (they map to gpio.h
// macros at construction sites — there is no C++ GPIO class to compare
// against), so the pass-through proof is construction with each combination.
// The shift bit-order literals still pass through the free shiftOut/shiftIn
// functions. Pin symbols resolve in argument positions via
// '@typecad/test-pins', so raw board numbers never appear here.
import { GPIO_OUT, GPIO_IN } from '@typecad/test-pins';
import { GPIO } from '@typecad/hal';
import { shiftOut, shiftIn } from '@typecad/hal';

describe("Flag combinations pass through to construction")
  .it("OUTPUT reaches the emitter unmangled")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT);
      p.set(false);
      return 1;
    })
  ).toBe(1)
  .it("INPUT | PULL_UP reaches the emitter unmangled")
  .expect(
    (() => {
      const p = new GPIO(GPIO_IN, GPIO.INPUT | GPIO.PULL_UP);
      p.get();
      return 1;
    })
  ).toBe(1)
  .it("INPUT | PULL_DOWN reaches the emitter unmangled")
  .expect(
    (() => {
      const p = new GPIO(GPIO_IN, GPIO.INPUT | GPIO.PULL_DOWN);
      p.get();
      return 1;
    })
  ).toBe(1)
  .it("OUTPUT | OUTPUT_INIT_HIGH reaches the emitter unmangled")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT | GPIO.OUTPUT_INIT_HIGH);
      p.set(true);
      return 1;
    })
  ).toBe(1)
  .it("OUTPUT | OUTPUT_INIT_LOW reaches the emitter unmangled")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW);
      p.set(false);
      return 1;
    })
  ).toBe(1)
  .it("OUTPUT | OPEN_DRAIN reaches the emitter unmangled")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT | GPIO.OPEN_DRAIN);
      p.set(true);
      return 1;
    })
  ).toBe(1)

describe("Shift bit-order constants")
  .it("LSBFIRST and MSBFIRST pass through shiftOut")
  .expect(
    (() => {
      shiftOut(GPIO_OUT, GPIO_IN, 0, 0x55);
      shiftOut(GPIO_OUT, GPIO_IN, 1, 0xAA);
      return 1;
    })
  ).toBe(1)
  .it("both bit orders pass through shiftIn")
  .expect(
    (() => {
      shiftIn(GPIO_OUT, GPIO_IN, 0);
      shiftIn(GPIO_OUT, GPIO_IN, 1);
      return 1;
    })
  ).toBe(1)

done();
