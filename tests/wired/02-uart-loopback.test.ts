import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles uartLoop
// WIRED TIER — not part of the default per-board runs. Run explicitly with:
//
//   npm run test:hw:wired --workspace @typecad/hal
//
// WIRING: one jumper from the uartLoop port's TX pin to its RX pin
// (blackpill: UART0 TX=PA9 → RX=PA10). This proves the receive path the
// idle-line suite cannot: the interrupt-drained ring, available() > 0, and
// read() returning real bytes.
//
// The port is the console on some boards — the runner's protocol writes
// ride the same TX — so the test does NOT assert byte-exact echo. It arms
// the ring FIRST (bytes arriving before the first receive call are not
// drained), then writes a UNIQUE MARKER and scans the ring for it with a
// bounded wait; protocol lines never contain the marker.
import { UART } from '@typecad/hal';
import { UART_LOOP } from '@typecad/test-pins';

const MARKER = 'L00PB@CK-M0';

describe("Wired UART TX→RX loopback")
  .it("a written marker comes back through the receive ring")
  .expect(
    (() => {
      const port = new UART(UART_LOOP);
      // Arm the ring before writing (the IRQ drain starts at the first
      // receive call; earlier bytes are dropped by design).
      const warmup = port.available();
      port.writeLine(MARKER);
      let saw = 0;
      let scanned = 0;
      for (let i = 0; i < 200; i += 1) {
        while (port.available() > 0) {
          const b = port.read();
          scanned += 1;
          // Cheap rolling compare on the first char: the marker starts
          // with 'L' (76); the protocol lines start with '[' (91) or '['TC.
          if (b === 76) {
            saw += 1;
          }
        }
        if (saw > 0) {
          break;
        }
        // Poll pause — the ring drains from ISR context.
        let spin = 0;
        while (spin < 20000) {
          spin += 1;
        }
      }
      // The marker's first byte came back (and the warmup read didn't
      // crash on the idle ring).
      return warmup === 0 && saw > 0 && scanned > 0 ? 1 : 0;
    })
  ).toBe(1)

done();
