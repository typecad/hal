// ---------------------------------------------------------------------------
// Topology.ts — builds the grid topology (nodes + edges + bus map).
//
// SUPPORT_MATRIX tour for Demo #7:
//   §3.1  factory function declarations
//   §1.5  array literal of object literals, push into a vector
//   §3.2  object-destructure parameter (buildEdge takes { from, to, ... })
//   §1.9  renamed object destructure ({ resistance: r }) in the body
//   §1.10 enum keys into a Map (now static_cast)
// ---------------------------------------------------------------------------

import { Node, Edge, Source } from './GridTypes';

// §3.2 — object-destructure parameter. Lowers to a synthetic __param struct
// (demo #7 fix H — the call site constructs the struct from the literal).
export function buildEdge({ from, to, resistance, limit }: Edge): Edge {
  return { from: from, to: to, resistance: resistance, limit: limit };
}

// §1.9 — renamed destructure inside the body: `{ resistance: r }`.
export function edgeLoss(resistance: double, flow: double): double {
  const spec: { resistance: double; flow: double } = { resistance: resistance, flow: flow };
  const { resistance: r } = spec;
  return r * flow * flow * 0.0001;
}

// §1.5 — array literal of object literals; push into a returned vector.
export function buildNodes(): Node[] {
  const nodes: Node[] = [];
  nodes.push({ id: 0, name: 'sun-1', source: Source.Solar, capacity: 800, output: 0, fault: false });
  nodes.push({ id: 1, name: 'wind-1', source: Source.Wind, capacity: 1200, output: 0, fault: false });
  nodes.push({ id: 2, name: 'dam-1', source: Source.Hydro, capacity: 1500, output: 0, fault: false });
  nodes.push({ id: 3, name: 'pack-1', source: Source.Battery, capacity: 500, output: 0, fault: false });
  nodes.push({ id: 4, name: 'tie-1', source: Source.Grid, capacity: 2000, output: 0, fault: false });
  nodes.push({ id: 5, name: 'load-town', source: Source.Grid, capacity: 0, output: 0, fault: false });
  nodes.push({ id: 6, name: 'load-mill', source: Source.Grid, capacity: 0, output: 0, fault: false });
  return nodes;
}

// Build the edge set. Each call passes an object literal into the destructure param.
export function buildEdges(): Edge[] {
  const edges: Edge[] = [];
  edges.push(buildEdge({ from: 0, to: 5, resistance: 0.10, limit: 700 }));
  edges.push(buildEdge({ from: 1, to: 5, resistance: 0.08, limit: 1000 }));
  edges.push(buildEdge({ from: 2, to: 5, resistance: 0.05, limit: 1400 }));
  edges.push(buildEdge({ from: 3, to: 5, resistance: 0.20, limit: 450 }));
  edges.push(buildEdge({ from: 4, to: 5, resistance: 0.02, limit: 1800 }));
  edges.push(buildEdge({ from: 5, to: 6, resistance: 0.12, limit: 900 }));
  return edges;
}

// §1.5 — Map<int32_t, Node> populated through .set.
export function buildBusMap(nodes: Node[]): Map<int32_t, Node> {
  const bus: Map<int32_t, Node> = new Map();
  for (const n of nodes) {
    bus.set(n.id, n);
  }
  return bus;
}

// §1.5 — Map<int32_t, double>. Per-source tariffs (enum keys now static_cast).
export function buildTariffs(): Map<int32_t, double> {
  const t: Map<int32_t, double> = new Map();
  t.set(Source.Solar, 8.0);
  t.set(Source.Wind, 9.5);
  t.set(Source.Hydro, 7.0);
  t.set(Source.Battery, 18.0);
  t.set(Source.Grid, 14.0);
  return t;
}
