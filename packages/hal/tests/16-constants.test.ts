import { describe, done } from '@typecad/expect';
// Black Pill: raw pin numbers follow the port-block scheme (PA<n> = n), so
// pins 11/12/13 would be USB D-/D+ and SWDIO — the numeric smoke pins below
// deliberately use PA1–PA3 instead to keep the USB console and the SWD probe
// alive. LED is the onboard PC13 (active-low, honored via the led0 DT spec).
import { HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP, LED } from '@typecad/board';

describe("Digital value constants")
  .it("HIGH and LOW are distinct, well-known values")
  .expect(
    (() => {
      return HIGH !== LOW ? 1 : 0;
    })
  ).toBe(1)
  .it("HIGH equals 1 and LOW equals 0")
  .expect(
    (() => {
      return HIGH === 1 && LOW === 0 ? 1 : 0;
    })
  ).toBe(1)

describe("Pin-mode constants pass through to pinMode")
  .it("OUTPUT passes through to pinMode without mangling")
  .expect(
    (() => {
      pinMode(1, OUTPUT);
      return 1;
    })
  ).toBe(1)
  .it("INPUT passes through to pinMode without mangling")
  .expect(
    (() => {
      pinMode(2, INPUT);
      return 1;
    })
  ).toBe(1)
  .it("INPUT_PULLUP passes through to pinMode without mangling")
  .expect(
    (() => {
      pinMode(3, INPUT_PULLUP);
      return 1;
    })
  ).toBe(1)
  .it("HIGH and LOW pass through to digitalWrite")
  .expect(
    (() => {
      digitalWrite(1, HIGH);
      digitalWrite(1, LOW);
      return 1;
    })
  ).toBe(1)

describe("Board constants")
  .it("LED alias is usable with pinMode and digitalWrite")
  .expect(
    (() => {
      LED.asOutput();
      LED.high();
      LED.low();
      return 1;
    })
  ).toBe(1)

describe("Shift bit-order constants")
  .it("LSBFIRST and MSBFIRST pass through to shiftOut")
  .expect(
    (() => {
      shiftOut(2, 3, 0, 0x55);
      shiftOut(2, 3, 1, 0xAA);
      return 1;
    })
  ).toBe(1)

done();
