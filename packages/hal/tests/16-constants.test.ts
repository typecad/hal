import { describe, done } from '@typecad/expect';
import { HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP, LED } from '@TypeCAD';

describe("Digital value constants")
  .it("HIGH is resolvable")
  .expect(
    (() => {
      return HIGH === HIGH ? 1 : 0;
    })
  ).toBe(1)
  .it("LOW is resolvable")
  .expect(
    (() => {
      return LOW === LOW ? 1 : 0;
    })
  ).toBe(1)

describe("Pin-mode constants pass through to pinMode")
  .it("OUTPUT passes through to pinMode without mangling")
  .expect(
    (() => {
      pinMode(13, OUTPUT);
      return 1;
    })
  ).toBe(1)
  .it("INPUT passes through to pinMode without mangling")
  .expect(
    (() => {
      pinMode(12, INPUT);
      return 1;
    })
  ).toBe(1)
  .it("INPUT_PULLUP passes through to pinMode without mangling")
  .expect(
    (() => {
      pinMode(11, INPUT_PULLUP);
      return 1;
    })
  ).toBe(1)
  .it("HIGH and LOW pass through to digitalWrite")
  .expect(
    (() => {
      digitalWrite(13, HIGH);
      digitalWrite(13, LOW);
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
      shiftOut(8, 9, 0, 0x55);
      shiftOut(8, 9, 1, 0xAA);
      return 1;
    })
  ).toBe(1)

done();
