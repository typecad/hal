// ---------------------------------------------------------------------------
// UI runtime emitter — injects the C++ runtime header + static tables into the
// entry translation unit when a UI is mounted.
//
// Called from emitCpp between the preamble (includes) and type declarations,
// gated on ctx.isEntryFile && entryHasUI(). Everything emitted here is
// file-scope (structs, static tables, extern decls) so it must precede any
// function that references it.
//
// Sources:
//   - emitRuntimeHeader()        → the guarded struct/helper block (once per TU)
//   - allLoweredUIModules()      → __ui_nodes[] + __ui_trans[] per mounted tree
//   - uiSignalDecls()            → one device variable per recorded signal
//   - emitBindingTable(uiBindings()) → __ui_bindings[]
// ---------------------------------------------------------------------------

import type { EmitterContext } from "./emitter-context.js";
import { appendSourceLine, appendRenderedStatement } from "./line-appender.js";
import { createChildEmissionScope, createEmissionScopeState } from "../snprintf-helpers.js";
import type { StatementIR } from "../../api/index.js";
import type { SourceSpan } from "../../types.js";
import { entryHasUI, requireUIHook } from "../../ui-hook.js";
import { uiSignalDecls, uiBindings, uiPressBindings, watchPinSpecs, clickHandlers } from "../../ir/transformers/ui-call-resolver.js";
import { emitBindingTable, emitListBindingTable, getListBindings, emitInputBindingTable, getInputBindings } from "../../ir/transformers/ui-reactive.js";
import { emitCanvasBindings, canvasBindings } from "../../ir/transformers/canvas-lowering.js";
import { getDisplayProfile } from "../../stores/display-profile-store.js";
import {
  effectiveDisplaySize,
  generateTouchAdapter,
  normalizeDisplayRotation,
  TouchAdapterCodegen,
  resolveScrollConfig,
} from "../../api/shared/display-profile.js";
import { deriveCapabilities } from "../../api/shared/display-capabilities.js";
import { generateDisplayAdapter } from "../../api/shared/display-adapter.js";
import { getRadioGroups } from "../../ir/ui-element-auto-wire.js";

// ---------------------------------------------------------------------------
// Touch poll body generator — extracted from emitUIRuntime for testability.
//
// Emits the ui_poll_touch() body that reads raw touch coords, applies the
// calibration map+rotation, and dispatches to ui_handle_touch/ui_handle_no_touch.
//
// Capacitive controllers (FT6336U, sdl) have no real z/pressure, so the
// minPressure gate is skipped for them. Resistive controllers (XPT2046,
// STMPE610, Adafruit_TouchScreen) keep the gate.
// ---------------------------------------------------------------------------

const CAPACITIVE_TOUCH_LIBS: ReadonlySet<string> = new Set(["FT6336U", "GT911", "CST816S", "sdl"]);

export interface TouchPollInput {
  library?: string;
  minPressure: number;
  calibration: { xMin: number; xMax: number; yMin: number; yMax: number };
  profile: { width: number; height: number; nativeWidth?: number; nativeHeight?: number; rotation: number };
}

/** Generate the ui_poll_touch() body, or null for the no-touch path. */
export function generateTouchPollBody(input: TouchPollInput): string | null {
  const { library, minPressure, calibration, profile } = input;
  if (!library) return null;

  const { xMin, xMax, yMin, yMax } = calibration;
  const rotation = normalizeDisplayRotation(profile.rotation);
  const screen = effectiveDisplaySize(profile);
  const hasNativeSize = profile.nativeWidth !== undefined && profile.nativeHeight !== undefined;
  const nativeWidth = profile.nativeWidth ?? profile.width;
  const nativeHeight = profile.nativeHeight ?? profile.height;
  // Inlined Arduino map() arithmetic, NOT a map() call: the emitted body must
  // be self-contained. The map/constrain helpers are capability-gated
  // (usesMap is set by SCRIPT-level map() calls only), so a bare map() here
  // failed to link on frameworks without a core map() (Zephyr).
  const mapCall = (raw: string, inMin: number, inMax: number, outMin: number, outMax: number): string =>
    `((${raw} - ${inMin}) * (${outMax} - ${outMin}) / (${inMax} - ${inMin}) + ${outMin})`;
  const rawMapX = mapCall("__rawX", xMin, xMax, 0, nativeWidth);
  const rawMapY = mapCall("__rawY", yMin, yMax, 0, nativeHeight);
  let mapX: string, mapY: string;
  let sdlClamp = false;
  if (library === "sdl") {
    // SDL mouse coords are already window/screen pixel coords — no axis swap,
    // no calibration. Pass them through 1:1 and clamp to the LIVE display
    // dimensions (display_width()/display_height(), which return the SDL
    // target's constructed w_/h_). This way clicks track the window size
    // regardless of the touch.calibration config — the calibration is a
    // hardware-controller concept (resistive raw ranges) that doesn't apply to
    // a mouse, and baking it forced users to keep xMax/yMax in sync with
    // width/height or clicks landed in the wrong place after resizing.
    mapX = `__rawX`;
    mapY = `__rawY`;
    sdlClamp = true;
  } else if (!hasNativeSize) {
    const isLandscape = rotation === 1 || rotation === 3;
    const invertX = rotation === 1 || rotation === 2;
    const invertY = rotation === 1 || rotation === 2;
    if (isLandscape) {
      mapX = invertX
        ? mapCall("__rawX", xMin, xMax, profile.width, 0)
        : mapCall("__rawX", xMin, xMax, 0, profile.width);
      mapY = invertY
        ? mapCall("__rawY", yMin, yMax, profile.height, 0)
        : mapCall("__rawY", yMin, yMax, 0, profile.height);
    } else {
      mapX = mapCall("__rawY", yMin, yMax, profile.width, 0);
      mapY = mapCall("__rawX", xMin, xMax, 0, profile.height);
    }
  } else {
    switch (rotation) {
      case 1:
        mapX = rawMapY;
        mapY = `${nativeWidth} - (${rawMapX})`;
        break;
      case 2:
        mapX = `${nativeWidth} - (${rawMapX})`;
        mapY = `${nativeHeight} - (${rawMapY})`;
        break;
      case 3:
        mapX = `${nativeHeight} - (${rawMapY})`;
        mapY = rawMapX;
        break;
      default:
        mapX = rawMapX;
        mapY = rawMapY;
        break;
    }
  }

  const clampLines = (indent: string): string[] => sdlClamp
    ? [
        // SDL: clamp to live display dimensions (display_width()/height() return
        // the SDL target's constructed w_/h_), so clicks track the window size.
        `${indent}int16_t __dw = display_width(), __dh = display_height();`,
        `${indent}if (__tx < 0) __tx = 0; else if (__tx >= __dw) __tx = __dw - 1;`,
        `${indent}if (__ty < 0) __ty = 0; else if (__ty >= __dh) __ty = __dh - 1;`,
      ]
    : [
        `${indent}if (__tx < 0) __tx = 0; else if (__tx >= ${screen.width}) __tx = ${screen.width - 1};`,
        `${indent}if (__ty < 0) __ty = 0; else if (__ty >= ${screen.height}) __ty = ${screen.height - 1};`,
      ];
  const isCapacitive = CAPACITIVE_TOUCH_LIBS.has(library);
  const lines: string[] = [
    `void ui_poll_touch() {`,
    `  if (touch_isTouched()) {`,
    `    int16_t __rawX = 0, __rawY = 0, __rawZ = 0;`,
    `    touch_readRaw(&__rawX, &__rawY, &__rawZ);`,
  ];
  if (isCapacitive) {
    lines.push(
      `    int16_t __tx = ${mapX};`,
      `    int16_t __ty = ${mapY};`,
      ...clampLines("    "),
      `    ui_handle_touch(__tx, __ty);`,
    );
  } else {
    lines.push(
      `    if (__rawZ >= ${minPressure}) {`,
      `      int16_t __tx = ${mapX};`,
      `      int16_t __ty = ${mapY};`,
      ...clampLines("      "),
      `      ui_handle_touch(__tx, __ty);`,
      `    } else {`,
      `      ui_handle_no_touch();`,
      `    }`,
    );
  }
  lines.push(
    `  } else {`,
    `    ui_handle_no_touch();`,
    `  }`,
    `}`,
  );
  return lines.join("\n");
}

export function emitUIRuntime(ctx: EmitterContext): void {
  // Only the entry file carries the UI runtime + tables.
  if (!ctx.isEntryFile || !entryHasUI()) return;

  // The hook is guaranteed set when entryHasUI() returns true.
  const ui = requireUIHook();
  const emitRuntimeHeader = ui.emitRuntimeHeader;
  const allLoweredUIModules = ui.allLoweredUIModules;

  // 0.5. Display adapter: includes + object declaration + inline functions.
  // Generated per display driver type (ILI9341, ST7789, etc.) via the
  // display-adapter registry. Must precede the runtime header so the
  // adapter functions (__tc_display, display_init, etc.) are available.
  const profile = getDisplayProfile();

  // 0. SPI-bus display drivers (ILI9341, ST7796, …) need the Arduino SPI
  // library — but ONLY on the Adafruit path. Native adapters (AVR, ESP32)
  // emit their own bus setup and would break on <SPI.h>. Host render targets
  // (sdl, native-preview) have no SPI bus at all.
  const nativeAdapter = ctx.strategy?.providesDisplayAdapter?.() ?? false;
  const spiDriver = profile?.driver !== "sdl"
    && profile?.driver !== "native-preview"
    && !nativeAdapter;
  if (spiDriver && !ctx.includes.includes("<SPI.h>")) {
    ctx.includes.push("<SPI.h>");
  }
  // NOTE: <stdio.h> (needed by text-binding snprintf bodies) is pushed in
  // buildEmitterContext (setup.ts), NOT here — emitPreamble runs before this
  // function, so a push here would be too late to land in the output.

  if (profile) {
    const adapter = generateDisplayAdapter(profile, ctx.strategy);
    // Prepend includes to the very front — Arduino's auto-prototyper scans
    // the whole translation unit and generates prototypes that reference GFXcanvas16
    // etc. before any #include, so the GFX header must come first.
    ctx.sourceLines.unshift(adapter.includes);
    // Color-depth preamble: UI_COLOR_T is referenced by adapter draw
    // signatures, so the depth + type defines must precede the adapter
    // functions (which come before the runtime header). Under 565/mono
    // these resolve to uint16_t/0x7BEF — byte-identical with history.
    const is888 = profile.colorFormat === "rgb666" || profile.colorFormat === "rgb888";
    ctx.sourceLines.push(
      is888
        ? "#define UI_COLOR_DEPTH 888\n#define UI_COLOR_T uint32_t\n#define UI_DIM_MASK 0x7F7F7Fu"
        : "#define UI_COLOR_DEPTH 565\n#define UI_COLOR_T uint16_t\n#define UI_DIM_MASK 0x7BEFu",
    );
    // The native CuttlefishGFX/CuttlefishCanvas16 class slice is emitted ONLY
    // for adapters that instantiate CuttlefishGFX by value (the planned
    // framework-avr/framework-esp32 native panel drivers). Adapters that alias
    // the token via macro — the Adafruit path (`#define CuttlefishCanvas16
    // GFXcanvas16`) and the SDL path (`#define CuttlefishCanvas16 SdlGfxCanvas`)
    // — own the canvas type; emitting the class slice alongside the macro makes
    // `class CuttlefishCanvas16` macro-expand into a redefinition of Adafruit's
    // GFXcanvas16. Detect the macro-alias path from the adapter's own includes
    // and suppress the slice there. The previous gate reused
    // providesDisplayAdapter(), which merely means "the strategy owns its
    // adapters" (true for Arduino/Adafruit) and is unrelated to whether the
    // native GFX class is wanted — it wrongly emitted the slice on every
    // Arduino build, breaking compilation.
    const macroAliasesCanvas16 = /^\s*#\s*define\s+CuttlefishCanvas16\b/m.test(adapter.includes);
    if (!macroAliasesCanvas16) {
      ctx.sourceLines.push(ui.emitCuttlefishGfx(true));
    }
    ctx.sourceLines.push(adapter.declaration);
    ctx.sourceLines.push(adapter.functions);
  }

  // 0.6. Touch adapter: includes + declaration (zero-cost, transpile-time).
  // Same pattern as the display adapter — generated inline C++ per library type.
  let touchAdapter: TouchAdapterCodegen | null = null;
  if (profile.touch) {
    const t = profile.touch;
    if (t.library) {
      touchAdapter = generateTouchAdapter(t, ctx.strategy);
      // Prepend includes to the front (Arduino auto-prototyper safety).
      ctx.sourceLines.unshift(touchAdapter.includes[0]);
      for (let i = 1; i < touchAdapter.includes.length; i++) {
        ctx.sourceLines.push(touchAdapter.includes[i]);
      }
      ctx.sourceLines.push(touchAdapter.declaration);
      ctx.sourceLines.push(touchAdapter.functions);
    }
  }
  // SDL_MAIN_HANDLED must be the absolute first line — it must precede every
  // #include <SDL2/SDL.h> (the display adapter's and the touch shim's). The
  // touch unshift above runs after the display-adapter block, so this final
  // unshift lands at the very front.
  if (profile.driver === "sdl") {
    ctx.sourceLines.unshift("#define SDL_MAIN_HANDLED");
  }

  // Forward declaration for touch poll (used inside the runtime header's ui_tick).
  // Always emitted — ui_tick calls it unconditionally; the body is a no-op when
  // no touch hardware is configured.
  ctx.sourceLines.push("void ui_poll_touch();");

  // 1. Runtime header (structs + helpers, guarded so repeat emission is safe).
  //    Emit the antialiasing compile-time flag before the header so the AA
  //    code paths are compiled in.
  const loweredModules = allLoweredUIModules();
  // AA compiles in only when the profile opts in. A node-level fontAntialias=1
  // flag alone is not enough — that would silently re-enable a heavy code path
  // the author explicitly disabled with `antialias: false`. (The runtime still
  // honors fontAntialias=0 at the per-node level when AA is compiled in.)
  const needsAntialias = profile.antialias === true;
  if (needsAntialias) {
    ctx.sourceLines.push("#define UI_AA 1");
  }
  // The SDL desktop target has a real keyboard (the host event loop routes
  // SDL_TEXTINPUT into the on-screen-keyboard editing session), so the 6×4 OSK
  // grid is redundant clutter that covers the app. UI_HIDE_OSK suppresses the
  // OSK *draw* only — the editing session (buffer, target, commit-on-close)
  // still runs, so typing works. Hardware targets don't define it: their only
  // text-entry path is the visible grid.
  if (profile.driver === "sdl") {
    ctx.sourceLines.push("#define UI_HIDE_OSK 1");
  }
  // 1a. Color depth — drives blend/lerp selection in the runtime header. 565
  //     for TFT byte-identity (node fields hold 565 values); 888 for rgb666+
  //     targets (node fields hold 888 values, blend via ui_blend888). The value
  //     depth and blend math switch TOGETHER — see Phase 1 counterexample.
  //     Guarded: the display-adapter preamble (0.5) may already define it so
  //     UI_COLOR_T precedes the adapter's draw signatures.
  ctx.sourceLines.push(
    profile.colorFormat === "rgb666" || profile.colorFormat === "rgb888"
      ? "#ifndef UI_COLOR_DEPTH\n#define UI_COLOR_DEPTH 888\n#endif"
      : "#ifndef UI_COLOR_DEPTH\n#define UI_COLOR_DEPTH 565\n#endif",
  );
  // 1a-bis. Refresh model + native format from derived capabilities. E-ink
  //        (displayClass: "eink") derives refreshModel "deferred-partial" +
  //        requiresBackingStore; TFT stays "immediate". When these are absent
  //        (TFT), the runtime's backing-store + refresh-scheduler + clear-
  //        suppression paths compile out — byte-identical with pre-Phase-4.
  const caps = deriveCapabilities(profile);
  if (caps.refreshModel !== "immediate") {
    ctx.sourceLines.push("#define UI_REFRESH_DEFERRED 1");
  }
  if (caps.nativeFormat === "mono") {
    ctx.sourceLines.push("#define UI_NATIVE_MONO 1");
  }
  if (caps.requiresBackingStore) {
    ctx.sourceLines.push("#define UI_REQUIRES_BACKING_STORE 1");
  }
  // NOTE: per-frame SPI-write batching via UI_BATCH_SPI_WRITES was investigated
  // and reverted — the Adafruit_GFX version in this repo does NOT reference-
  // count startWrite/endWrite (every endWrite raises CS unconditionally), so
  // wrapping the frame in startWrite/endWrite causes inner draw calls (e.g. the
  // scroll-canvas composite) to close the transaction mid-frame → black screen.
  // The three-branch dispatch in runtime-header.ts still ships (it's a clearer
  // structure than the old #ifndef/#else), but TFT now falls through to the
  // no-op default until a ref-counted library version or a bypass approach lands.
  // See docs/superpowers/specs/2026-07-06-tft-spi-write-batching-design.md.
  // 1b. Scroll capability + physics overrides — emitted BEFORE the runtime
  //     header so its #ifndef guards adopt them. Source of truth:
  //     resolveScrollConfig(profile.scroll). Defaults derive from the declared
  //     touch hardware, so the demo (XPT2046) gets resistive+full with no config.
  const scroll = resolveScrollConfig(profile);
  ctx.sourceLines.push(
    `#define UI_SCROLL_MAX_OVERSCROLL ${scroll.maxOverscroll}`,
    `#define UI_SCROLL_STIFFNESS_X10 ${Math.round(scroll.stiffness * 10)}`,
    `#define UI_SCROLL_EDGE_SNAP_PX ${scroll.edgeSnapPx}`,
    `#define UI_SCROLL_DRAG_SCALE_X10 ${Math.round(scroll.dragScale * 10)}`,
    `#define UI_SCROLL_INPUT_TIER_CAPACITIVE ${scroll.inputTier === "capacitive" ? 1 : 0}`,
    `#define UI_SCROLL_INPUT_TIER_RESISTIVE ${scroll.inputTier === "resistive" ? 1 : 0}`,
    `#define UI_SCROLL_INPUT_TIER_NONE ${scroll.inputTier === "none" ? 1 : 0}`,
    `#define UI_SCROLL_RENDER_TIER_FULL ${scroll.renderTier === "full" ? 1 : 0}`,
    `#define UI_SCROLL_RENDER_TIER_CONSTRAINED ${scroll.renderTier === "constrained" ? 1 : 0}`,
    ...(scroll.debug ? [`#define UI_SCROLL_DEBUG 1`] : []),
  );
  // Forward-declare __ui_kb_set_onchange before the runtime header: the
  // header's keyboard-open function calls it, but the definition is emitted
  // later (section 8b). On native (single TU) this must precede the header.
  ctx.sourceLines.push(`void __ui_kb_set_onchange();`);
  ctx.sourceLines.push(emitRuntimeHeader({
    nativeDisplayActive: ctx.strategy?.providesDisplayAdapter?.() ?? false,
  }));

  // 1.5. Touch poll function (uses the adapter pattern). Body is generated by
  // generateTouchPollBody — extracted for unit-testability of the capacitive
  // vs resistive branch (FT6336U/SDL skip the minPressure gate).
  if (profile.touch && touchAdapter) {
    const body = generateTouchPollBody({
      library: profile.touch.library,
      minPressure: profile.touch.minPressure ?? 10,
      calibration: profile.touch.calibration,
      profile: {
        width: profile.width,
        height: profile.height,
        nativeWidth: profile.nativeWidth,
        nativeHeight: profile.nativeHeight,
        rotation: profile.rotation,
      },
    });
    ctx.sourceLines.push(body ?? "void ui_poll_touch() {}");
  } else {
    // No touch hardware — emit a no-op so ui_tick's unconditional call resolves.
    ctx.sourceLines.push("void ui_poll_touch() {}");
  }

  // 2. Static node + transition tables for every mounted UI tree.
  for (const { lowered } of allLoweredUIModules()) {
    ctx.sourceLines.push(lowered.fontTables);
    if (lowered.imageTables) ctx.sourceLines.push(lowered.imageTables);
    if (lowered.keyframeTables) ctx.sourceLines.push(lowered.keyframeTables);
    ctx.sourceLines.push(lowered.nodeTable);
    ctx.sourceLines.push(lowered.transitionTable);
  }

  // 2b. Keyboard loader functions + dispatch table (for <input> support).
  for (const { lowered } of allLoweredUIModules()) {
    if (lowered.keyboardLoaders) ctx.sourceLines.push(lowered.keyboardLoaders);
    if (lowered.keyboardDispatch) ctx.sourceLines.push(lowered.keyboardDispatch);
  }

  // 3. Signal variables (one per ui.signal / const X = ui.signal).
  // A3-9-1: signal decls bypass the statement renderer, so apply the
  // int -> fixed-width substitution here under --autosar.
  const signalAutosarOn = ctx.compliance.isEnabled() && ctx.compliance.isBanned("A3-9-1");
  const fixedWidth = signalAutosarOn && ctx.strategy ? ctx.strategy.defaultNumericType(ctx.compliance) : "";
  for (const decl of uiSignalDecls()) {
    ctx.sourceLines.push(fixedWidth && decl.startsWith("int ") ? `${fixedWidth}${decl.slice(3)}` : decl);
  }

  // 4. Binding table (accumulated from ui.bind calls).
  // Forward-declare the binding compute functions first: the table references
  // them via fn/textFn, but the function bodies are emitted below (4b). On
  // native (single TU, no Arduino auto-prototyper) the use-before-def would
  // fail to compile.
  for (const spec of uiBindings()) {
    if (spec.property === "text") {
      ctx.sourceLines.push(`void ${spec.fnName}(char* buf, uint8_t size);`);
    } else {
      ctx.sourceLines.push(`uint32_t ${spec.fnName}();`);
    }
  }
  ctx.sourceLines.push(emitBindingTable(uiBindings()));

  // 4a. List binding functions + table (from ui.bindList calls).
  for (const spec of getListBindings()) {
    emitCallbackWrapper(ctx, spec.countFnName, spec.countFnBody, spec.countStatements, spec.countSourceSpan, "()", "uint16_t");
    emitCallbackWrapper(ctx, spec.itemFnName, spec.itemFnBody, spec.itemStatements, spec.itemSourceSpan, "(uint16_t idx, char* buf, uint8_t size)", "void");
    if (spec.tapFnName && (spec.tapStatements || spec.tapFnBody)) {
      emitCallbackWrapper(ctx, spec.tapFnName, spec.tapFnBody ?? "", spec.tapStatements, spec.tapSourceSpan, "(uint16_t idx)", "void");
    }
  }
  ctx.sourceLines.push(emitListBindingTable(getListBindings()));

  // 4a'. Input binding functions + table (from ui.bindInput calls).
  for (const spec of getInputBindings()) {
    emitCallbackWrapper(ctx, spec.cbFnName, spec.cbFnBody, spec.bodyStatements, spec.sourceSpan, "(const char* text)", "void");
  }
  ctx.sourceLines.push(emitInputBindingTable(getInputBindings()));

  // 4b. Binding compute functions. Each ui.bind(node, prop, fn) records a
  // BindingSpec whose fnName is referenced by the table. v1 emits a stub that
  // returns the node's current property value — structurally valid so the
  // table compiles. Full arrow-function → C++ lowering is a follow-up.
  for (const spec of uiBindings()) {
    // If the binding has a lowered C++ expression (from the arrow body), use it;
    // otherwise fall back to returning the node's current value.
    const isTextBinding = spec.property === "text";
    if (isTextBinding) {
      // Text bindings are void fill-style: they write into (buf, size).
      // cppBody is the imperative snprintf statement from lowerTextBindingBody.
      const body = spec.cppBody ?? "buf[0] = 0;";
      ctx.sourceLines.push(
        `void ${spec.fnName}(char* buf, uint8_t size) { ${body} }`,
      );
    } else {
      const access = spec.property === "background" ? "bg" : spec.property === "color" ? "fg" : "bg";
      // Prefer the stashed ExpressionIR: render it through the strategy-aware
      // ExpressionRenderer so division promotion, modulo→fmod, and concat
      // wrapping match top-level code. Fall back to the prerendered cppExpr
      // (color-resolved via resolveColorLiterals) when no IR is available.
      if (spec.bodyIR) {
        const rendered = ctx.exprRenderer.render(spec.bodyIR);
        const prelude = ctx.exprRenderer.drainPrelude();
        // Prelude lines (e.g. __cuttlefish_str_N buffer decls for snprintf
        // expansions) must land inside the function body before the return;
        // promote char→static char so a returned buffer pointer doesn't dangle
        // (mirrors statement-renderer's return+prelude handling).
        const body = prelude.length > 0
          ? `${prelude.map((l) => l.replace(/\bchar\s+/, "static char ")).join(" ")} return ${rendered};`
          : `return ${rendered};`;
        ctx.sourceLines.push(`uint32_t ${spec.fnName}(void) { ${body} }`);
      } else {
        const body = spec.cppExpr || `__ui_nodes[${spec.nodeIndex}].${access}`;
        ctx.sourceLines.push(`uint32_t ${spec.fnName}(void) { return ${body}; }`);
      }
    }
  }

  // 5. Node count externs the runtime header references.
  const totalNodes = allLoweredUIModules().reduce(
    (sum, { lowered }) => sum + countNodes(lowered.nodeTable),
    0,
  );
  ctx.sourceLines.push(`const uint16_t __ui_node_count = ${totalNodes};`);
  ctx.sourceLines.push(`const uint16_t __ui_trans_count = ${countTransitions()};`);
  ctx.sourceLines.push(`const uint16_t __ui_binding_count = ${uiBindings().length};`);
  // Count screens across all modules (for multi-screen navigation).
  let maxScreens = 1;
  for (const { lowered } of allLoweredUIModules()) {
    if (lowered.screenCount > maxScreens) maxScreens = lowered.screenCount;
  }
  ctx.sourceLines.push(`const uint16_t __ui_screen_count = ${maxScreens};`);

  // 6. Press/release handler functions (from screen.btn.onPress/onRelease).
  // Each calls ui_on_press/ui_on_release(nodeIndex), defined in the runtime
  // header. The attachInterrupt calls that wire these to pins are injected
  // into setup() by the entrypoint synthesizer.
  for (const pb of uiPressBindings()) {
    const fn = pb.edge === "press" ? "ui_on_press" : "ui_on_release";
    ctx.sourceLines.push(`void ${pb.handlerName}() { ${fn}(${pb.nodeIndex}); }`);
  }

  // 7. Pin-watcher callbacks + table (from ui.watchPin(pin, callback)).
  // Each callback is a plain function; the runtime's ui_poll_inputs() calls it
  // on falling edge. No async runtime needed — runs in the main loop frame.
  for (const wp of watchPinSpecs()) {
    emitCallbackWrapper(ctx, wp.fnName, wp.callbackBody, wp.bodyStatements, wp.sourceSpan);
  }
  if (watchPinSpecs().length > 0) {
    ctx.sourceLines.push(`UIPinWatch __ui_pin_watches[] = {`);
    for (const wp of watchPinSpecs()) {
      ctx.sourceLines.push(`  { .pin=${wp.pin}, .lastState=1, .cb=${wp.fnName} },`);
    }
    ctx.sourceLines.push(`};`);
    ctx.sourceLines.push(`const uint16_t __ui_pin_watch_count = ${watchPinSpecs().length};`);
  } else {
    ctx.sourceLines.push(`UIPinWatch __ui_pin_watches[] = {};`);
    ctx.sourceLines.push(`const uint16_t __ui_pin_watch_count = 0;`);
  }

  // 8. Touch: handler functions + tables (click, hold, release).
  // "change" (input commit) and "rangechange" (slider drag) are emitted
  // separately in 8b/8c — they have their own dispatch points.
  const touchHandlers = clickHandlers().filter(h => h.kind !== "change" && h.kind !== "rangechange");
  const maxIdx = touchHandlers.reduce((max, h) => Math.max(max, h.nodeIndex), -1);
  const tableSize = Math.max(maxIdx + 1, 1);

  // Forward-declare named-ref handlers (on:* attributes) BEFORE the handler
  // tables — the table references these author-declared functions by name, but
  // their definitions are emitted later (in the author-function section). The
  // general transpiler's own forward declarations land after the UI tables, so
  // without these the table's reference is out of scope.
  for (const ch of touchHandlers) {
    if (ch.isNamedRef) {
      ctx.sourceLines.push(`void ${ch.fnName}();`);
    }
  }

  // Handler functions (skip named-ref handlers — their function is the author's
  // own exported function, already emitted by the general transpiler pipeline).
  for (const ch of touchHandlers) {
    if (ch.isNamedRef) continue;
    emitCallbackWrapper(ctx, ch.fnName, ch.callbackBody, ch.bodyStatements, ch.sourceSpan);
  }

  // Build lookup tables (null for nodes without handlers)
  const buildTable = (kind: "click" | "hold" | "release"): string => {
    const entries: string[] = [];
    for (let i = 0; i < tableSize; i++) {
      const handler = clickHandlers().find(h => h.nodeIndex === i && h.kind === kind);
      entries.push(handler ? handler.fnName : "nullptr");
    }
    return entries.join(", ");
  };

  // Per-table counts: the runtime indexes each table by node, so the safe
  // bound for dispatch is each table's own highest populated index + 1 — not
  // the shared click-table size (holds/releases can span fewer nodes).
  const tableCount = (kind: "click" | "hold" | "release"): number => {
    const max = touchHandlers
      .filter(h => h.kind === kind)
      .reduce((m, h) => Math.max(m, h.nodeIndex), -1);
    return Math.max(max + 1, 1);
  };

  // The handler tables are link-time constants (function pointers only) and
  // are never written at runtime — emit them const so they land in flash
  // rodata instead of stealing DRAM (~4.5KB on a 380-node demo).
  if (profile.touch) {
    ctx.sourceLines.push(`void (*const __ui_click_handlers[])() = { ${buildTable("click")} };`);
    ctx.sourceLines.push(`void (*const __ui_hold_handlers[])() = { ${buildTable("hold")} };`);
    ctx.sourceLines.push(`void (*const __ui_release_handlers[])() = { ${buildTable("release")} };`);
    ctx.sourceLines.push(`const uint16_t __ui_click_handler_count = ${tableSize};`);
    ctx.sourceLines.push(`const uint16_t __ui_hold_handler_count = ${tableCount("hold")};`);
    ctx.sourceLines.push(`const uint16_t __ui_release_handler_count = ${tableCount("release")};`);
  } else {
    ctx.sourceLines.push(`void (*const __ui_click_handlers[])() = {};`);
    ctx.sourceLines.push(`void (*const __ui_hold_handlers[])() = {};`);
    ctx.sourceLines.push(`void (*const __ui_release_handlers[])() = {};`);
    ctx.sourceLines.push(`const uint16_t __ui_click_handler_count = 0;`);
    ctx.sourceLines.push(`const uint16_t __ui_hold_handler_count = 0;`);
    ctx.sourceLines.push(`const uint16_t __ui_release_handler_count = 0;`);
  }

  // 8b. Input onChange dispatch — assigns __ui_kb_onchange based on __ui_kb_target.
  // Forward-declare __ui_kb_set_onchange unconditionally: the runtime header's
  // keyboard-open function (emitted earlier) calls it, and on native (single
  // TU) the definition below would be too late.
  ctx.sourceLines.push(`void __ui_kb_set_onchange();`);
  const inputChangeHandlers = clickHandlers().filter(h => h.kind === "change");
  if (inputChangeHandlers.length > 0) {
    // Forward-declare named-ref onChange handlers before the dispatch wiring.
    for (const h of inputChangeHandlers) {
      if (h.isNamedRef) ctx.sourceLines.push(`void ${h.fnName}();`);
    }
    for (const h of inputChangeHandlers) {
      if (h.isNamedRef) continue;  // author's own function; no wrapper.
      emitCallbackWrapper(ctx, h.fnName, h.callbackBody, h.bodyStatements, h.sourceSpan);
    }
    ctx.sourceLines.push(`void __ui_kb_set_onchange() {`);
    ctx.sourceLines.push(`  __ui_kb_onchange = nullptr;`);
    for (const h of inputChangeHandlers) {
      ctx.sourceLines.push(`  if (__ui_kb_target == ${h.nodeIndex}) __ui_kb_onchange = ${h.fnName};`);
    }
    ctx.sourceLines.push(`}`);
  } else {
    ctx.sourceLines.push(`void __ui_kb_set_onchange() { __ui_kb_onchange = nullptr; }`);
  }

  // 8c. Range onChange dispatch — per-node handler table fired from the slider
  // drag loop on every value change. Mirrors the click/hold/release tables.
  const rangeChangeHandlers = clickHandlers().filter(h => h.kind === "rangechange");
  const rcMaxIdx = rangeChangeHandlers.reduce((max, h) => Math.max(max, h.nodeIndex), -1);
  const rcTableSize = Math.max(rcMaxIdx + 1, 1);
  for (const h of rangeChangeHandlers) {
    emitCallbackWrapper(ctx, h.fnName, h.callbackBody, h.bodyStatements, h.sourceSpan);
  }
  if (profile.touch && rangeChangeHandlers.length > 0) {
    const rcEntries: string[] = [];
    for (let i = 0; i < rcTableSize; i++) {
      const handler = rangeChangeHandlers.find(h => h.nodeIndex === i);
      rcEntries.push(handler ? handler.fnName : "nullptr");
    }
    ctx.sourceLines.push(`void (*__ui_rangechange_handlers[])() = { ${rcEntries.join(", ")} };`);
    ctx.sourceLines.push(`const uint16_t __ui_rangechange_handler_count = ${rcTableSize};`);
  } else {
    ctx.sourceLines.push(`void (*__ui_rangechange_handlers[])() = {};`);
    ctx.sourceLines.push(`const uint16_t __ui_rangechange_handler_count = 0;`);
  }

  // 9. Radio group table (from auto-wire).
  const radioGroups = getRadioGroups();
  if (radioGroups.size > 0) {
    const groupEntries = Array.from(radioGroups.entries()) as Array<[string, Array<{ id: string; nodeIndex: number }>]>;
    ctx.sourceLines.push(`UIRadioGroup __ui_radio_groups[] = {`);
    for (const [, members] of groupEntries) {
      const indices = members.map((m: { nodeIndex: number }) => m.nodeIndex).join(", ");
      ctx.sourceLines.push(`  { .nodeIndices={${indices}}, .count=${members.length} },`);
    }
    ctx.sourceLines.push(`};`);
    ctx.sourceLines.push(`const uint16_t __ui_radio_group_count = ${groupEntries.length};`);
  } else {
    ctx.sourceLines.push(`UIRadioGroup __ui_radio_groups[] = {};`);
    ctx.sourceLines.push(`const uint16_t __ui_radio_group_count = 0;`);
  }

  // 10. Canvas draw bindings (ui.drawCanvas). Each spec emits a draw wrapper
  // that runs the lowered callback body against the node's offscreen canvas.
  emitCanvasBindings(
    canvasBindings(),
    (line, span) => {
      appendSourceLine(ctx, line, span ? { tsSpan: span, nodeKind: "ui-canvas-callback" } : undefined);
    },
    (statements, indent) => {
      const scope = createChildEmissionScope(createEmissionScopeState());
      for (const stmt of statements) {
        appendRenderedStatement(ctx, stmt, indent, scope);
      }
    },
  );
}

/** Emit a synthesized callback wrapper. When bodyStatements is present, each
 *  statement is rendered through StatementRenderer (same path setInterval /
 *  free functions use). Falls back to pasting callbackBody for auto-wire /
 *  legacy string-baked specs. Skipped by callers for isNamedRef handlers. */
function emitCallbackWrapper(
  ctx: EmitterContext,
  fnName: string,
  callbackBody: string,
  bodyStatements: StatementIR[] | undefined,
  sourceSpan: SourceSpan | undefined,
  signature = "()",
  returnType = "void",
): void {
  const mapEntry = sourceSpan
    ? { tsSpan: sourceSpan, nodeKind: "ui-callback", symbolName: fnName }
    : undefined;
  if (bodyStatements && bodyStatements.length > 0) {
    appendSourceLine(ctx, `${returnType} ${fnName}${signature} {`, mapEntry);
    const scope = createChildEmissionScope(createEmissionScopeState());
    for (const stmt of bodyStatements) {
      appendRenderedStatement(ctx, stmt, "  ", scope);
    }
    appendSourceLine(ctx, `}`);
    return;
  }
  appendSourceLine(ctx, `${returnType} ${fnName}${signature} { ${callbackBody || ""} }`, mapEntry);
}

/** Count NODE_FILL/NODE_TEXT entries in the emitted node table (one per node). */
function countNodes(nodeTable: string): number {
  // Count node-table entries directly. Every node initializer starts with
  // "{ .box="; counting those cannot under/over-count regardless of kind (the
  // previous kind-regex approach missed NODE_CANVAS and any future kind,
  // undercounting __ui_node_count so the last node(s) were never drawn).
  const matches = nodeTable.match(/\{\s*\.box=/g);
  return matches ? matches.length : 0;
}

/** Count armed transitions across all modules. */
function countTransitions(): number {
  let count = 0;
  for (const { lowered } of requireUIHook().allLoweredUIModules()) {
    const matches = lowered.transitionTable.match(/\.durationMs=/g);
    count += matches ? matches.length : 0;
  }
  return count;
}
