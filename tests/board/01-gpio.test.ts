import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles gpioOut, gpioIn, interrupt
// Shared board-level GPIO suite, adapted to the thin HAL (the rework removed
// the ambient Pin fluent API — pinMode/asOutput/digitalWrite — in favor of
// the GPIO class: construction carries the flag combination, set/get/toggle
// lower to gpio_pin_*_dt, and the configure is emitted guarded-per-pin ahead
// of the first use). Runs unchanged on every board: pin choices live in the
// board config's test-pins.json (resolved via the '@typecad/test-pins'
// virtual module). The LED alias is deliberately NOT required here (boards
// without a led0 devicetree node — e.g. the ESP32-S3 devkitC — still run
// this group; the dedicated LED group covers the alias where it exists).
import { GPIO_OUT, GPIO_IN, INT_PIN } from '@typecad/test-pins';
import { GPIO } from '@typecad/hal';

describe("GPIO mode construction")
  .it("GPIO.OUTPUT construction configures without crashing")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT);
      p.set(false);
      return 1;
    })
  ).toBe(1)
  .it("GPIO.INPUT | GPIO.PULL_UP construction configures without crashing")
  .expect(
    (() => {
      const p = new GPIO(GPIO_IN, GPIO.INPUT | GPIO.PULL_UP);
      p.get();
      return 1;
    })
  ).toBe(1)
  .it("GPIO.INPUT | GPIO.PULL_DOWN construction configures without crashing")
  .expect(
    (() => {
      const p = new GPIO(GPIO_IN, GPIO.INPUT | GPIO.PULL_DOWN);
      p.get();
      return 1;
    })
  ).toBe(1)
  .it("GPIO.OUTPUT | GPIO.OUTPUT_INIT_HIGH sets the initial level atomically")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT | GPIO.OUTPUT_INIT_HIGH);
      p.set(true);
      return 1;
    })
  ).toBe(1)
  .it("GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW sets the initial level atomically")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW);
      p.set(false);
      return 1;
    })
  ).toBe(1)
  .it("GPIO.OUTPUT | GPIO.OPEN_DRAIN construction is accepted")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT | GPIO.OPEN_DRAIN);
      p.set(true);
      return 1;
    })
  ).toBe(1)

describe("GPIO digital writes")
  .it("set(true) then set(false) is callable")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT);
      p.set(true);
      p.set(false);
      return 1;
    })
  ).toBe(1)
  .it("toggle() is callable")
  .expect(
    (() => {
      const p = new GPIO(GPIO_OUT, GPIO.OUTPUT);
      p.toggle();
      return 1;
    })
  ).toBe(1)

describe("GPIO reads")
  .it("input read returns a usable boolean")
  .expect(
    (() => {
      const p = new GPIO(GPIO_IN, GPIO.INPUT | GPIO.PULL_UP);
      const v: boolean = p.get();
      return v === true || v === false ? 1 : 0;
    })
  ).toBe(1)
  .it("button (INT_PIN, pull-up, not pressed) reads logically false")
  .expect(
    (() => {
      const btn = new GPIO(INT_PIN, GPIO.INPUT | GPIO.PULL_UP);
      return btn.get() ? 1 : 0;
    })
  ).toBe(0)

describe("GPIO interrupts (DT-spec path)")
  .it("onInterrupt(INT_EDGE_FALLING) registers a handler")
  .expect(
    (() => {
      const btn = new GPIO(INT_PIN, GPIO.INPUT | GPIO.PULL_UP);
      btn.onInterrupt(GPIO.INT_EDGE_FALLING, () => {});
      return 1;
    })
  ).toBe(1)
  .it("offInterrupt() detaches cleanly")
  .expect(
    (() => {
      const btn = new GPIO(INT_PIN, GPIO.INPUT | GPIO.PULL_UP);
      btn.onInterrupt(GPIO.INT_EDGE_RISING, () => {});
      btn.offInterrupt();
      return 1;
    })
  ).toBe(1)

done();
