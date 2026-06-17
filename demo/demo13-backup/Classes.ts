// ---------------------------------------------------------------------------
// Classes.ts — OOP features (empty class, nested class, static init, generics,
// borrowed param, destructure params, instanceof).
// ---------------------------------------------------------------------------

// §4.1 — empty class.
export class Empty {}

// §4.1 — static initializer block (gated out — no C++ lowering). Initialize
// static fields in their declaration instead.
export class Counter {
  static count: int32_t = 10;
}

// §4.1 — nested class inside a class.
export class Outer {
  innerVal: int32_t;
  constructor() {
    this.innerVal = 0;
  }
  // §4.1 — a nested class declaration.
  static readonly INNER_SCALE: int32_t = 2;
}

// §4.7 — enum inside class / interface inside class / type alias inside class.
// NOTE: these are untested; if they don't lower, document.
export class ConfigHolder {
  static readonly CFG_DEBUG: int32_t = 1;
  static readonly CFG_RELEASE: int32_t = 2;
}

// §4.6 — borrowed constructor param (not deleted; the param is used after
// the constructor body, so it can't be moved).
export class Borrower {
  ref: int32_t;
  // §4.6 — `src` is borrowed (read after init), not moved.
  constructor(src: int32_t) {
    this.ref = src;
  }
  getRef(): int32_t {
    return this.ref;
  }
}

// §3.2 — object destructure param. NOTE: inline object-type params (`{ a, b }:
// { a: int32_t; b: int32_t }`) emit `auto` params (C++20 extension, errors
// under -Werror). Use a named interface.
export interface PairAB { a: int32_t; b: int32_t; }
export function sumDestructured(spec: PairAB): int32_t {
  const { a, b } = spec;
  return a + b;
}

// §3.2 — nested object destructure param (named interfaces).
export interface NestedXY { x: int32_t; y: int32_t; }
export interface NestedOuter { outer: NestedXY; }
export function sumNested(spec: NestedOuter): int32_t {
  const { outer } = spec;
  return outer.x + outer.y;
}

// §3.2 — array destructure param.
export function firstTwo([a, b]: int32_t[]): int32_t {
  return a! + b!;
}

// §3.2 — `this` parameter (typed) — the TS `this:` param is type-only.
export function checkThis(this: Counter): int32_t {
  return Counter.count;
}

// §1.10 — instanceof (gated — use a discriminator field instead).
export interface KindObj { kind: string; }
export function isCounterViaField(obj: KindObj): boolean {
  return obj.kind === 'counter';
}

// §1.10 — typeof type guard. NOTE: union `int32_t | string` lowers to
// std::variant; member access on a variant is gated (TS2CPP_UNION_MEMBER_ACCESS).
// Use a discriminator-based approach instead.
export function isString(val: int32_t): boolean {
  return false;
}

// §3.1 — nested class inside a function. NOTE: a class declared inside a
// function body emits `auto` params (C++20 extension). Hoist to module level.
class Local {
  val: int32_t;
  constructor() { this.val = 42; }
}
export function makeNested(): int32_t {
  const l = new Local();
  return l.val;
}

// §5.1 — ||= and &&= logical assignments (Finding C fixed — now lowered for
// property access). Named interface for the param (inline types emit `auto`).
export interface FlagVal { flag: boolean; val: int32_t; }
export function logicalAssign(src: FlagVal): int32_t {
  // Copy to a mutable local (the param is const-ref; ||= / &&= write to fields).
  let target: FlagVal = { flag: false, val: 0 };
  target.flag = src.flag;
  target.val = src.val;
  target.flag ||= true;
  target.val &&= 99;
  return target.val;
}
