// ---------------------------------------------------------------------------
// Helper-parity invariant — every helper name the IR lowering tables can emit
// must have a DEFINITION in each shipped target's runtime text.
//
// This is the global form of the round-1 vector-callback gap (the IR emitted
// `__tc_sort_fn(...)` while Zephyr's polyfill set had no definition and the
// decline gate rejected it) and of the six link-error gaps the first triage
// run of this test surfaced (bare __tc_sort, concat/fill/splice, the
// Object.keys/Map+Set helper family, __tc_random, the JSON helpers — all
// emitted with no Zephyr definition; __tc_startsWith with no native one).
//
// Mechanism: extract every `__tc_*` token from the table/registry files whose
// rows become call sites, then require the name (as a call or definition) in
// each target's definition text. Names that are conditionally emitted behind
// their own include gate, or that are types/prefixes rather than helpers, sit
// in the allowlist with a reason.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const cfSrc = path.join(ROOT, "packages/cuttlefish/src");
const zfSrc = path.join(ROOT, "packages/framework-zephyr/src");
const read = (p: string): string => fs.readFileSync(p, "utf8");

// The lowering tables whose rows become emitted call sites.
const TABLE_FILES = [
  "api/shared/polyfill-helper-registry.ts",
  "api/shared/string-method-registry.ts",
  "ir/transformers/array-methods.ts",
  "ir/expression-to-ir.ts",
  "ir/hal/hal-emitter.ts",
  "emit/utils/async-state-machine.ts",
];

// Per-target definition text (polyfills, shims, runtime generators).
const ZEPHYR_DEF_FILES = [
  "packages/framework-zephyr/src/strategy.ts",
  "packages/framework-zephyr/src/lowering/random.ts",
  "packages/cuttlefish/src/api/shared/async-runtime-static.ts",
];
const NATIVE_DEF_FILES = [
  "packages/cuttlefish/src/frameworks/native/hosted-shim.ts",
  "packages/cuttlefish/src/frameworks/native/strategy.ts",
  "packages/cuttlefish/src/api/shared/async-runtime-static.ts",
];

// Names exempt from the both-targets requirement, with reasons.
const ALLOWLIST: Record<string, string> = {
  __tc_StaticArray: "type/class; native uses std::vector by design",
  __tc_str_ptr: "type; AVR/Arduino normalization target only",
  __tc_safety: "safety-hook polyfills ship in @typecad/safety, include-gated",
  __tc_safety_: "prefix of the safety-hook family (see above)",
  __tc_safety_read_safe: "safety-hook polyfill (include-gated)",
  __tc_safety_record_pin_mode: "safety-hook polyfill (include-gated)",
  __tc_safety_write_verify: "safety-hook polyfill (include-gated)",
  __tc_async_start_: "generated prefix: __tc_async_start_<fn> per async fn",
  __tc_anonClass: "test/doc artifact, not an emission",
  __tc_fn6__Builder: "test/doc artifact, not an emission",
  __tc_i: "generated loop-variable prefix in lowered code",
  __tc_name: "doc-comment artifact",
  __tc_nameN: "doc-comment artifact",
  __tc_name_default: "doc-comment artifact",
};

describe("helper-parity invariant (table emissions ⇔ per-target definitions)", () => {
  it("every table-owned __tc_* helper is defined on Zephyr and native", () => {
    const emitText = TABLE_FILES.map(f => read(path.join(cfSrc, f))).join("\n");
    const names = new Set<string>();
    for (const m of emitText.matchAll(/__tc_[a-zA-Z0-9_]+/g)) {
      names.add(m[0]);
    }

    const zephyrText = ZEPHYR_DEF_FILES.map(f => read(path.join(ROOT, f))).join("\n");
    const nativeText = NATIVE_DEF_FILES.map(f => read(path.join(ROOT, f))).join("\n");
    const defined = (text: string, n: string): boolean =>
      text.includes(n + "(") || new RegExp(n.replace(/[$]/g, "\\$") + "\\s*\\(").test(text);

    const missingZ: string[] = [];
    const missingN: string[] = [];
    for (const n of [...names].sort()) {
      if (ALLOWLIST[n] !== undefined) continue;
      // Prefix entries in the allowlist (trailing underscore) match by prefix.
      if (n.endsWith("_") && Object.keys(ALLOWLIST).some(k => k.endsWith("_") && n.startsWith(k))) continue;
      if (!defined(zephyrText, n)) missingZ.push(n);
      if (!defined(nativeText, n)) missingN.push(n);
    }

    expect(missingZ).toEqual([]);
    expect(missingN).toEqual([]);
  });

  it("the allowlist stays minimal — every entry still matches an emitted name", () => {
    // Guards the allowlist against rotting into a second unowned list.
    const emitText = TABLE_FILES.map(f => read(path.join(cfSrc, f))).join("\n");
    const names = new Set<string>();
    for (const m of emitText.matchAll(/__tc_[a-zA-Z0-9_]+/g)) {
      names.add(m[0]);
    }
    for (const [entry] of Object.entries(ALLOWLIST)) {
      const matches = entry.endsWith("_")
        ? [...names].some(n => n.startsWith(entry))
        : names.has(entry);
      expect(matches).toBe(true);
    }
  });
});
