import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles led
// LED alias coverage, adapted to the thin GPIO class (active-low boards are
// honored through their led0 DT spec — set(true) is logical ON).
import { LED_PIN } from '@typecad/test-pins';
import { GPIO } from '@typecad/hal';

describe("Board LED alias")
  .it("LED alias is usable as a GPIO output")
  .expect(
    (() => {
      const led = new GPIO(LED_PIN, GPIO.OUTPUT);
      led.set(true);
      led.set(false);
      return 1;
    })
  ).toBe(1)
  .it("LED alias toggle is callable")
  .expect(
    (() => {
      const led = new GPIO(LED_PIN, GPIO.OUTPUT);
      led.toggle();
      return 1;
    })
  ).toBe(1)
  .it("LED OUTPUT_INIT_HIGH then OUTPUT_INIT_LOW constructions are accepted")
  .expect(
    (() => {
      const a = new GPIO(LED_PIN, GPIO.OUTPUT | GPIO.OUTPUT_INIT_HIGH);
      a.set(true);
      const b = new GPIO(LED_PIN, GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW);
      b.set(false);
      return 1;
    })
  ).toBe(1)

done();
