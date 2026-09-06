---
'@typecad/ui': patch
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
---

Legacy-HAL removal Phase 1a — the remaining Arduino UI demos ported to Zephyr, with three engine bugs the ports surfaced and fixed:

**New Zephyr demos** (each transpiles AND full west-builds for `esp32s3_devkitc`):
- **`demos/zephyr-ui`** — the framework-zephyr port of demo-ui: the showcase.ui + neobrutalism theme on the shared ST7796S + FT6336U rig. The largest UI program yet compiled on Zephyr — lists, forms, canvases, keyframe animations, navigation.
- **`demos/zephyr-weather`** — port of demo-weather: the BME688-style weather dashboard with ui.signal bindings + setInterval polling.
- Scope note: **demo-ui-sd13 is NOT ported** — the ssd1306-zephyr profile deliberately has no CuttlefishGFX mono UI adapter ("direct display.* only" per the manifest), so a `.ui` entry cannot target mono on Zephyr. Porting it means writing that adapter (~1–2 days + hardware validation); recorded as deferred rather than half-shipped.

**Engine fixes the ports forced**:
1. **Zephyr console lowering** (`framework-zephyr/src/strategy.ts`): multi-arg `console.log('tapped:', i)` lowered to `printk("%s%s%s\n", …)` assuming every fragment was a string — a numeric list-bind index failed `-Wformat` and broke the west build. Now routes through the `__tc_print`/`__tc_println` shim overloads (const char*, double), which accept any rendered scalar without format-specifier coupling; the shim helpers are emitted unconditionally (they were gated on analysis flags absent in pure-UI programs).
2. **Keyframe-table link collision** (`packages/ui/src/ui-engine/ui-lowering.ts`): modules sharing a stylesheet register identical animation names, so two mounted modules emitted identically-named `static const UIKeyframeStop` arrays into one TU — a hard redefinition error. Keyframe symbols are now namespaced per module (stable path hash) and deduped by animation name within a module; the set-index table references follow.
3. The `__tc_println` chain emits proper statement separators (first attempt emitted adjacent calls without semicolons — caught by the same west build).

Regression-verified: demo-shadcn, zephyr-display, and zephyr-debug all still build after the engine changes.
