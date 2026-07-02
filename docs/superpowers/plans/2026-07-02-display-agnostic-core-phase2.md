# Display-Agnostic Core — Phase 2: Capability Descriptor + CSS Media Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `DisplayCapabilities` descriptor to `DisplayProfile`, teach the CSS `@media` evaluator to recognize e-ink/update/monochrome/color-gamut media features, and wire descriptor-driven feature flags (antialias, gradients, opacityBlend, smoothScroll, animation) — all **additively**, defaulting to today's TFT behavior so output stays byte-identical.

**Architecture:** Phase 2 is purely additive: a new descriptor type, new `@media` feature recognition, and feature flags that read the descriptor but default to the values TFT uses today. **No 888-value switch** (that's Phase 3, where RGB666 needs it) — the lesson from Phase 1 is that values + blend math must switch together. The descriptor becomes the single source of truth that `@media`, feature-flag consultation sites, and (in later phases) the shim all read.

**Tech Stack:** TypeScript (transpiler + preview), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md` (Phase 2 of 4; §2.2 descriptor, §3.4 CSS).
**Phase 1:** complete — RGB888 storage widened, values+math stay 565.

**Verification baseline (after every code task):**
```sh
npm run build --workspace @typecad/cuttlefish   # clear *.tsbuildinfo if stale
npx vitest run tests/packages/cuttlefish
```
The 5 known-unrelated pre-existing failures (diag-render, diag-transforms, preview-canvas-dynamic, preview-module-vars ×2) are being fixed separately; do not treat them as regressions.

---

## File Structure

**Created:**
- `packages/cuttlefish/src/api/shared/display-capabilities.ts` — the `DisplayCapabilities` type + a `defaultTftCapabilities()` helper + `deriveCapabilities(profile)`.

**Modified:**
- `packages/cuttlefish/src/api/shared/display-profile.ts` — add `displayClass?: "tft" | "eink"` and `capabilities?: DisplayCapabilities` to `DisplayProfile` and `DisplayConfig`; thread through `resolveDisplayProfile`.
- `packages/cuttlefish/src/ui/css-parser.ts` — extend `evalMediaCondition` to recognize `(e-ink)`, `(update: slow|fast)`, `(monochrome)`, `(monochrome: N)`, `(color-gamut: srgb|p3)`, reading `displayClass`/`capabilities` from the profile.
- `packages/cuttlefish/src/ui/display-profile-store.ts` — expose the resolved capabilities (already returns the profile; no change if capabilities ride on the profile).
- `packages/cuttlefish/src/ui/model.ts` — the antialias feature flag consultation (line 734) generalizes to read `capabilities.features.antialias`, defaulting to today's `display?.antialias === true` behavior for TFT.
- `packages/cuttlefish/src/preview/host-ui-runtime.ts` — the antialias consultation (line ~1445) reads the same flag.

**Created (tests):**
- `tests/packages/cuttlefish/display-capabilities.test.ts` — descriptor derivation + defaults.
- `tests/packages/cuttlefish/css-media-features.test.ts` — `@media (e-ink)` / `(update)` / `(monochrome)` / `(color-gamut)` selection.

**Modified (tests):**
- `tests/packages/cuttlefish/css-parser.test.ts` — add a matching-`@media (e-ink)` case using a profile with `displayClass: "eink"`.

---

## Task 1: Add the `DisplayCapabilities` descriptor (TDD)

**Files:**
- Create: `packages/cuttlefish/src/api/shared/display-capabilities.ts`
- Modify: `packages/cuttlefish/src/api/shared/index.ts` (re-export)
- Test: `tests/packages/cuttlefish/display-capabilities.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/packages/cuttlefish/display-capabilities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DisplayCapabilities,
  defaultTftCapabilities,
  deriveCapabilities,
} from "@typecad/cuttlefish/api/shared/display-capabilities";

describe("DisplayCapabilities", () => {
  it("defaultTftCapabilities returns the values TFT uses today", () => {
    const caps = defaultTftCapabilities();
    expect(caps.nativeFormat).toBe("rgb565");
    expect(caps.refreshModel).toBe("immediate");
    expect(caps.partialRefresh).toBe("full");
    expect(caps.requiresBackingStore).toBe(false);
    expect(caps.features).toEqual({
      antialias: true,
      gradients: true,
      opacityBlend: true,
      smoothScroll: true,
      animation: true,
    });
  });

  it("deriveCapabilities defaults a bare TFT profile to TFT capabilities", () => {
    const caps = deriveCapabilities({ width: 320, height: 240, colorFormat: "rgb565" });
    expect(caps).toEqual(defaultTftCapabilities());
  });

  it("deriveCapabilities reads explicit displayClass: 'eink'", () => {
    const caps = deriveCapabilities({ width: 296, height: 128, colorFormat: "mono", displayClass: "eink" });
    expect(caps.refreshModel).toBe("deferred-partial");
    expect(caps.requiresBackingStore).toBe(true);
    expect(caps.features.antialias).toBe(false);
    expect(caps.features.gradients).toBe(false);
    expect(caps.features.smoothScroll).toBe(false);
    expect(caps.features.animation).toBe(false);
  });

  it("explicit capabilities on the profile override derivation", () => {
    const caps = deriveCapabilities({
      width: 320, height: 240, colorFormat: "rgb565",
      capabilities: { ...defaultTftCapabilities(), features: { ...defaultTftCapabilities().features, animation: false } },
    });
    expect(caps.features.animation).toBe(false);
    expect(caps.features.antialias).toBe(true); // untouched
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/packages/cuttlefish/display-capabilities.test.ts`
Expected: FAIL — module `@typecad/cuttlefish/api/shared/display-capabilities` not found.

- [ ] **Step 3: Create the descriptor module**

Create `packages/cuttlefish/src/api/shared/display-capabilities.ts`:

```ts
// ---------------------------------------------------------------------------
// DisplayCapabilities — declarative description of a display's rendering
// capabilities. The single source of truth that @media evaluation, feature-flag
// consultation, and (in later phases) the display shim all read.
//
// Phase 2 introduces the type + derivation. Default = today's TFT behavior, so
// output is byte-identical. Phase 3+ consumes it for shim routing.
// ---------------------------------------------------------------------------

/** Native pixel format the panel stores / the shim quantizes to at push. */
export type NativeFormat = "rgb888" | "rgb666" | "rgb565" | "mono" | "palette";

/** How the panel accepts refreshed pixels. */
export type RefreshModel = "immediate" | "deferred-partial" | "deferred-full";

/** Scope of partial-refresh support (e-ink panels vary). */
export type PartialRefreshScope = "none" | "mono-only" | "full";

/** Feature flags the shim can honor. False ⇒ the core snaps/disables. */
export interface DisplayFeatureFlags {
  antialias: boolean;
  gradients: boolean;
  opacityBlend: boolean;
  smoothScroll: boolean;
  animation: boolean;
}

export interface DisplayCapabilities {
  nativeFormat: NativeFormat;
  /** For palette displays (e-ink multi-color): the ink set as CSS strings. */
  palette?: string[];
  refreshModel: RefreshModel;
  partialRefresh: PartialRefreshScope;
  /** Latency (ms) of a full refresh; used by the refresh scheduler (Phase 4). */
  fullRefreshMs?: number;
  /** Max sustained partial refreshes/sec. */
  maxPartialFps?: number;
  /** Shim requires a backing store (e-ink, any dithered target). */
  requiresBackingStore: boolean;
  features: DisplayFeatureFlags;
}

/** The capabilities a fast RGB565 TFT has today — the Phase 2 default so
 *  output stays byte-identical with pre-descriptor behavior. */
export function defaultTftCapabilities(): DisplayCapabilities {
  return {
    nativeFormat: "rgb565",
    refreshModel: "immediate",
    partialRefresh: "full",
    requiresBackingStore: false,
    features: {
      antialias: true,
      gradients: true,
      opacityBlend: true,
      smoothScroll: true,
      animation: true,
    },
  };
}

/** A minimal profile shape deriveCapabilities reads. Keeps it decoupled from
 *  the full DisplayProfile (which references this module). */
interface ProfileLike {
  width: number;
  height: number;
  colorFormat: "rgb565" | "mono";
  displayClass?: "tft" | "eink";
  capabilities?: DisplayCapabilities;
}

/** Derive capabilities from a profile. Explicit `capabilities` on the profile
 *  win; otherwise derive from `displayClass` + `colorFormat`. A bare TFT profile
 *  (no displayClass) defaults to defaultTftCapabilities() — byte-identical. */
export function deriveCapabilities(profile: ProfileLike): DisplayCapabilities {
  if (profile.capabilities) return profile.capabilities;
  if (profile.displayClass === "eink") {
    return {
      nativeFormat: profile.colorFormat === "mono" ? "mono" : "palette",
      refreshModel: "deferred-partial",
      partialRefresh: profile.colorFormat === "mono" ? "mono-only" : "none",
      requiresBackingStore: true,
      features: {
        antialias: false,
        gradients: false,
        opacityBlend: false,
        smoothScroll: false,
        animation: false,
      },
    };
  }
  return defaultTftCapabilities();
}
```

- [ ] **Step 4: Re-export from the api/shared barrel**

In `packages/cuttlefish/src/api/shared/index.ts`, add to the re-exports:

```ts
export * from "./display-capabilities.js";
```

(If the file uses extensionless or `.js` import style, match the existing entries exactly — read the file first.)

- [ ] **Step 5: Build + run tests**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/display-capabilities.test.ts
```
Expected: build clean, 4/4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/api/shared/display-capabilities.ts packages/cuttlefish/src/api/shared/index.ts tests/packages/cuttlefish/display-capabilities.test.ts
git commit -m "feat(api): add DisplayCapabilities descriptor + deriveCapabilities (defaults to today's TFT behavior)"
```

---

## Task 2: Thread `displayClass` + `capabilities` through `DisplayProfile`

**Files:**
- Modify: `packages/cuttlefish/src/api/shared/display-profile.ts`

- [ ] **Step 1: Add the fields to DisplayProfile and DisplayConfig**

In `packages/cuttlefish/src/api/shared/display-profile.ts`:

First, add the import at the top:
```ts
import type { DisplayCapabilities } from "./display-capabilities.js";
```

Add to the `DisplayProfile` interface (after `colorFormat`, near line 49):
```ts
  /** Display class: "tft" (default) for fast-refresh panels, "eink" for
   *  bistable/slow-refresh panels. Drives capability derivation + @media. */
  displayClass?: "tft" | "eink";
  /** Explicit capabilities override. If absent, capabilities are derived from
   *  displayClass + colorFormat. Phase 2 default (bare TFT) = today's behavior. */
  capabilities?: DisplayCapabilities;
```

Add the same two optional fields to `DisplayConfig` (near `colorFormat`, line ~69):
```ts
  displayClass?: "tft" | "eink";
  capabilities?: DisplayCapabilities;
```

- [ ] **Step 2: Thread through resolveDisplayProfile**

In `resolveDisplayProfile` (the function body), carry the fields from config onto the base profile. After the existing `if (config.colorFormat !== undefined) base.colorFormat = config.colorFormat;` block, add:

```ts
  if (config.displayClass !== undefined) base.displayClass = config.displayClass;
  if (config.capabilities !== undefined) base.capabilities = config.capabilities;
```

And in the "no profile" branch (the `else` that builds `base` from config defaults, ~line 194-205), add `displayClass` and `capabilities` to the constructed object:

```ts
    base = {
      driver: config.driver ?? "ili9341",
      width: config.width ?? 320,
      height: config.height ?? 240,
      colorFormat: config.colorFormat ?? "rgb565",
      rotation: config.rotation ?? 1,
      backlight: config.backlight,
      spiFrequency: config.spiFrequency,
      spiPins: config.spiPins,
      touch: config.touch === false ? undefined : config.touch,
      displayClass: config.displayClass,
      capabilities: config.capabilities,
    };
```

- [ ] **Step 3: Build + run the existing profile/scroll tests**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/scroll-config.test.ts tests/packages/cuttlefish/preview-build.test.ts
```
Expected: build clean, tests pass (the new optional fields are additive; nothing reads them yet).

- [ ] **Step 4: Commit**

```bash
git add packages/cuttlefish/src/api/shared/display-profile.ts
git commit -m "feat(api): add displayClass + capabilities to DisplayProfile/Config; thread through resolveDisplayProfile"
```

---

## Task 3: Extend `evalMediaCondition` for e-ink/update/monochrome/color-gamut (TDD)

**Files:**
- Modify: `packages/cuttlefish/src/ui/css-parser.ts` (`evalMediaCondition`, ~line 163)
- Test: `tests/packages/cuttlefish/css-media-features.test.ts` (new)

This is the heart of Phase 2: authors can write `@media (e-ink) { ... }` and the rule is kept/dropped at transpile based on the resolved profile. Existing width/height behavior is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/packages/cuttlefish/css-media-features.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
// Import from SRC (not the package export) so parseCss + setDisplayProfile share
// the same module instance — evalMediaCondition reads getDisplayProfile() from
// its own module, so the profile must be set on that same instance. This mirrors
// the pattern in css-parser.test.ts (theme-state sharing).
import { parseCss } from "../../../packages/cuttlefish/src/ui/css-parser";
import { setDisplayProfile, resetDisplayProfile } from "../../../packages/cuttlefish/src/ui/display-profile-store";
import type { DisplayProfile } from "../../../packages/cuttlefish/src/api/shared/display-profile";

function idsOf(rules: any[]): string[] {
  return rules.map(r => r.selector.compounds[0][0].name);
}

describe("@media display-class features", () => {
  // setDisplayProfile takes a profile AND a wiring object ({cs,dc,rst,bus}).
  const tftProfile: DisplayProfile = {
    driver: "ili9341", width: 320, height: 240, colorFormat: "rgb565", rotation: 1,
  };
  const einkProfile: DisplayProfile = {
    driver: "ssd1680", width: 296, height: 128, colorFormat: "mono", rotation: 1, displayClass: "eink",
  };
  const wiring = { cs: 5, dc: 21, rst: 22, bus: "SPI" };

  afterEach(() => resetDisplayProfile());

  const setTft = () => setDisplayProfile(tftProfile, wiring);
  const setEink = () => setDisplayProfile(einkProfile, wiring);

  it("(e-ink) keeps rules on an eink profile, drops them on TFT", () => {
    setEink();
    const einkRules = parseCss(`@media (e-ink) { #a { color: black; } }`);
    expect(idsOf(einkRules)).toContain("a");

    setTft();
    const tftRules = parseCss(`@media (e-ink) { #a { color: black; } } #b { color: red; }`);
    expect(idsOf(tftRules)).not.toContain("a");
    expect(idsOf(tftRules)).toContain("b");
  });

  it("(update: slow) matches eink; (update: fast) matches TFT", () => {
    setEink();
    expect(idsOf(parseCss(`@media (update: slow) { #slow { color: black; } }`))).toContain("slow");
    expect(idsOf(parseCss(`@media (update: fast) { #fast { color: black; } }`))).not.toContain("fast");

    setTft();
    expect(idsOf(parseCss(`@media (update: fast) { #fast { color: red; } }`))).toContain("fast");
    expect(idsOf(parseCss(`@media (update: slow) { #slow { color: red; } }`))).not.toContain("slow");
  });

  it("(monochrome) matches a mono eink profile; (monochrome: 2) requires N>=2 levels", () => {
    setEink(); // colorFormat mono -> 2 levels
    expect(idsOf(parseCss(`@media (monochrome) { #m { color: black; } }`))).toContain("m");
    expect(idsOf(parseCss(`@media (monochrome: 2) { #m2 { color: black; } }`))).toContain("m2");
    expect(idsOf(parseCss(`@media (monochrome: 4) { #m4 { color: black; } }`))).not.toContain("m4");

    setTft(); // rgb565 -> color, not monochrome
    expect(idsOf(parseCss(`@media (monochrome) { #m { color: red; } }`))).not.toContain("m");
  });

  it("(color-gamut: srgb) matches both TFT and eink; (color-gamut: p3) matches neither (no wide gamut yet)", () => {
    setTft();
    expect(idsOf(parseCss(`@media (color-gamut: srgb) { #s { color: red; } }`))).toContain("s");
    expect(idsOf(parseCss(`@media (color-gamut: p3) { #p { color: red; } }`))).not.toContain("p");

    setEink();
    expect(idsOf(parseCss(`@media (color-gamut: srgb) { #s { color: black; } }`))).toContain("s");
  });

  it("AND-combines with width/height (e-ink AND min-width)", () => {
    setEink(); // width 296
    expect(idsOf(parseCss(`@media (e-ink) and (min-width: 200px) { #ok { color: black; } }`))).toContain("ok");
    expect(idsOf(parseCss(`@media (e-ink) and (min-width: 400px) { #no { color: black; } }`))).not.toContain("no");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/packages/cuttlefish/css-media-features.test.ts`
Expected: FAIL — `(e-ink)` etc. are unrecognized → rules warned + dropped (return null path).

- [ ] **Step 3: Extend evalMediaCondition**

In `packages/cuttlefish/src/ui/css-parser.ts`, replace `evalMediaCondition` (lines ~163-190) with a version that recognizes the new features **in addition to** width/height. Keep the existing width/height regex and AND-combine logic; add feature clauses that read `displayClass`/`colorFormat` from the profile:

```ts
/** Evaluate an @media condition (css-tree prelude string) against the resolved
 *  display profile at transpile time. Each firmware build targets ONE display,
 *  so @media is a compile-time variant selector, not responsive design.
 *  Returns true if the rule should apply. Supports:
 *   - (min|max)-(width|height):Npx, (width|height):Npx
 *   - (e-ink), (update: slow|fast), (monochrome), (monochrome: N),
 *     (color-gamut: srgb|p3)
 *  Clauses AND-combine (comma = OR not supported). Unsupported → null (warn). */
function evalMediaCondition(prelude: string): boolean | null {
  const s = prelude.trim();
  if (s === "" || s === "all" || /(?<![\w-])all(?![\w-])/i.test(s)) return true;
  const profile = getDisplayProfile();
  const w = profile.width;
  const h = profile.height;
  const isEink = profile.displayClass === "eink";
  const isMono = profile.colorFormat === "mono";
  // Mono level count: mono = 2 (B&W). (No 4/7-level descriptor yet; Phase 4.)
  const monoLevels = isMono ? 2 : 0;

  let result = true;
  let matched = false;

  // Width/height clauses (existing).
  const featRe = /\((?:\s*(min|max)-(width|height)\s*:\s*(\d+)(?:px)?\s*|\s*(width|height)\s*:\s*(\d+)(?:px)?\s*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = featRe.exec(s)) !== null) {
    matched = true;
    if (m[1] && m[2] && m[3]) {
      const n = parseInt(m[3], 10);
      const axis = m[2] === "width" ? w : h;
      result = result && (m[1] === "min" ? axis >= n : axis <= n);
    } else if (m[4] && m[5]) {
      const n = parseInt(m[5], 10);
      result = result && ((m[4] === "width" ? w : h) === n);
    }
  }

  // (e-ink) — boolean feature: true on an eink display class.
  if (/\(\s*e-?ink\s*\)/i.test(s)) {
    matched = true;
    result = result && isEink;
  }
  // (update: slow|fast) — slow = eink, fast = tft.
  const updateM = /\(\s*update\s*:\s*(slow|fast)\s*\)/i.exec(s);
  if (updateM) {
    matched = true;
    const want = updateM[1].toLowerCase();
    result = result && (want === "slow" ? isEink : !isEink);
  }
  // (monochrome) and (monochrome: N) — true when colorFormat is mono with >=N levels.
  const monoM = /\(\s*monochrome(?:\s*:\s*(\d+))?\s*\)/i.exec(s);
  if (monoM) {
    matched = true;
    const want = monoM[1] ? parseInt(monoM[1], 10) : 1;
    result = result && isMono && monoLevels >= want;
  }
  // (color-gamut: srgb|p3) — srgb is the baseline for both TFT and eink; p3 unsupported.
  const gamutM = /\(\s*color-gamut\s*:\s*(srgb|p3)\s*\)/i.exec(s);
  if (gamutM) {
    matched = true;
    result = result && gamutM[1].toLowerCase() === "srgb";
  }

  if (!matched) return null;  // unrecognized condition
  return result;
}
```

Note: also update the `unsupported-media-condition` hint message (line ~238) to list the new features:

```ts
            hint: "Supported: (max-width:Npx), (min-width:Npx), (max-height:Npx), (min-height:Npx), (e-ink), (update: slow|fast), (monochrome), (monochrome: N), (color-gamut: srgb).",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/packages/cuttlefish/css-media-features.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Run existing css-parser tests to confirm no width/height regression**

Run: `npx vitest run tests/packages/cuttlefish/css-parser.test.ts`
Expected: all pass (the existing 3 @media tests at lines 276-294 must still pass).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/css-parser.ts tests/packages/cuttlefish/css-media-features.test.ts
git commit -m "feat(css): @media recognizes (e-ink)/(update)/(monochrome)/(color-gamut) via displayClass + colorFormat"
```

---

## Task 4: Wire descriptor-driven feature flags (antialias first)

**Files:**
- Modify: `packages/cuttlefish/src/ui/model.ts` (antialias consultation, ~line 734)
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts` (antialias consultation, ~line 1445)

This task generalizes the existing single feature flag (`antialias`) to read the descriptor, defaulting to today's behavior. Other flags (gradients, opacityBlend, smoothScroll, animation) are wired in their respective Phase 4 areas; Phase 2 plumbs only `antialias` as the proven pattern, keeping TFT output byte-identical.

- [ ] **Step 1: Read the current antialias consultation in model.ts**

Run: `sed -n '725,740p' packages/cuttlefish/src/ui/model.ts` to see the exact current logic.

- [ ] **Step 2: Generalize to read capabilities, TFT-default preserved**

In `packages/cuttlefish/src/ui/model.ts`, the function at ~line 730-734 currently returns `display?.antialias === true`. Update it to consult derived capabilities, falling back to the legacy `antialias` field so existing configs are unchanged:

```ts
import { deriveCapabilities } from "../api/shared/display-capabilities.js";

// ... in the antialias resolver (~line 730):
export function resolveFontAntialias(display: DisplayProfile | undefined): boolean {
  if (!display) return true; // pre-descriptor default (tests with no profile)
  // Explicit profile.antialias still wins for back-compat (existing configs).
  if (display.antialias === false) return false;
  // Otherwise derive from capabilities: TFT default true, eink false.
  return deriveCapabilities(display).features.antialias;
}
```

(If the current code is an inline expression rather than a named function, wrap it in this helper and update call sites — check with `grep -n "antialias" packages/cuttlefish/src/ui/model.ts` first.)

- [ ] **Step 3: Mirror the consultation in the preview**

In `packages/cuttlefish/src/preview/host-ui-runtime.ts` (~line 1445), the antialias check reads `this.snapshot.program.colorFormat !== "mono"`. Generalize it to read the resolved capabilities:

```ts
// antialias honored only when the display capabilities allow it (eink: false)
const caps = deriveCapabilities(this.resolvedProfile());
if (antialias && letterSpacing === 0 && caps.features.antialias && (fg & 0xffff) !== (bg & 0xffff)) {
  this.gfx.drawAntialiasedText(...);
```

If `resolvedProfile()` isn't an existing accessor, read from `this.snapshot.program` (it already carries `colorFormat`; add `displayClass` to the program snapshot in build-program.ts if not present — check first).

- [ ] **Step 4: Add a test that eink displayClass disables antialias**

Add to `tests/packages/cuttlefish/display-capabilities.test.ts`:

```ts
  it("eink displayClass disables antialias via deriveCapabilities", () => {
    const eink = deriveCapabilities({ width: 296, height: 128, colorFormat: "mono", displayClass: "eink" });
    expect(eink.features.antialias).toBe(false);
    const tft = deriveCapabilities({ width: 320, height: 240, colorFormat: "rgb565" });
    expect(tft.features.antialias).toBe(true);
  });
```

- [ ] **Step 5: Build + run affected tests**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/display-capabilities.test.ts tests/packages/cuttlefish/preview-gfx.test.ts tests/packages/cuttlefish/host-rich-text.test.ts
```
Expected: pass. (TFT path unchanged → antialias still true → byte-identical.)

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/model.ts packages/cuttlefish/src/preview/host-ui-runtime.ts tests/packages/cuttlefish/display-capabilities.test.ts
git commit -m "feat(ui): antialias feature flag reads DisplayCapabilities (TFT default unchanged; eink disables)"
```

---

## Task 5: Phase 2 verification & sign-off

- [ ] **Step 1: Clean build**

Run:
```sh
rm -f packages/cuttlefish/*.tsbuildinfo
npm run build --workspace @typecad/cuttlefish
```
Expected: clean.

- [ ] **Step 2: Full cuttlefish suite**

Run: `npx vitest run tests/packages/cuttlefish`
Expected: 607 baseline + new Phase 2 tests pass; only the 5 known-unrelated failures remain. No new regressions.

- [ ] **Step 3: demo-ui compiles (TFT path byte-identical)**

Run: `npm run compile --workspace demo-ui`
Expected: exit 0 (the demo-ui profile has no `displayClass`, so it derives default TFT capabilities — unchanged output).

- [ ] **Step 4: Mark Phase 2 complete in the spec**

In `docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md`, §6, update the Phase 2 line with a one-line summary + commit SHA range. Commit:

```bash
git add docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md
git commit -m "docs(spec): mark Phase 2 complete — DisplayCapabilities + @media display-class features"
```

---

## Self-Review

**1. Spec coverage (Phase 2 of spec §6 + §2.2 + §3.4):**
- §2.2 `DisplayCapabilities` descriptor → Task 1 (type + `defaultTftCapabilities` + `deriveCapabilities`).
- §3.3 `displayClass` on `DisplayProfile` → Task 2.
- §3.4 `@media (e-ink)`/`(update)`/`(monochrome)`/`(color-gamut)` → Task 3.
- Descriptor-driven feature flags → Task 4 (antialias as the proven pattern).
- "TFT path still unchanged in output" → guaranteed by TFT-defaulting `defaultTftCapabilities` + Task 5 Step 3 compile check.

**2. Placeholder scan:** every code step has complete code; every command has expected output. No TBD/TODO.

**3. Type/name consistency:** `DisplayCapabilities`, `NativeFormat`, `RefreshModel`, `PartialRefreshScope`, `DisplayFeatureFlags`, `deriveCapabilities`, `defaultTftCapabilities` — consistent across tasks. `displayClass: "tft" | "eink"` matches between profile (Task 2), derivation (Task 1), and `@media` (Task 3).

**4. Phase 1 lesson applied:** No 888-value switch in Phase 2. The descriptor is additive; values + blend math stay 565. The 888 switch is deferred to Phase 3 (RGB666) where it lands together with blend-math switch, exactly as Phase 1's counterexample proved necessary.

**5. Byte-identity guarantee:** `defaultTftCapabilities()` returns today's TFT feature values; a bare TFT profile (no `displayClass`) derives those defaults; demo-ui has no `displayClass` so its output is unchanged. Task 5 Step 3 verifies via compile.
