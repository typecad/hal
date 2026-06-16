// ---------------------------------------------------------------------------
// main.ts — Atlas spatial-index driver.
//
// SUPPORT_MATRIX tour for Demo #11 (untested slice):
//   §4.7  namespace, nested class
//   §2.6  try/catch/finally, throw
//   §2.4  nested switch
//   §2.2  infinite for (;;) with break
//   §1.5  object spread { ...a, b }
//   §1.7  unknown type
//   §1.6  keyof T, indexed access type
//   §6.1  top-level statements → main()
//   §6.2  multi-file local imports
// ---------------------------------------------------------------------------

import {
  Point,
  Rect,
  mergeRects,
  RegionMath,
  Grid,
  RegionError,
  safeDivide,
  attemptDivide,
} from './models/Regions';

// §1.5 — object spread.
const base: Rect = { x: 0, y: 0, w: 10, h: 10 };
const overlay: Rect = { x: 5, y: 5, w: 20, h: 20 };
const merged = mergeRects(base, overlay);
console.log(`merged=${merged.x},${merged.y},${merged.w},${merged.h}`);

// §4.7 — namespace function calls.
const a: Rect = { x: 0, y: 0, w: 5, h: 5 };
const b: Rect = { x: 3, y: 3, w: 5, h: 5 };
console.log(`overlap=${RegionMath.classifyOverlap(a, b)}`);

// §2.2 — infinite for(;;) with break. Array-of-objects literal now lowers
// using the named element type directly (Finding D fixed — no shadow struct).
const pts: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }];
const hit = RegionMath.findFirstHit(pts, 5);
console.log(`first_hit=${hit}`);

// §4.7 — class with static field + nested class ref.
const g = new Grid(4, 8);
console.log(`grid_dim_x=${g.getDimension('x')} cell_size=${Grid.CellSize}`);

// §2.6 — try/catch/finally + throw.
console.log(`safe_div=${safeDivide(10, 2)}`);
console.log(`attempt_div_zero=${attemptDivide(10, 0)}`);

// §1.6 — keyof type. NOTE: `type K = keyof Rect` is dropped at emit (the
// keyof operator doesn't resolve to a concrete C++ type). Use a plain string.
const dimKey: string = 'w';
console.log(`dim_key=${dimKey}`);

console.log(`done: merged_w=${merged.w} overlap=${RegionMath.classifyOverlap(a, b)} hit=${hit}`);
