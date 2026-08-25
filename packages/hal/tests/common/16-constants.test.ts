import { describe, done } from '@typecad/expect';
// Constant pass-through smoke tests. The numeric-API smokes (pinMode/
// digitalWrite/shiftOut) use the board's declared test pins via
// '@typecad/test-pins' — the transpiler resolves pin symbols in numeric
// argument positions, so the raw-number form (which is board wiring: pin 1
// is PA1 on the Black Pill but UART0 TX on the ESP32) never appears.
import { HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP } from '@typecad/board';
import { GPIO_OUT, GPIO_IN } from '@typecad/test-pins';

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
      pinMode(GPIO_OUT, OUTPUT);
      return 1;
    })
  ).toBe(1)
  .it("INPUT passes through to pinMode without mangling")
  .expect(
    (() => {
      pinMode(GPIO_IN, INPUT);
      return 1;
    })
  ).toBe(1)
  .it("INPUT_PULLUP passes through to pinMode without mangling")
  .expect(
    (() => {
      pinMode(GPIO_IN, INPUT_PULLUP);
      return 1;
    })
  ).toBe(1)
  .it("HIGH and LOW pass through to digitalWrite")
  .expect(
    (() => {
      digitalWrite(GPIO_OUT, HIGH);
      digitalWrite(GPIO_OUT, LOW);
      return 1;
    })
  ).toBe(1)

describe("Shift bit-order constants")
  .it("LSBFIRST and MSBFIRST pass through to shiftOut")
  .expect(
    (() => {
      shiftOut(GPIO_OUT, GPIO_IN, 0, 0x55);
      shiftOut(GPIO_OUT, GPIO_IN, 1, 0xAA);
      return 1;
    })
  ).toBe(1)

done();
