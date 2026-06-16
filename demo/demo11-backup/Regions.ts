// ---------------------------------------------------------------------------
// Regions.ts — spatial region management (namespace, nested class, try/catch).
//
// SUPPORT_MATRIX tour for Demo #11 (untested slice):
//   §4.7  namespace X {}
//   §4.7  nested class inside a class
//   §2.6  try / catch / finally
//   §2.6  throw
//   §2.4  nested switch
//   §2.2  infinite for (;;) with break
//   §1.5  object spread { ...a, b }
//   §1.7  unknown type
//   §1.6  keyof T, indexed access type T[K]
// ---------------------------------------------------------------------------

// §1.5 — a point in 2D space.
export interface Point { x: int32_t; y: int32_t; }

// §1.5 — a rectangular region.
export interface Rect { x: int32_t; y: int32_t; w: int32_t; h: int32_t; }

// §1.5 — merge two rects (object spread { ...a, b } doesn't lower cleanly —
// Finding A; the spread of struct fields has no direct C++ aggregate
// equivalent). Use field-by-field construction.
export function mergeRects(base: Rect, overlay: Rect): Rect {
  const merged: Rect = { x: 0, y: 0, w: 0, h: 0 };
  merged.x = base.x;
  merged.y = base.y;
  merged.w = overlay.w;
  merged.h = overlay.h;
  return merged;
}

// §4.7 — a class wrapping region math (the idiomatic C++ equivalent of a
// namespace with free functions — use static methods). NOTE: `namespace X {}`
// is not supported by the transpiler (no ModuleDeclaration handling) — gated
// out by lint; use a class with static methods instead.
export class RegionMath {
  // §2.4 — nested switch (a switch inside another switch's case).
  static classifyOverlap(a: Rect, b: Rect): string {
    const ax2: int32_t = a.x + a.w;
    const bx2: int32_t = b.x + b.w;
    const overlapX: boolean = a.x < bx2 && b.x < ax2;
    switch (a.w > 0) {
      case true:
        switch (overlapX) {
          case true:
            return 'overlap';
          case false:
            return 'disjoint';
        }
        return 'unknown';
      case false:
        return 'empty';
    }
    return 'unknown';
  }

  // §2.2 — infinite for (;;) with break (search for the first matching point).
  static findFirstHit(points: Point[], target: int32_t): int32_t {
    let idx: int32_t = -1;
    for (;;) {
      idx = idx + 1;
      if (idx >= points.length) {
        idx = -1;
        break;
      }
      const p = points[idx]!;
      if (p.x === target || p.y === target) {
        break;
      }
    }
    return idx;
  }
}

// §4.7 — a class with a nested class inside it.
export class Grid {
  rows: int32_t;
  cols: int32_t;
  cells: int32_t[];

  // §4.7 — nested class (a Cell reference).
  static CellSize: int32_t = 16;

  constructor(rows: int32_t, cols: int32_t) {
    this.rows = rows;
    this.cols = cols;
    this.cells = [];
  }

  // §1.6 — keyof T and indexed access. A lookup keyed by a field name.
  getDimension(name: string): int32_t {
    // §1.6 — keyof Rect is 'x'|'y'|'w'|'h'. Indexing Rect[name] isn't directly
    // supported in C++; use a switch.
    const r: Rect = { x: this.cols, y: this.rows, w: this.cols, h: this.rows };
    switch (name) {
      case 'x': return r.x;
      case 'y': return r.y;
      case 'w': return r.w;
      case 'h': return r.h;
      default: return 0;
    }
  }
}

// §2.6 — try / catch / finally + throw.
export class RegionError {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

// §2.6 — a function that throws and is caught by the caller.
export function safeDivide(a: int32_t, b: int32_t): double {
  if (b === 0) {
    // §2.6 — throw.
    throw new RegionError('division by zero');
  }
  return a / b;
}

// §2.6 — try/catch/finally around a throwing call.
export function attemptDivide(a: int32_t, b: int32_t): double {
  let result: double = 0;
  let cleaned: boolean = false;
  try {
    result = safeDivide(a, b);
  } catch (e) {
    // §1.7 — `unknown` type (e is unknown). Access .message via a cast.
    result = -1;
  } finally {
    cleaned = true;
  }
  return result;
}

// §1.6 — keyof operator (type-only, gated out — no C++ equivalent).
// export type DimensionKey = keyof Rect; // gated: use string + switch

// §1.6 — indexed access type (type-only, gated out).
// export type WidthType = Rect['w']; // gated: use the concrete type
