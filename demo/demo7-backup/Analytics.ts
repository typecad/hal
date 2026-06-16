// ---------------------------------------------------------------------------
// Analytics.ts — functional array-method coverage (the heart of demo #7).
//
// SUPPORT_MATRIX tour for Demo #7:
//   §5.3  map / filter / reduce / find / some / every / forEach
//   §5.3  includes / slice / join / sort
//   §5.2  Math.min / Math.max / Math.random / Math.PI / Math.floor
//   §1.8  optional chaining a?.b and optional call a?.()
//   §1.9  array destructure + rest ([head, ...rest], [a, b] = arr)
//   §1.9  default-value destructure ({ factor = 1 })
//   §2.1  nested ternary
//   §3.2  array-destructure parameter
//   §1.10 `in` operator on a map
//   §3.4  named function expression
//
// (The transpiler fixes from demo #7's report make these lower cleanly.)
// ---------------------------------------------------------------------------

import { Node, Source, LoadProfile } from './GridTypes';

// §5.3 — `.map` over a node array produces a capacity vector.
export function capacities(nodes: Node[]): double[] {
  return nodes.map((n: Node) => n.capacity);
}

// §5.3 — `.filter`. Select non-fault generators with capacity.
export function onlineGenerators(nodes: Node[]): Node[] {
  return nodes.filter((n: Node) => !n.fault && n.capacity > 0);
}

// §5.3 — `.reduce` with an explicit numeric initial value.
export function totalCapacity(nodes: Node[]): double {
  return nodes.reduce((sum: double, n: Node) => sum + n.capacity, 0);
}

// §5.3 — `.find` returns the first matching node. §1.8 — optional chaining.
export function firstOnline(nodes: Node[], s: Source): int32_t {
  const found = nodes.find((n: Node) => n.source === s && !n.fault);
  return found?.id ?? -1;
}

// §5.3 — `.some` / `.every` boolean queries.
export function anyFaulted(nodes: Node[]): boolean {
  return nodes.some((n: Node) => n.fault);
}
export function allServed(profiles: LoadProfile[]): boolean {
  return profiles.every((p: LoadProfile) => p.served >= p.demand);
}

// §5.3 — `.includes` on a numeric vector.
export function hasSource(kinds: Source[], target: Source): boolean {
  return kinds.includes(target);
}

// §5.3 — `.slice` and `.join` on a string vector.
export function summarizeNames(nodes: Node[], sep: string): string {
  const names: string[] = [];
  for (let i = 0; i < nodes.length && i < 3; i++) {
    names.push(nodes[i]!.name);
  }
  return names.join(sep);
}

// §5.3 — `.sort` with a comparator callback. NOTE: `.slice(0, n)` on a Node[]
// currently resolves to the string __tc_slice2 polyfill (a polyfill include-
// guard collision drops the vector overload). Copy via a manual loop instead.
export function rankByCapacity(nodes: Node[]): Node[] {
  const copy: Node[] = [];
  for (const n of nodes) {
    copy.push(n);
  }
  copy.sort((a: Node, b: Node) => (b.capacity > a.capacity ? 1 : b.capacity < a.capacity ? -1 : 0));
  return copy;
}

// §5.3 — `.forEach` is not yet lowered on std::vector (the NativeStrategy
// normalizeRawExpression rewrites .map/.filter/.reduce but not .forEach).
// Use a manual for loop with Math.floor.
export function forEachChecksum(outputs: double[]): int32_t {
  let checksum: int32_t = 0;
  for (const w of outputs) {
    checksum += Math.floor(w);
  }
  return checksum;
}

// §1.9 — array destructure with rest. Split head from the rest. Uses `let`
// for the returned struct (const-local struct field mutation isn't always
// demoted in nested function scopes).
export interface HeadSplit { head: double; rest: double[]; }
export function splitHead(values: double[]): HeadSplit {
  const [head, ...rest] = values;
  let out: HeadSplit = { head: 0, rest: [] };
  out.head = head!;
  out.rest = rest;
  return out;
}

// §1.9 — array destructure of the first two elements of a mapped vector.
export interface Pair { a: double; b: double; }
export function topTwoCapacities(nodes: Node[]): Pair {
  const ranked = rankByCapacity(nodes);
  const caps = ranked.map((n: Node) => n.capacity);
  const [first, second] = caps;
  let out: Pair = { a: 0, b: 0 };
  out.a = first!;
  out.b = second!;
  return out;
}

// §3.2 — array-destructure parameter. NOTE: a tuple-typed param lowers to
// std::tuple, and `[a, b] = tuple` emits `tuple[0]` (std::tuple has no
// operator[]). Use two separate params instead. §2.1 nested ternary in body.
export function pairDelta(a: double, b: double): double {
  const delta = a > b ? a - b : b - a;
  const label = delta > 100 ? 'large' : delta > 10 ? 'small' : 'negligible';
  return delta + (label === 'large' ? 1 : label === 'small' ? 0.5 : 0.1);
}

// §1.9 — default-value object destructure. `{ factor = 1 }`. A named interface
// for the opts avoids the shadow-struct collision when the same literal shape
// appears at multiple call sites.
export interface ScaleOpts { factor?: double; }
export function scaleDemand(demand: double, opts: ScaleOpts): double {
  const { factor = 1 } = opts;
  return demand * factor;
}

// §1.8 — optional call `fn?.()`. A possibly-absent callback.
export function maybeReport(report: (() => string) | null): string {
  return report?.() ?? '(no report)';
}

// §1.10 — `in` operator on a map. NOTE: `s in tariffs` with an enum operand
// lowers to tariffs.count(enum) without a cast (the cast is only applied on
// .set currently). Bind to a typed local so the operand is integral.
export function knowsTariff(tariffs: Map<int32_t, double>, s: Source): boolean {
  const key: int32_t = s;
  return key in tariffs;
}

// §3.4 — named function expression assigned to a const.
export const lossLabel = function (loss: double): string {
  // §2.1 nested ternary.
  return loss > 50 ? 'high' : loss > 10 ? 'medium' : 'low';
};

// §5.2 — Math.PI in a real computation (lowers to a literal now).
export const CIRCLE_AREA: double = Math.PI * 10.0 * 10.0;

// §5.2 — Math.random to simulate a per-tick availability factor.
export function availabilityFactor(capacity: double): double {
  const r = Math.random();
  return capacity * r;
}

// §5.2 — min/max across a vector via reduce. Returns via a named local.
export interface CapRange { lo: double; hi: double; }
export function capacityRange(nodes: Node[]): CapRange {
  const caps = capacities(nodes);
  const lo = caps.reduce((m: double, w: double) => (w < m ? w : m), 1e9);
  const hi = caps.reduce((m: double, w: double) => (w > m ? w : m), 0);
  let out: CapRange = { lo: 0, hi: 0 };
  out.lo = lo;
  out.hi = hi;
  return out;
}
