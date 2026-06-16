// ---------------------------------------------------------------------------
// Grid.ts — the orchestrator. Owns nodes/edges/bus map; runs the tick loop.
//
// SUPPORT_MATRIX tour for Demo #7:
//   §5.4  Object.keys / Object.values on a Map (incl. this.field member access)
//   §1.5  Map<int32_t, ...> round-trip
//   §1.4  nested template literal
//   §4.1  a small class with fields + methods
//
// NOTE: functional aggregations (reduce/some) live in module-level free
// functions, not in-class methods — in-class functional callbacks lose
// captured locals (Finding C), and inlined method bodies can't see later-
// declared free functions (forward-decl ordering). The class holds state and
// exposes simple accessors; runGrid drives the loop.
// ---------------------------------------------------------------------------

import {
  Node,
  Snapshot,
  LoadProfile,
  TICKS_PER_RUN,
} from './GridTypes';
import {
  onlineGenerators,
  totalCapacity,
  availabilityFactor,
  forEachChecksum,
} from './Analytics';

export class Grid {
  nodes: Node[];
  bus: Map<int32_t, Node>;
  tariffs: Map<int32_t, double>;
  profiles: LoadProfile[];

  constructor(nodes: Node[], bus: Map<int32_t, Node>, tariffs: Map<int32_t, double>) {
    this.nodes = nodes;
    this.bus = bus;
    this.tariffs = tariffs;
    this.profiles = [];
  }

  // §5.4 — Object.keys/values on a map-typed field (this.bus). The cast is
  // TS-only (Object.keys is typed string[]); the transpiler's __tc_mapKeys
  // returns the key-type vector, matching the int32_t[] annotation.
  busIds(): int32_t[] {
    return Object.keys(this.bus) as unknown as int32_t[];
  }
  tariffValues(): double[] {
    return Object.values(this.tariffs) as unknown as double[];
  }

  // §1.4 — nested template literal.
  banner(): string {
    const inner = `cap=${totalCapacity(this.nodes)}`;
    return `grid[${inner}] nodes=${this.nodes.length}`;
  }
}

// §5.3 — filter + reduce for served demand (free function so the callback
// carries a real signature and captures work).
export function tickServed(nodes: Node[]): double {
  const gens = onlineGenerators(nodes);
  return gens.reduce((s: double, n: Node) => s + n.output, 0);
}

// Run one tick (free function — mutates grid in place).
export function gridTick(grid: Grid, t: int32_t): void {
  const next: Node[] = [];
  for (let i = 0; i < grid.nodes.length; i++) {
    const cur = grid.nodes[i]!;
    let out: double = 0;
    if (!cur.fault) {
      const avail = availabilityFactor(cur.capacity);
      out = avail > cur.capacity ? cur.capacity : avail;
    }
    next.push({
      id: cur.id,
      name: cur.name,
      source: cur.source,
      capacity: cur.capacity,
      output: out,
      fault: cur.fault,
    });
  }
  grid.nodes = next;
  const served = tickServed(grid.nodes);
  const demand = served * 0.9;
  grid.profiles.push({ bus: 5, demand: demand, served: served });
}

// Aggregate the run via reduce. Uses a named-local return. NOTE: bind the
// receivers to locals first — `grid.profiles.reduce(...)` isn't rewritten to
// __tc_reduce because the regex only matches single-identifier receivers.
export function gridSummarize(grid: Grid): Snapshot {
  const profiles = grid.profiles;
  const nodes = grid.nodes;
  const totalDemand = profiles.reduce((s: double, p: LoadProfile) => s + p.demand, 0);
  const totalServed = profiles.reduce((s: double, p: LoadProfile) => s + p.served, 0);
  const faults = nodes.some((n: Node) => n.fault) ? 1 : 0;
  const balance = totalServed - totalDemand;
  let out: Snapshot = {
    ticksRun: 0,
    totalDemand: 0,
    totalServed: 0,
    faults: 0,
    balance: 0,
  };
  out.ticksRun = grid.profiles.length;
  out.totalDemand = totalDemand;
  out.totalServed = totalServed;
  out.faults = faults;
  out.balance = balance;
  return out;
}

// §3.1 — drives the full run and returns the Snapshot.
export function runGrid(grid: Grid): Snapshot {
  for (let t = 0; t < TICKS_PER_RUN; t++) {
    gridTick(grid, t);
  }
  return gridSummarize(grid);
}

// §5.3 — checksum over outputs via Math.floor (forEach not lowered on
// vectors — manual loop).
export function outputChecksum(grid: Grid): int32_t {
  const outs: double[] = [];
  for (const n of grid.nodes) {
    outs.push(n.output);
  }
  return forEachChecksum(outs);
}

// §5.4 — manual accumulation over the bus map's nodes (uses totalCapacity
// on the values; Object.values-with-cast into a local has a type-inference
// gap, so reuse the existing node vector).
export function totalBusCapacity(grid: Grid): double {
  return totalCapacity(grid.nodes);
}
