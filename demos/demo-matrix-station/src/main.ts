import { CAN, Time } from '@typecad/hal';
let gotId = -1;
const bus = new CAN(0, { loopback: true, hz: 500_000 });
bus.onReceive((id: number, len: number, b0: number, b1: number, b2: number, b3: number, b4: number, b5: number, b6: number, b7: number): void => {
  if (gotId < 0) { gotId = id; }
});
bus.begin();
bus.send(0x123, [0x11, 0x22]);
Time.sleep(500);
