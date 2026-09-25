import { describe, done } from '@typecad/hal/testing';
// CAN loopback — the zero-wiring hardware test: every frame sent in
// loopback mode returns through this controller's own accept-all filter,
// proving the whole path (DT node enable, driver init, frame build, tx
// submission, filter callback trampoline) with no transceiver and no bus.
// The callback runs in ISR context (the matrix discipline): it copies the
// frame into top-level slots; the test body reads them after a settle.
import { CAN, Time } from '@typecad/hal';

let gotId = -1;
let gotLen = -1;
let gotB0 = -1;
let gotB1 = -1;

const bus = new CAN(0, { loopback: true, hz: 500_000 });
bus.onReceive((id: number, len: number, b0: number, b1: number, b2: number, b3: number, b4: number, b5: number, b6: number, b7: number): void => {
  if (gotId < 0) {
    gotId = id;
    gotLen = len;
    gotB0 = b0;
    gotB1 = b1;
  }
});
bus.begin();

describe("CAN loopback round-trip")
  .it("a frame sent in loopback arrives at the receive filter intact")
  .expect(
    (() => {
      bus.send(0x123, [0x11, 0x22]);
      Time.sleep(100);
      const idOk = gotId === 0x123;
      const lenOk = gotLen === 2;
      const payloadOk = gotB0 === 0x11 && gotB1 === 0x22;
      if (idOk && lenOk && payloadOk) {
        return 1;
      }
      return 0;
    })
  ).toBe(1)
  .it("a second frame with a different id and payload also arrives")
  .expect(
    (() => {
      gotId = -1;
      bus.send(0x456, [0xAA]);
      Time.sleep(100);
      if (gotId === 0x456 && gotB0 === 0xAA) {
        return 1;
      }
      return 0;
    })
  ).toBe(1)

done();
