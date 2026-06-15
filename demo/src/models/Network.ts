// ---------------------------------------------------------------------------
// Network.ts — grid network construction, routing tables, hop forwarding.
//
// SUPPORT_MATRIX tour:
//   §1.5  2D arrays Node[][] (🟡 → std::vector<std::vector<...>>)
//   §1.5  Map<int16, RouteEntry> routing tables, .has/.get/.set
//   §1.7  const enum dispatch (NodeKind), LinkFlag bit composition (§5.1)
//   §1.9  object/array destructuring in forwarding
//   §2.2  do...while for retry loops
//   §4.6  Owned<T> ownership wrapper on the grid (phantom, erased at emit)
// ---------------------------------------------------------------------------

import { Rng } from '../services/Rng';
import {
  GRID_H,
  GRID_W,
  LinkFlag,
  Node,
  NodeKind,
  Packet,
  Point,
  RouteEntry,
  flag,
} from './Types';

// §1.5 — 2D array of nodes. NodeKind[][] would be the raw grid kinds; we use
// Node[][] to also carry per-node link state. (We avoid `type Grid = Node[][]`
// as an alias here because generic/array aliases aren't emitted as C++
// typedefs — the lint rule `no-container-functional-methods`-family covers
// this. We inline `Node[][]` at each use site instead.)

// Manhattan distance between two grid points (§5.1 arithmetic).
export function manhattan(a: Point, b: Point): int16_t {
  const dx = a.x > b.x ? a.x - b.x : b.x - a.x;
  const dy = a.y > b.y ? a.y - b.y : b.y - a.y;
  return dx + dy;
}

// Safe 2D grid accessor. The demo tsconfig enables `noUncheckedIndexedAccess`,
// so `grid[y][x]` is typed `Node | undefined`. All accesses here are provably
// in-bounds (loop-bounded or known-valid), so we assert non-null centrally.
export function gridAt(grid: Node[][], x: int16_t, y: int16_t): Node {
  const row = grid[y];
  const node = row[x];
  return node;
}

// §1.5 — build a GRID_W × GRID_H grid of nodes. Each interior node gets wired
// links to its orthogonal neighbors; border directions are flagged None.
export function buildNetwork(rng: Rng): Node[][] {
  const grid: Node[][] = [];
  let id: int16_t = 0;
  for (let y = 0; y < GRID_H; y++) {
    const row: Node[] = [];
    for (let x = 0; x < GRID_W; x++) {
      // Link state as four scalar fields. Use flag() to convert the enum to
      // its int value before storing into a uint8 field — the renderer can't
      // infer the target type at an assignment site (see README note).
      const up = flag(y === 0 ? LinkFlag.None : LinkFlag.Wired);
      const right = flag(x === GRID_W - 1 ? LinkFlag.None : LinkFlag.Wired);
      const down = flag(y === GRID_H - 1 ? LinkFlag.None : LinkFlag.Wired);
      const leftf = flag(x === 0 ? LinkFlag.None : LinkFlag.Wired);

      // §1.7 — const enum value as a literal.
      let kind: NodeKind = NodeKind.Router;
      if (x === 0 && y === 0) {
        kind = NodeKind.Source;
      } else if (x === GRID_W - 1 && y === GRID_H - 1) {
        kind = NodeKind.Sink;
      }

      // §1.5/§1.6 — object literal → struct initializer.
      const node: Node = {
        id,
        kind,
        pos: { x, y },
        up,
        right,
        down,
        left: leftf,
      };
      row.push(node);
      id = id + 1;
    }
    grid.push(row);
  }
  return grid;
}

// Compose the outbound link flags for a node given a destination. Picks the
// direction that reduces Manhattan distance, preferring wired links. Uses
// §5.1 bitwise composition to combine flags.
//
// NOTE: the accumulator is an int16_t (plain int), not a LinkFlag-typed
// variable. `enum class` bitwise ops now static_cast operands to int (Demo #5
// fix), but assigning the int result back to a LinkFlag-typed lvalue would
// need a back-cast the renderer can't infer. Using a plain-int accumulator
// sidesteps this.
export function routeFor(from: Node, dst: Point): int16_t {
  let flags: int16_t = LinkFlag.None;
  if (dst.y < from.pos.y && (from.up & LinkFlag.Wired) !== 0) {
    flags = flags | LinkFlag.Up;
  } else if (dst.y > from.pos.y && (from.down & LinkFlag.Wired) !== 0) {
    flags = flags | LinkFlag.Down;
  }
  if (dst.x < from.pos.x && (from.left & LinkFlag.Wired) !== 0) {
    flags = flags | LinkFlag.Left;
  } else if (dst.x > from.pos.x && (from.right & LinkFlag.Wired) !== 0) {
    flags = flags | LinkFlag.Right;
  }
  return flags;
}

// Build a routing table: for each node, the best next-hop toward the sink.
// §1.5 — Map<int16, RouteEntry>.
export function buildRoutingTable(grid: Node[][]): Map<int16_t, RouteEntry> {
  const table: Map<int16_t, RouteEntry> = new Map();
  const sink: Point = { x: GRID_W - 1, y: GRID_H - 1 };
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const node = gridAt(grid, x, y);
      if (node.kind === NodeKind.Sink) {
        continue;
      }
      const via = routeFor(node, sink);
      table.set(node.id, { to: node.id, via });
    }
  }
  return table;
}

// Advance one packet one hop along its route. §1.9 — destructure the entry.
export function forward(
  pkt: Packet,
  grid: Node[][],
  table: Map<int16_t, RouteEntry>,
): Packet {
  // Already delivered — no further forwarding.
  if (pkt.delivered) {
    return pkt;
  }
  // §1.10 — guard with .has() (the `!== undefined` on a struct-typed .get()
  // result is guarded by the no-undefined-compare-on-get lint rule).
  if (!table.has(pkt.cur)) {
    return pkt;
  }
  const entry = table.get(pkt.cur)!;
  // §1.9 — object destructuring of the RouteEntry.
  const { to, via } = entry;

  // Resolve the next-hop node id from `via` flags (an int16 bitmask).
  let nx: int16_t = (to % GRID_W);
  let ny: int16_t = (to / GRID_W);
  if ((via & LinkFlag.Up) !== 0) {
    ny = ny - 1;
  } else if ((via & LinkFlag.Down) !== 0) {
    ny = ny + 1;
  } else if ((via & LinkFlag.Left) !== 0) {
    nx = nx - 1;
  } else if ((via & LinkFlag.Right) !== 0) {
    nx = nx + 1;
  }

  const nextNode = gridAt(grid, nx, ny);
  const delivered = nextNode.kind === NodeKind.Sink;
  // §1.6 — return an updated packet struct. Advance `cur` to the next node so
  // the next hop looks up the route from the new position.
  return {
    src: pkt.src,
    cur: nextNode.id,
    dst: pkt.dst,
    hops: pkt.hops + 1,
    delivered,
  };
}
