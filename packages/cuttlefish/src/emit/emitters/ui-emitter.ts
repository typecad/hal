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
import { emitRuntimeHeader } from "../../ui/runtime-header.js";
import { allLoweredUIModules, entryHasUI } from "../../ui/ui-registry.js";
import { uiSignalDecls, uiBindings, uiPressBindings, watchPinSpecs, clickHandlers } from "../../ir/transformers/ui-call-resolver.js";
import { emitBindingTable, emitListBindings, getListBindings, emitInputBindings, getInputBindings } from "../../ir/transformers/ui-reactive.js";
import { emitCanvasBindings, canvasBindings } from "../../ir/transformers/canvas-lowering.js";
import { getDisplayProfile } from "../../ui/display-profile-store.js";
import { generateTouchAdapter, TouchAdapterCodegen, resolveScrollConfig } from "../../api/shared/display-profile.js";
import { generateDisplayAdapter } from "../../api/shared/display-adapter.js";
import { getRadioGroups } from "../../ir/ui-element-auto-wire.js";

export function emitUIRuntime(ctx: EmitterContext): void {
  // Only the entry file carries the UI runtime + tables.
  if (!ctx.isEntryFile || !entryHasUI()) return;

  // 0. The display driver (ILI9341 over SPI) needs the SPI library. Includes
  // are gathered at preamble time; push this so it lands at file top.
  if (!ctx.includes.includes("<SPI.h>")) {
    ctx.includes.push("<SPI.h>");
  }
  // NOTE: <stdio.h> (needed by text-binding snprintf bodies) is pushed in
  // buildEmitterContext (setup.ts), NOT here — emitPreamble runs before this
  // function, so a push here would be too late to land in the output.

  // 0.5. Display adapter: includes + object declaration + inline functions.
  // Generated per display driver type (ILI9341, ST7789, etc.) via the
  // display-adapter registry. Must precede the runtime header so the
  // adapter functions (__tc_display, display_init, etc.) are available.
  const profile = getDisplayProfile();
  if (profile) {
    const adapter = generateDisplayAdapter(profile);
    // Prepend includes to the very front — Arduino's auto-prototyper scans
    // the whole .ino and generates prototypes that reference GFXcanvas16
    // etc. before any #include, so the GFX header must come first.
    ctx.sourceLines.unshift(adapter.includes);
    ctx.sourceLines.push(adapter.declaration);
    ctx.sourceLines.push(adapter.functions);
  }

  // 0.6. Touch adapter: includes + declaration (zero-cost, transpile-time).
  // Same pattern as the display adapter — generated inline C++ per library type.
  let touchAdapter: TouchAdapterCodegen | null = null;
  if (profile.touch) {
    const t = profile.touch;
    if (t.library) {
      touchAdapter = generateTouchAdapter(t);
      // Prepend includes to the front (Arduino auto-prototyper safety).
      ctx.sourceLines.unshift(touchAdapter.includes[0]);
      for (let i = 1; i < touchAdapter.includes.length; i++) {
        ctx.sourceLines.push(touchAdapter.includes[i]);
      }
      ctx.sourceLines.push(touchAdapter.declaration);
      ctx.sourceLines.push(touchAdapter.functions);
    }
  }

  // Forward declaration for touch poll (used inside the runtime header's ui_tick)
  if (profile.touch) {
    ctx.sourceLines.push("void ui_poll_touch();");
  }

  // 1. Runtime header (structs + helpers, guarded so repeat emission is safe).
  //    Emit the antialiasing compile-time flag before the header so the AA
  //    code paths are compiled in.
  const loweredModules = allLoweredUIModules();
  const needsAntialias = profile.antialias || loweredModules.some(({ lowered }) => lowered.nodeTable.includes(".fontAntialias=1"));
  if (needsAntialias) {
    ctx.sourceLines.push("#define UI_AA 1");
  }
  // 1b. Scroll capability + physics overrides — emitted BEFORE the runtime
  //     header so its #ifndef guards adopt them. Source of truth:
  //     resolveScrollConfig(profile.scroll). Defaults derive from the declared
  //     touch hardware, so the demo (XPT2046) gets resistive+full with no config.
  const scroll = resolveScrollConfig(profile);
  ctx.sourceLines.push(
    `#define UI_SCROLL_MAX_OVERSCROLL ${scroll.maxOverscroll}`,
    `#define UI_SCROLL_STIFFNESS_X10 ${Math.round(scroll.stiffness * 10)}`,
    `#define UI_SCROLL_EDGE_SNAP_PX ${scroll.edgeSnapPx}`,
    `#define UI_SCROLL_INPUT_TIER_CAPACITIVE ${scroll.inputTier === "capacitive" ? 1 : 0}`,
    `#define UI_SCROLL_INPUT_TIER_RESISTIVE ${scroll.inputTier === "resistive" ? 1 : 0}`,
    `#define UI_SCROLL_INPUT_TIER_NONE ${scroll.inputTier === "none" ? 1 : 0}`,
    `#define UI_SCROLL_RENDER_TIER_FULL ${scroll.renderTier === "full" ? 1 : 0}`,
    `#define UI_SCROLL_RENDER_TIER_CONSTRAINED ${scroll.renderTier === "constrained" ? 1 : 0}`,
  );
  ctx.sourceLines.push(emitRuntimeHeader());

  // 1.5. Touch poll function (uses the adapter pattern).
  if (profile.touch && touchAdapter) {
    const t = profile.touch;
    const minPress = t.minPressure ?? 10;
    const { xMin, xMax, yMin, yMax } = t.calibration;
    const isLandscape = profile.rotation === 1 || profile.rotation === 3;
    const invertX = profile.rotation === 1 || profile.rotation === 2;
    const invertY = profile.rotation === 1 || profile.rotation === 2;
    let mapX, mapY;
    if (isLandscape) {
      mapX = invertX
        ? `map(__rawX, ${xMin}, ${xMax}, ${profile.width}, 0)`
        : `map(__rawX, ${xMin}, ${xMax}, 0, ${profile.width})`;
      mapY = invertY
        ? `map(__rawY, ${yMin}, ${yMax}, ${profile.height}, 0)`
        : `map(__rawY, ${yMin}, ${yMax}, 0, ${profile.height})`;
    } else {
      mapX = `map(__rawY, ${yMin}, ${yMax}, ${profile.width}, 0)`;
      mapY = `map(__rawX, ${xMin}, ${xMax}, 0, ${profile.height})`;
    }
    const pollLines = [
      `void ui_poll_touch() {`,
      `  if (touch_isTouched()) {`,
      `    int16_t __rawX = 0, __rawY = 0, __rawZ = 0;`,
      `    touch_readRaw(&__rawX, &__rawY, &__rawZ);`,
      `    if (__rawZ >= ${minPress}) {`,
      `      int16_t __tx = ${mapX};`,
      `      int16_t __ty = ${mapY};`,
      `      ui_handle_touch(__tx, __ty);`,
      `    } else {`,
      `      ui_handle_no_touch();`,
      `    }`,
      `  } else {`,
      `    ui_handle_no_touch();`,
      `  }`,
      `}`,
    ];
    ctx.sourceLines.push(pollLines.join("\n"));
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
  for (const decl of uiSignalDecls()) {
    ctx.sourceLines.push(decl);
  }

  // 4. Binding table (accumulated from ui.bind calls).
  ctx.sourceLines.push(emitBindingTable(uiBindings()));

  // 4a. List binding table + functions (from ui.bindList calls).
  ctx.sourceLines.push(emitListBindings(getListBindings()));

  // 4a'. Input binding table + functions (from ui.bindInput calls).
  ctx.sourceLines.push(emitInputBindings(getInputBindings()));

  // 4b. Binding compute functions. Each ui.bind(node, prop, fn) records a
  // BindingSpec whose fnName is referenced by the table. v1 emits a stub that
  // returns the node's current property value — structurally valid so the
  // table compiles. Full arrow-function → C++ lowering is a follow-up.
  for (const spec of uiBindings()) {
    const access = spec.property === "background" ? "bg"
      : spec.property === "color" ? "fg"
      : spec.property === "borderColor" ? "borderColor"
      : "0";
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
      const body = spec.cppExpr || `__ui_nodes[${spec.nodeIndex}].${access}`;
      ctx.sourceLines.push(
        `uint16_t ${spec.fnName}(void) { return ${body}; }`,
      );
    }
  }

  // 5. Node count externs the runtime header references.
  const totalNodes = allLoweredUIModules().reduce(
    (sum, { lowered }) => sum + countNodes(lowered.nodeTable),
    0,
  );
  ctx.sourceLines.push(`const uint8_t __ui_node_count = ${totalNodes};`);
  ctx.sourceLines.push(`const uint8_t __ui_trans_count = ${countTransitions()};`);
  ctx.sourceLines.push(`const uint8_t __ui_binding_count = ${uiBindings().length};`);
  // Count screens across all modules (for multi-screen navigation).
  let maxScreens = 1;
  for (const { lowered } of allLoweredUIModules()) {
    if (lowered.screenCount > maxScreens) maxScreens = lowered.screenCount;
  }
  ctx.sourceLines.push(`const uint8_t __ui_screen_count = ${maxScreens};`);

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
    ctx.sourceLines.push(`void ${wp.fnName}() { ${wp.callbackBody || ""} }`);
  }
  if (watchPinSpecs().length > 0) {
    ctx.sourceLines.push(`UIPinWatch __ui_pin_watches[] = {`);
    for (const wp of watchPinSpecs()) {
      ctx.sourceLines.push(`  { .pin=${wp.pin}, .lastState=1, .cb=${wp.fnName} },`);
    }
    ctx.sourceLines.push(`};`);
    ctx.sourceLines.push(`const uint8_t __ui_pin_watch_count = ${watchPinSpecs().length};`);
  } else {
    ctx.sourceLines.push(`UIPinWatch __ui_pin_watches[] = {};`);
    ctx.sourceLines.push(`const uint8_t __ui_pin_watch_count = 0;`);
  }

  // 8. Touch: handler functions + tables (click, hold, release).
  // "change" (input commit) and "rangechange" (slider drag) are emitted
  // separately in 8b/8c — they have their own dispatch points.
  const touchHandlers = clickHandlers().filter(h => h.kind !== "change" && h.kind !== "rangechange");
  const maxIdx = touchHandlers.reduce((max, h) => Math.max(max, h.nodeIndex), -1);
  const tableSize = Math.max(maxIdx + 1, 1);

  // Handler functions
  for (const ch of touchHandlers) {
    ctx.sourceLines.push(`void ${ch.fnName}() { ${ch.callbackBody || ""} }`);
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

  if (profile.touch) {
    ctx.sourceLines.push(`void (*__ui_click_handlers[])() = { ${buildTable("click")} };`);
    ctx.sourceLines.push(`void (*__ui_hold_handlers[])() = { ${buildTable("hold")} };`);
    ctx.sourceLines.push(`void (*__ui_release_handlers[])() = { ${buildTable("release")} };`);
    ctx.sourceLines.push(`const uint8_t __ui_click_handler_count = ${tableSize};`);
  } else {
    ctx.sourceLines.push(`void (*__ui_click_handlers[])() = {};`);
    ctx.sourceLines.push(`void (*__ui_hold_handlers[])() = {};`);
    ctx.sourceLines.push(`void (*__ui_release_handlers[])() = {};`);
    ctx.sourceLines.push(`const uint8_t __ui_click_handler_count = 0;`);
  }

  // 8b. Input onChange dispatch — assigns __ui_kb_onchange based on __ui_kb_target.
  const inputChangeHandlers = clickHandlers().filter(h => h.kind === "change");
  if (inputChangeHandlers.length > 0) {
    for (const h of inputChangeHandlers) {
      ctx.sourceLines.push(`void ${h.fnName}() { ${h.callbackBody || ""} }`);
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
    ctx.sourceLines.push(`void ${h.fnName}() { ${h.callbackBody || ""} }`);
  }
  if (profile.touch && rangeChangeHandlers.length > 0) {
    const rcEntries: string[] = [];
    for (let i = 0; i < rcTableSize; i++) {
      const handler = rangeChangeHandlers.find(h => h.nodeIndex === i);
      rcEntries.push(handler ? handler.fnName : "nullptr");
    }
    ctx.sourceLines.push(`void (*__ui_rangechange_handlers[])() = { ${rcEntries.join(", ")} };`);
    ctx.sourceLines.push(`const uint8_t __ui_rangechange_handler_count = ${rcTableSize};`);
  } else {
    ctx.sourceLines.push(`void (*__ui_rangechange_handlers[])() = {};`);
    ctx.sourceLines.push(`const uint8_t __ui_rangechange_handler_count = 0;`);
  }

  // 9. Radio group table (from auto-wire).
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
    ctx.sourceLines.push(`const uint8_t __ui_radio_group_count = ${groupEntries.length};`);
  } else {
    ctx.sourceLines.push(`UIRadioGroup __ui_radio_groups[] = {};`);
    ctx.sourceLines.push(`const uint8_t __ui_radio_group_count = 0;`);
  }

  // 10. Canvas draw bindings (ui.drawCanvas). Each spec emits a draw wrapper
  // that runs the lowered callback body against the node's offscreen canvas.
  ctx.sourceLines.push(emitCanvasBindings(canvasBindings()));
}

/** Count NODE_FILL/NODE_TEXT entries in the emitted node table (one per node). */
function countNodes(nodeTable: string): number {
  const matches = nodeTable.match(/NODE_(FILL|TEXT|BUTTON|CHECK|RADIO|PROGRESS|RANGE|INPUT|IMG|LIST)/g);
  return matches ? matches.length : 0;
}

/** Count armed transitions across all modules. */
function countTransitions(): number {
  let count = 0;
  for (const { lowered } of allLoweredUIModules()) {
    const matches = lowered.transitionTable.match(/\.durationMs=/g);
    count += matches ? matches.length : 0;
  }
  return count;
}
