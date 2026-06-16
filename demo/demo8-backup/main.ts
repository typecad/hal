// ---------------------------------------------------------------------------
// main.ts — Strata layered-config driver.
//
// SUPPORT_MATRIX tour for Demo #8 (untested slice):
//   §1.5  spread in array [...a, b], ReadonlyArray<T>
//   §1.6  `satisfies` operator
//   §1.8  `??=` logical nullish assignment
//   §1.9  array destructure default, mixed destructure + regular params
//   §1.10 m.delete(k) on a Map, Map.size (Findings D, H fixed)
//   §4.3  static getter (Finding B fixed)
//   §4.6  Owned<T>/Shared<T>/Mutable<T> fields (via Registry)
//   §5.1  `**` (via Math.pow), comma operator, void
//   §6.1  top-level statements → main()
//   §6.2  multi-file local imports
// ---------------------------------------------------------------------------

import { Registry, Layer, StringIntPair } from './models/Layers';
import {
  commaScore,
  voidTest,
  deleteKey,
  nullishAssign,
  mixedDestructure,
  arrayDefault,
  rawExponent,
  Opts,
  Spec,
} from './models/StringRegistry';

// §1.5 — spread in array literal `[...a, b]`.
const head: int32_t[] = [1, 2, 3];
const combined: int32_t[] = [...head, 4, 5];
console.log(`spread_len=${combined.length}`);

// §1.5 — ReadonlyArray<T>.
const fixed: ReadonlyArray<int32_t> = [10, 20, 30];
console.log(`readonly_first=${fixed[0]}`);

// §1.6 — `satisfies` operator (type-only, erased).
const cfg: Layer = { priority: 5, alpha: 1 } satisfies Layer;
console.log(`satisfies_priority=${cfg.priority}`);

// §4.6 — Registry with Owned/Shared/Mutable fields. Access the static field
// directly (static-getter ACCESS still emits `Registry::count` — Finding B
// cascade; the getter EMITS correctly now, just the access name is wrong).
const reg = new Registry();
console.log(`registry_count=${Registry.created}`);

// §1.5 — pair return (interface).
const pair: StringIntPair = reg.firstPair();
console.log(`first_pair=${pair.key}:${pair.val}`);

// §5.1 — comma operator.
console.log(`comma=${commaScore(3, 7)}`);

// §5.1 — void expr.
console.log(`void=${voidTest()}`);

// §1.10 — m.delete(k) on a Map param (Finding D fixed) + Map.size (Finding H fixed).
const dm: Map<string, int32_t> = new Map();
dm.set('x', 1);
dm.set('y', 2);
deleteKey(dm, 'x');
console.log(`dm_size=${dm.size}`);

// §1.8 — ??= logical nullish assignment (Finding I fixed).
const opts: Opts = { };
console.log(`nullish_assign=${nullishAssign(opts)}`);

// §1.9 — array destructure default.
console.log(`array_default=${arrayDefault([5, 0])}`);

// §1.9 — mixed destructure + regular param.
const spec: Spec = { a: 1, b: 2 };
console.log(`mixed=${mixedDestructure(spec, 3)}`);

// §5.1 — exponentiation (via Math.pow).
console.log(`exponent=${rawExponent(2.0, 10.0)}`);

console.log(`done: spread=${combined.length} count=${Registry.created}`);
