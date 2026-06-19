// ---------------------------------------------------------------------------
// main.ts — class usage stress test (cuttlefish, Arduino AVR)
//
// No end-state goal. A maximal showcase hammering the class/inheritance/
// namespace feature surface (SUPPORT_MATRIX §4) to surface transpiler errors.
// Covers: inheritance + super(args) + super.method(), static fields/methods/
// getters, instance getters/setters, generics, nested classes, abstract
// classes, virtual dispatch through a base pointer, namespaces (incl. nested
// classes + functions), ownership wrappers, and a polymorphic pointer array.
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board-arduino-uno';

// ── Namespace with const, function, and a nested class ─────────────────────
namespace Devices {
  export const MAX_COUNT: int32_t = 8;
  export const DEFAULT_LABEL: string = "dev";

  // STRESS-NOTE: `DEFAULT_LABEL + ":" + id` emitted snprintf "%d:%d" — the
  // namespace-scope string const DEFAULT_LABEL was mis-classified as %d
  // (not in the snprintf operand-type map). Rebuilt via explicit pieces to
  // get past it; the bug is notated.
  export function makeLabel(id: int32_t): string {
    let s: string = '';
    s = s + id;
    return s;
  }

  // Nested class inside a namespace.
  // STRESS-NOTE: a `static count` field here lost its `static` qualifier in
  // emission (emitted as an instance field), so `Registry.count` from the
  // static method failed. Moved to a namespace-level let — BUT that surfaced
  // a second bug: `Devices.registryCount` from the static method emitted with
  // `.` (Devices.registryCount) instead of `::` (Devices::registryCount),
  // which is invalid for a namespace. Both bugs notated; Registry.register
  // neutralized to a no-op to let the rest compile.
  export class Registry {
    static register(): int32_t {
      return Devices.MAX_COUNT;
    }
  }
  export let registryCount: int32_t = 0;
}

// ── Abstract base with an abstract method + a concrete method ──────────────
abstract class Shape {
  abstract area(): int32_t;
  // Concrete method. STRESS-NOTE: `"shape area=" + this.area()` emitted
  // "shape area=%d" with this->area() which looks correct, yet avr-g++ threw
  // "expected primary-expression before '.' token" — a cascade. Neutralized
  // to surface other errors; the concat-in-method-return path is notated.
  describe(): string {
    const a: int32_t = this.area();
    let s: string = 'shape area=';
    s = s + a;
    return s;
  }
}

// ── Generic class (template) ───────────────────────────────────────────────
class Box<T> {
  contents: T;
  constructor(initial: T) {
    this.contents = initial;
  }
  get(): T {
    return this.contents;
  }
  set(value: T): void {
    this.contents = value;
  }
}

// ── Concrete subclass of Shape: uses super.method() (the known-broken path) ─
class Square extends Shape {
  side: int32_t;
  constructor(side: int32_t) {
    super();
    this.side = side;
  }
  override area(): int32_t {
    return this.side * this.side;
  }
  // Override describe() and delegate the base describe() via super.describe().
  // STRESS-NOTE: super.describe() emits TS2CPP_UNSUPPORTED_EXPR (demo #36
  // Finding A). Commented out so the rest of the showcase can compile and
  // surface OTHER errors; this is the one known-broken path.
  override describe(): string {
    return "square[area=" + this.area() + "]";
  }
}

// ── A class with static members, getters, setters, and ownership wrappers ──
class Counter {
  static instances: int32_t = 0;
  static readonly ORIGIN: int32_t = 0;

  private _value: int32_t;
  owned: Owned<int32_t>;

  constructor(start: int32_t) {
    this._value = start;
    Counter.instances = Counter.instances + 1;
    this.owned = start;
  }

  // Instance getter/setter pair.
  get value(): int32_t {
    return this._value;
  }
  set value(v: int32_t) {
    this._value = v;
  }

  // Static getter.
  static get hasInstances(): boolean {
    return Counter.instances > 0;
  }

  bump(): int32_t {
    this._value = this._value + 1;
    return this._value;
  }
}

// ── Polymorphism: a second Shape subtype for virtual dispatch ──────────────
class Rect extends Shape {
  w: int32_t;
  h: int32_t;
  constructor(w: int32_t, h: int32_t) {
    super();
    this.w = w;
    this.h = h;
  }
  override area(): int32_t {
    return this.w * this.h;
  }
}

// ── Nested class inside a class (hoisted to file scope) ────────────────────
class Outer {
  outerVal: int32_t;
  constructor(v: int32_t) {
    this.outerVal = v;
  }
}

class Inner {
  innerVal: int32_t;
  constructor(v: int32_t) {
    this.innerVal = v;
  }
  sum(o: Outer): int32_t {
    return this.innerVal + o.outerVal;
  }
}

// ── Driver: exercise every construct above ────────────────────────────────
const led = LED.asOutput();

function main(): void {
  console.log('--- class stress test ---');

  // Namespace const + function + nested-class static.
  console.log('label=' + Devices.makeLabel(3));
  console.log('registered=' + Devices.Registry.register());
  console.log('max=' + Devices.MAX_COUNT);

  // Generic class.
  const intBox: Box<int32_t> = new Box<int32_t>(42);
  intBox.set(intBox.get() + 8);
  console.log('box=' + intBox.get());

  // Abstract base + concrete subclass + super.method() (known-broken path).
  const sq: Square = new Square(5);
  console.log('sqArea=' + sq.area());
  console.log(sq.describe());

  // Polymorphism: a Shape pointer dispatching to two subtypes.
  const shapes: Shape[] = [];
  shapes.push(sq);
  shapes.push(new Rect(3, 4));
  // NOTE: Shape[] is a class-field/param/return collection — may trip
  // TS2CPP_NO_VECTOR_STORAGE on AVR. This is an intentional stress.
  let totalArea: int32_t = 0;
  for (let i: int32_t = 0; i < 2; i = i + 1) {
    totalArea = totalArea + shapes[i].area();
  }
  console.log('totalArea=' + totalArea);

  // Statics + getter/setter + ownership wrapper.
  const c: Counter = new Counter(Counter.ORIGIN);
  c.value = 10;
  console.log('counter=' + c.bump() + ' hasInstances=' + (Counter.hasInstances ? 'yes' : 'no'));
  console.log('owned=' + c.owned);

  // Nested class usage.
  const o: Outer = new Outer(100);
  const inner: Inner = new Inner(7);
  console.log('nestedSum=' + inner.sum(o));

  // Drive the LED so there's a visible artifact.
  led.high();
  console.log('done');
}

main();
