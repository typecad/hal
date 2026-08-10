// ---------------------------------------------------------------------------
// BLE characteristic index regression tests
//
// Covers the resolver bug where every characteristic on a multi-characteristic
// GATT server landed on index 0 (clobbering the previous on_read/on_write
// handler). The index is now assigned sequentially (0,1,2,…) from a per-file
// counter at the bleAddChar plugin site.
//
// Uses transpileZephyrStrategy because framework-arduino marks ble.* as
// 'unsupported' — the BLE lowering only exists in @typecad/framework-zephyr
// (src/lowering/ble.ts), and the strategy routes semantic-op resolution
// through it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpileZephyrStrategy } from "../../setup";

/** Extract the __tc_ble_add_char(idx, …) indices in declaration order. */
function charIndices(cpp: string): number[] {
  const re = /__tc_ble_add_char\(\s*(\d+)\s*,/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cpp)) !== null) out.push(Number(m[1]));
  return out;
}

describe("BLE characteristic index assignment", () => {
  it("assigns sequential indices to multiple characteristics across separate server() calls", () => {
    // The common ble-demo pattern: one Ble.server(name).characteristic(...) per
    // char. Before the fix, every add_char call emitted index 0, so the second
    // characteristic's on_read handler overwrote the first's slot.
    const result = transpileZephyrStrategy(`
      import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

      Ble.server('Multi')
        .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
        .onRead(() => 2180);

      Ble.server('Multi')
        .characteristic('2A6F', BleValueType.Uint16, BlePerm.Read)
        .onRead(() => 5500);

      Ble.server('Multi')
        .characteristic('2A19', BleValueType.Uint8, BlePerm.Read)
        .onRead(() => 87);

      Ble.server('Multi').begin();
      while (true) { delay(1000); }
    `);

    const indices = charIndices(result.cpp);
    expect(indices).toEqual([0, 1, 2]);
  });

  it("assigns index 0 to a single characteristic (no regression for the minimal case)", () => {
    const result = transpileZephyrStrategy(`
      import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

      Ble.server('Solo')
        .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
        .onRead(() => 2180);

      Ble.server('Solo').begin();
      while (true) { delay(1000); }
    `);

    expect(charIndices(result.cpp)).toEqual([0]);
  });

  it("assigns unique indices when read + write handlers chain on one characteristic", () => {
    // The setpoint pattern: read+write on one char, then a separate notify char.
    // The write handler must land in its own slot, not clobber the read.
    const result = transpileZephyrStrategy(`
      import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

      let setpoint = 2000;
      function onWrite(v: number): void { setpoint = v; }

      Ble.server('RW')
        .characteristic('2A1F', BleValueType.Int16, BlePerm.Read | BlePerm.Write)
        .onRead(() => setpoint)
        .onWrite(onWrite);

      Ble.server('RW')
        .characteristic('2A58', BleValueType.Int16, BlePerm.Read | BlePerm.Notify)
        .onRead(() => 2200);

      Ble.server('RW').begin();
      while (true) { delay(1000); }
    `);

    const indices = charIndices(result.cpp);
    expect(indices).toEqual([0, 1]);
  });
});
