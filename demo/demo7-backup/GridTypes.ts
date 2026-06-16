// ---------------------------------------------------------------------------
// GridTypes.ts — shared types, enums, and tunables for the Wattage grid sim.
//
// SUPPORT_MATRIX tour for Demo #7:
//   §1.7  const enum (Source) used as a discriminator and field
//   §1.6  interfaces → structs (Node, Edge, Snapshot, LoadProfile)
//   §1.6  type alias to a primitive (Watts) — now emits as `using`
//   §1.5  Map<K,V> → std::map<K,V>
//   §1.1  top-level const scalar tunables
// ---------------------------------------------------------------------------

// §1.7 — value-typed source-kind enum.
export const enum Source {
  Solar = 0,
  Wind = 1,
  Hydro = 2,
  Battery = 3,
  Grid = 4,
}

// §1.6 — a type alias to a primitive. The transpiler now emits this as a real
// C++ `using Watts = double;` (demo #7 fix E — the reachability pass keeps
// aliases whose underlying type is concrete).
export type Watts = double;

// §1.6 — a single node in the grid.
export interface Node {
  id: int32_t;
  name: string;
  source: Source;
  capacity: Watts;
  output: Watts;
  fault: boolean;
}

// §1.6 — a directed edge between two nodes.
export interface Edge {
  from: int32_t;
  to: int32_t;
  resistance: double;
  limit: Watts;
}

// §1.6 — a per-bus load profile captured each tick.
export interface LoadProfile {
  bus: int32_t;
  demand: Watts;
  served: Watts;
}

// §1.6 — end-of-run aggregate snapshot. Returned by value.
export interface Snapshot {
  ticksRun: int32_t;
  totalDemand: Watts;
  totalServed: Watts;
  faults: int32_t;
  balance: Watts;
}

// §1.1 — top-level const scalars. Emit cleanly as `extern const` + def.
export const TICKS_PER_RUN: int32_t = 48;
export const DEFAULT_TARIFF: double = 12.5;
export const FAULT_THRESHOLD: double = 0.9;
export const BATTERY_RESERVE: Watts = 250;

// §2.4 helper — convert a Source enum value to a display string.
export function sourceName(s: Source): string {
  switch (s) {
    case Source.Solar:
      return 'solar';
    case Source.Wind:
      return 'wind';
    case Source.Hydro:
      return 'hydro';
    case Source.Battery:
      return 'battery';
    case Source.Grid:
      return 'grid';
    default:
      return 'unknown';
  }
}
