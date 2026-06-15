// ---------------------------------------------------------------------------
// main.ts — Relay packet-router sim driver.
//
// SUPPORT_MATRIX tour:
//   §1.1  let/const, multiple decls
//   §1.5  typed arrays (Uint8Array literals), 2D grid access
//   §2.2  for, for...of, do...while
//   §3.2  default + rest params (via injected payload builder)
//   §5.1  bitwise CRC validation of delivered packets
//   §5.2  Math.floor for stats rounding
//   §6.1  top-level → main()
//   §6.2  multi-file local imports
// ---------------------------------------------------------------------------

import { Rng } from './services/Rng';
import { crc8, pack32, popcount, unpack32Into } from './services/Crc';
import {
  GRID_H,
  GRID_W,
  LinkFlag,
  MAX_TICKS,
  Node,
  NodeKind,
  Packet,
  PAYLOAD_LEN,
} from './models/Types';
import {
  buildNetwork,
  buildRoutingTable,
  forward,
  gridAt,
  manhattan,
} from './models/Network';

const rng = Rng.fromSeed(0x1234567);
const grid = buildNetwork(rng);
const table = buildRoutingTable(grid);

// The sink sits at the far corner.
const sink = gridAt(grid, GRID_W - 1, GRID_H - 1);

// Inject a packet per tick from the source toward the sink, then forward it
// through the grid until delivered or MAX_TICKS exhausted. We keep a parallel
// array of delivered packets for end-of-run stats.
// Stats accumulators. We track counts rather than storing Packet objects,
// because a Packet carrying a Uint8Array field would store a dangling stack
// pointer once the injection scope exits (the typed-array lifetime gap).
let delivered = 0;
let dropped = 0;
let crcSum = 0;
let bitSum = 0;
let deliveredHops = 0;

let tick = 0;
do {
  // §1.5 — build a small payload via pack32 + unpack32 (bitwise round-trip).
  const seed32 = rng.next();
  // §5.1 — pack the 4 bytes of seed32 into a uint32, then unpack back to a
  // typed array. Exercises both shift directions and OR/AND composition.
  const word = pack32(
    seed32 & 0xFF,
    (seed32 >> 8) & 0xFF,
    (seed32 >> 16) & 0xFF,
    (seed32 >> 24) & 0xFF,
  );
  // §1.5 — new Uint8Array([...]) literal. This array is alive only for this
  // loop iteration; the CRC is computed inline below before the scope exits.
  const payload = new Uint8Array([0, 0, 0, 0]);
  unpack32Into(word, payload);

  let pkt: Packet = {
    src: 0,
    cur: 0,
    dst: sink.id,
    hops: 0,
    delivered: false,
  };

  // §2.2 — forward hop by hop until delivered or hop budget blown.
  let safety = 0;
  while (!pkt.delivered && safety < 8) {
    pkt = forward(pkt, grid, table);
    safety = safety + 1;
  }

  if (pkt.delivered) {
    delivered = delivered + 1;
    deliveredHops = deliveredHops + pkt.hops;
    // Compute CRC now, while `payload` is still alive on the stack.
    const c = crc8(payload, PAYLOAD_LEN);
    crcSum = crcSum + c;
    bitSum = bitSum + popcount(c);
  } else {
    dropped = dropped + 1;
  }
  tick = tick + 1;
} while (tick < MAX_TICKS);

// ---------------------------------------------------------------------------
// Stats. §5.2 Math.floor for rounding.
// ---------------------------------------------------------------------------
const totalHops = deliveredHops;
const avgHops = delivered > 0 ? Math.floor((totalHops / delivered) * 10) / 10 : 0;

// §1.7 — const enum comparison (===).
let sourceLinks = 0;
let sinkLinks = 0;
for (let y = 0; y < GRID_H; y++) {
  for (let x = 0; x < GRID_W; x++) {
    const node = gridAt(grid, x, y);
    if (node.kind === NodeKind.Source) {
      sourceLinks = sourceLinks + popcount(node.right) + popcount(node.down);
    } else if (node.kind === NodeKind.Sink) {
      sinkLinks = sinkLinks + popcount(node.up) + popcount(node.left);
    }
  }
}

// Manhattan distance source→sink, as a routing lower bound.
const sourcePos = gridAt(grid, 0, 0).pos;
const lowerBound = manhattan(sourcePos, sink.pos);

console.log('=== RELAY sim complete ===');
console.log(`ticks=${MAX_TICKS} grid=${GRID_W}x${GRID_H}`);
console.log(`delivered=${delivered} dropped=${dropped}`);
console.log(`total_hops=${totalHops} avg_hops=${avgHops}`);
console.log(`manhattan_lower_bound=${lowerBound}`);
console.log(`crc_sum=${crcSum} set_bits=${bitSum}`);
console.log(`source_outbound_links=${sourceLinks} sink_inbound_links=${sinkLinks}`);
