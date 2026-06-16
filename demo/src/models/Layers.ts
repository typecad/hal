// ---------------------------------------------------------------------------
// Layers.ts — layered-config registry types + the Registry class.
//
// SUPPORT_MATRIX tour for Demo #8 (untested slice):
//   §4.6 ownership wrappers: Owned<T>, Shared<T>, Mutable<T> fields
//   §1.5  ReadonlyArray<T>, spread in array [...a, b], [T] tuple type
//   §1.6  interface with index signature (pure), `satisfies` operator
//   §4.3  static getter/setter (now fixed — Finding B)
// ---------------------------------------------------------------------------

// §1.5 — a tuple type alias [K, V] (now emitted as `using` — Finding F fix).
// NOTE: tuple LITERALS (`const t: Tuple = ['a', 1]`) lower to an array, not a
// std::tuple constructor (a deeper gap); return an interface for the value.
export type StringIntTuple = [string, int32_t];

// §1.5 — ReadonlyArray<T>.
export type ReadOnlyInts = ReadonlyArray<int32_t>;

// §1.6 — a config layer: a plain struct interface (fixed-shape).
export interface Layer {
  priority: int32_t;
  alpha: int32_t;
}

// §1.5 — a pair returned as an interface (tuple literals don't construct).
export interface StringIntPair {
  key: string;
  val: int32_t;
}

// §4.6 — ownership-wrapper field declarations.
export class Registry {
  entries: Map<string, int32_t>;
  owned: Owned<int32_t>;
  shared: Shared<double>;
  mut: Mutable<int32_t>;
  static created: int32_t = 0;

  // §4.3 — static getter/setter (Finding B fixed — no cv-qualifier).
  // NOTE: ACCESSING a static getter (`Registry.count`) still emits
  // `Registry::count` instead of `Registry::getCount()` — use the static
  // field `Registry.created` directly until the access path is fixed.
  static get count(): int32_t {
    return Registry.created;
  }
  static set count(n: int32_t) {
    Registry.created = n;
  }

  constructor() {
    this.entries = new Map();
    this.owned = 0;
    this.shared = 0;
    this.mut = 0;
    Registry.created = Registry.created + 1;
  }

  // §1.5 — return a pair (interface, not a tuple literal).
  firstPair(): StringIntPair {
    const out: StringIntPair = { key: 'first', val: 1 };
    return out;
  }
}
