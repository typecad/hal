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
