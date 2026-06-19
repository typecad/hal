import { describe, it, expect } from "vitest";
import { transpileArduino } from "../../setup";

// ── Fix 1: a static field on a class nested in a namespace keeps `static` ──
// Today the namespace-emitter's field render omits the `static` prefix (its
// method render applies one), so `static count` emits as an instance field
// and a static method's `Registry.count` access fails.
describe("namespace: static field on a namespace-nested class", () => {
  it("emits `static inline` for a static field (matches top-level classes)", () => {
    const src = `
namespace Devices {
  export class Registry {
    static count: int32_t = 0;
    static bump(): int32_t {
      Devices.Registry.count = Devices.Registry.count + 1;
      return Devices.Registry.count;
    }
  }
}
console.log('' + Devices.Registry.bump());
`;
    const res = transpileArduino(src);
    // The field must render as static (the top-level form is `static inline`).
    expect(res.cpp).toMatch(/static\s+(inline\s+)?int32_t\s+count/);
    // It must NOT render as a non-static instance field inside the class body.
    expect(res.cpp).not.toMatch(/^\s+int32_t\s+count\s*=\s*0;/m);
  });
});

// ── Fix 2: namespace member access on an assignment target uses :: ─────────
// `Devices.x = ...` must emit `Devices::x = ...`. A namespace is not an
// object, so `.` is a parse error. The property-READ path already does this
// (expression-renderer uses namespaceNames); the assign-TARGET path did not.
describe("namespace: member access on assignment target uses ::", () => {
  it("emits Devices::x on assignment (not Devices.x)", () => {
    const src = `
namespace Devices {
  export let total: int32_t = 0;
  export function add(n: int32_t): void {
    Devices.total = Devices.total + n;
  }
}
Devices.add(5);
console.log('' + (Devices.total as int32_t));
`;
    const res = transpileArduino(src);
    // Every Devices member access — including the assignment TARGET — must
    // use ::, never a bare `Devices.`.
    expect(res.cpp).not.toMatch(/Devices\./);
    expect(res.cpp).toMatch(/Devices::total/);
  });
});

// ── Fix 3: namespace const in a string concat formats with the right spec ─
// A namespace-scope `const string` used in a concat must be `%s` (with
// .c_str()), not the `%d` default. Today namespace consts aren't in the
// knownVariableTypes map the snprintf operand resolver consults.
describe("namespace: const in concat uses correct snprintf specifier", () => {
  it("formats a namespace const string as %s (not %d)", () => {
    const src = `
namespace Devices {
  export const LABEL: string = "dev";
  export function tag(id: int32_t): string {
    return Devices.LABEL + ":" + id;
  }
}
console.log(Devices.tag(3));
`;
    const res = transpileArduino(src);
    // The LABEL operand must drive a %s slot (string), not %d. The snprintf
    // format for `LABEL + ":" + id` must contain %s and LABEL.c_str().
    expect(res.cpp).toMatch(/%s.*%d|%d.*%s/);
    expect(res.cpp).toMatch(/LABEL\.c_str\(\)/);
    // Must NOT pass LABEL straight to a %d slot.
    expect(res.cpp).not.toMatch(/"%d:%d",\s*Devices::LABEL/);
  });
});

// ── Fix 4: multi-level namespace→class static access uses :: at every level ─
// `Devices.Registry.count` (namespace → class static → field) must render
// `Devices::Registry::count`. Today the inner `Registry.count` access has a
// non-identifier object (a nested property-access), so the namespace/static
// branch is skipped and it emits `Devices::Registry.count` (mixed), failing
// at g++ time.
describe("namespace: multi-level Ns.Class.staticMember uses :: throughout", () => {
  it("renders Devices::Registry::count on reads and assigns", () => {
    const src = `
namespace Devices {
  export class Registry {
    static count: int32_t = 0;
    static bump(): int32_t {
      Devices.Registry.count = Devices.Registry.count + 1;
      return Devices.Registry.count;
    }
  }
}
console.log('' + Devices.Registry.bump());
`;
    const res = transpileArduino(src);
    // Every Devices.Registry.count access (read AND assign target) must use
    // :: at both levels — never a bare `Registry.count`.
    expect(res.cpp).toMatch(/Devices::Registry::count/);
    expect(res.cpp).not.toMatch(/Registry\.count/);
  });
});
