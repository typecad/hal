// ---------------------------------------------------------------------------
// i2c-responder-sim.test.ts — the simulator's I2C responder: device-side
// parity with the hardware class (II2CResponder), transaction-for-transaction
// fidelity with the Zephyr shim's callbacks, and the loopback bus routing
// (a registered responder answers device() at its address).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { SimI2CBus, SimI2CResponder, type II2CResponder } from '../../../packages/hal/src/sim';

// ===========================================================================
// Device-side surface — what firmware logic sees (the II2CResponder contract)
// ===========================================================================

describe('SimI2CResponder (device side)', () => {
  it('a controller write lands in the ring and announces its length at STOP', () => {
    const link = new SimI2CResponder(0x42);
    const received: number[] = [];
    link.onReceive((len: number): void => {
      received.push(len);
    });

    link.masterWrite([0x10, 0x20, 0x30]);

    expect(received).toEqual([3]);
    expect(link.available()).toBe(3);
    expect(link.read()).toBe(0x10);
    expect(link.read()).toBe(0x20);
    expect(link.read()).toBe(0x30);
    expect(link.read()).toBe(-1);
  });

  it('the ring resets per write transaction — drained bytes do not return', () => {
    const link = new SimI2CResponder(0x42);
    const received: number[] = [];
    link.onReceive((len: number): void => {
      received.push(len);
    });

    link.masterWrite([1, 2, 3, 4]);
    link.read();
    link.read();
    link.masterWrite([9]);

    expect(received).toEqual([4, 1]);
    expect(link.available()).toBe(1);
    expect(link.read()).toBe(9);
  });

  it('longer controller writes overflow-drop past rxBufferBytes', () => {
    const link = new SimI2CResponder(0x42, { rxBufferBytes: 4 });
    const received: number[] = [];
    link.onReceive((len: number): void => {
      received.push(len);
    });

    link.masterWrite([1, 2, 3, 4, 5, 6]);

    // The ring holds its four; the announcement counts what survived.
    expect(received).toEqual([4]);
    expect(link.available()).toBe(4);
  });

  it('a controller read fires onRequest (the refill point) and serves first-byte-first', () => {
    const link = new SimI2CResponder(0x42);
    let refills = 0;
    link.onRequest((): void => {
      refills++;
      link.write([0x01, 0x02, 0x03]);
    });

    const out = link.masterRead(4);

    expect(refills).toBe(1);
    expect(out).toEqual([0x01, 0x02, 0x03, 0xff]); // 0xFF past the buffer's end
  });

  it('the response buffer persists across reads until overwritten', () => {
    const link = new SimI2CResponder(0x42);
    link.write([0xaa, 0xbb]);
    expect(link.masterRead(2)).toEqual([0xaa, 0xbb]);
    // No onRequest installed, no overwrite — the same bytes serve again.
    expect(link.masterRead(2)).toEqual([0xaa, 0xbb]);
  });

  it('write() past txBufferBytes throws — the build error the lowering raises', () => {
    const link = new SimI2CResponder(0x42, { txBufferBytes: 4 });
    expect(() => link.write([1, 2, 3, 4, 5])).toThrow(/response buffer holds 4 bytes/);
  });

  it('a pure controller read does not fire onReceive while the ring is empty', () => {
    const link = new SimI2CResponder(0x42);
    const received: number[] = [];
    link.onReceive((len: number): void => {
      received.push(len);
    });
    link.write([0x55]);

    link.masterRead(1);

    expect(received).toEqual([]);
  });

  it('firmware logic typed against the II2CResponder contract runs unchanged', () => {
    // The demo-sim pattern: factor driver logic against the contract; the
    // same code runs against the board's I2CResponder on hardware.
    function echoFirstByte(link: II2CResponder): void {
      if (link.available() > 0) {
        link.write([link.read() & 0xff]);
      }
    }

    const link = new SimI2CResponder(0x2a);
    link.masterWrite([0x5e]);
    echoFirstByte(link);
    expect(link.masterRead(1)).toEqual([0x5e]);
  });

  it('reset clears buffers and handlers, keeps construction facts', () => {
    const link = new SimI2CResponder(0x42, { rxBufferBytes: 8, txBufferBytes: 8 });
    let fired = 0;
    link.onReceive((): void => {
      fired++;
    });
    link.masterWrite([1]);
    link.write([2]);

    link.reset();

    expect(link.available()).toBe(0);
    expect(link.address).toBe(0x42);
    link.masterWrite([9]); // handlers gone: no crash, no callback
    expect(fired).toBe(1);
  });
});

// ===========================================================================
// Bus integration — registration, loopback routing, conflicts, logging
// ===========================================================================

describe('SimI2CBus responder integration', () => {
  it('bus.responder() registers; device() at the address loops back through it', () => {
    const bus = new SimI2CBus(0);
    bus.begin();
    const link = bus.responder(0x42);
    const received: number[] = [];
    link.onReceive((len: number): void => {
      received.push(len);
    });

    // A controller write through the standard accessor: [reg, ...data].
    bus.device(0x42).writeBytes(0x10, [0xaa, 0xbb]);

    expect(received).toEqual([3]);
    expect(link.available()).toBe(3);
    expect(link.read()).toBe(0x10);
    expect(link.read()).toBe(0xaa);
  });

  it('a loopback read is one combined transaction: onRequest serves, the register byte lands', () => {
    const bus = new SimI2CBus(0);
    const link = bus.responder(0x42);
    const announced: number[] = [];
    link.onReceive((len: number): void => {
      announced.push(len);
    });
    link.onRequest((): void => {
      link.write([0xde, 0xad]);
    });

    const value = bus.device(0x42).readByte(0x07);

    expect(value).toBe(0xde);
    // The register-select byte (0x07) is a pending controller write at the
    // final STOP — the hardware shim announces it identically.
    expect(announced).toEqual([1]);
    expect(link.read()).toBe(0x07);
  });

  it('loopback reads never NACK — the responder ACKs its address', () => {
    const bus = new SimI2CBus(0);
    const link = bus.responder(0x50);
    link.onRequest((): void => {
      link.write([0x42]);
    });
    expect(bus.device(0x50).readByte(0x00)).toBe(0x42);
  });

  it('mock devices at other addresses keep working beside a responder', () => {
    const bus = new SimI2CBus(0);
    bus.responder(0x42);
    bus.attachDevice(0x68, { read: (_r, count) => new Array(count).fill(7), write() {} });
    expect(bus.device(0x68).readByte(0)).toBe(7);
  });

  it('an address cannot be held by a mock device and a responder at once', () => {
    const bus = new SimI2CBus(0);
    bus.attachDevice(0x42, { read: () => [], write() {} });
    expect(() => bus.responder(0x42)).toThrow(/held by a mock device/);

    const bus2 = new SimI2CBus(0);
    bus2.responder(0x42);
    expect(() => bus2.attachDevice(0x42, { read: () => [], write() {} })).toThrow(/held by a responder/);
  });

  it('responder() at one address is idempotent — the same object returns', () => {
    const bus = new SimI2CBus(0);
    const a = bus.responder(0x42, { rxBufferBytes: 16 });
    const b = bus.responder(0x42);
    expect(b).toBe(a);
  });

  it('master and loopback transactions log through the bus', () => {
    const bus = new SimI2CBus(0);
    const link = bus.responder(0x42);
    link.onRequest((): void => {
      link.write([1]);
    });

    link.masterWrite([9, 8]);
    bus.device(0x42).readByte(0x10);

    const log = bus.getLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ operation: 'write', address: 0x42, data: [9, 8] });
    expect(log[1]).toMatchObject({ operation: 'read', address: 0x42, register: 0x10, data: [1] });
  });

  it('bus.reset() releases responders — device() falls back to the NACK path', () => {
    const bus = new SimI2CBus(0);
    bus.responder(0x42);
    bus.reset();
    expect(bus.device(0x42).readBytes(0, 1).length).toBe(0);
  });

  it('board.reset() cascades — the sim board releases responders with the rest', async () => {
    const { createSimBoard } = await import('../../../packages/hal/src/sim');
    const board = createSimBoard({ i2cBusCount: 1 });
    const i2c = board.i2c(0);
    i2c.responder(0x42);
    board.reset();
    expect(i2c.device(0x42).readBytes(0, 1).length).toBe(0);
  });
});
