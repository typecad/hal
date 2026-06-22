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
import { emitBindingTable } from "../../ir/transformers/ui-reactive.js";
import { getDisplayProfile } from "../../ui/display-profile-store.js";

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

  // 0.5. File-scope display object declaration. Must precede the runtime header
  // so ui_tick (a static inline in the header) can reference __tc_display.
  // Uses the 3-arg HARDWARE SPI constructor (CS, DC, RST) with VSPI defaults.
  const profile = getDisplayProfile();
  ctx.sourceLines.push(`Adafruit_ILI9341 __tc_display = Adafruit_ILI9341(${profile._mountCs}, ${profile._mountDc}, ${profile._mountRst});`);

  // 0.6. Touch controller declaration (if touch is configured in the profile).
  if (profile.touch) {
    const t = profile.touch;
    // Emit include as a raw line (ctx.includes is processed at preamble time — too late)
    if (t.library === "XPT2046_Touchscreen") {
      ctx.sourceLines.push(`#include <XPT2046_Touchscreen.h>`);
      ctx.sourceLines.push(`XPT2046_Touchscreen __tc_touch(${t.cs ?? 3});`);
    } else if (t.library === "Adafruit_TouchScreen" && t.analogPins) {
      ctx.includes.push("<TouchScreen.h>");
      const a = t.analogPins;
      ctx.sourceLines.push(`TouchScreen __tc_touch = TouchScreen(${a.xp}, ${a.yp}, ${a.xm}, ${a.ym}, ${a.rx});`);
    } else if (t.library === "Adafruit_STMPE610") {
      ctx.includes.push("<Adafruit_STMPE610.h>");
      if (t.interface === "i2c") {
        ctx.sourceLines.push(`Adafruit_STMPE610 __tc_touch(${t.cs ?? 0x41});`);
      } else {
        ctx.sourceLines.push(`Adafruit_STMPE610 __tc_touch(${t.cs ?? 3});`);
      }
    }
  }

  // Forward declaration for touch poll (used inside the runtime header's ui_tick)
  if (profile.touch) {
    ctx.sourceLines.push("void ui_poll_touch();");
  }

  // 1. Runtime header (structs + helpers, guarded so repeat emission is safe).
  ctx.sourceLines.push(emitRuntimeHeader());

  // 1.5. Touch poll function (library-specific, emitted at file scope).
  if (profile.touch) {
    const t = profile.touch;
    const minPress = t.minPressure ?? 10;
    const { xMin, xMax, yMin, yMax } = t.calibration;
    const pollLines = [
      `void ui_poll_touch() {`,
      `  if (__tc_touch.touched()) {`,
      `    TS_Point __tp = __tc_touch.getPoint();`,
      `    int16_t __tx = map(__tp.x, ${xMin}, ${xMax}, 0, ${profile.width});`,
      `    int16_t __ty = map(__tp.y, ${yMin}, ${yMax}, 0, ${profile.height});`,
      `    if (__tp.z >= ${minPress}) { ui_handle_touch(__tx, __ty); }`,
      `  }`,
      `}`,
    ];
    ctx.sourceLines.push(pollLines.join("\n"));
  }

  // 2. Static node + transition tables for every mounted UI tree.
  for (const { lowered } of allLoweredUIModules()) {
    ctx.sourceLines.push(lowered.nodeTable);
    ctx.sourceLines.push(lowered.transitionTable);
  }

  // 3. Signal variables (one per ui.signal / const X = ui.signal).
  for (const decl of uiSignalDecls()) {
    ctx.sourceLines.push(decl);
  }

  // 4. Binding table (accumulated from ui.bind calls).
  ctx.sourceLines.push(emitBindingTable(uiBindings()));

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

  // 8. Touch: click handler functions + table (from screen.element.onClick).
  if (profile.touch && clickHandlers().length > 0) {
    // Click handler functions
    for (const ch of clickHandlers()) {
      ctx.sourceLines.push(`void ${ch.fnName}() { ${ch.callbackBody || ""} }`);
    }
    // Click handler lookup table: array of function pointers, indexed by node index.
    // null for nodes without click handlers.
    const maxIdx = clickHandlers().reduce((max, h) => Math.max(max, h.nodeIndex), -1);
    const entries: string[] = [];
    for (let i = 0; i <= maxIdx; i++) {
      const handler = clickHandlers().find(h => h.nodeIndex === i);
      entries.push(handler ? handler.fnName : "nullptr");
    }
    ctx.sourceLines.push(`const ClickHandler __ui_click_handlers[] = { ${entries.join(", ")} };`);
    ctx.sourceLines.push(`const uint8_t __ui_click_handler_count = ${maxIdx + 1};`);
  } else {
    ctx.sourceLines.push(`const ClickHandler __ui_click_handlers[] = {};`);
    ctx.sourceLines.push(`const uint8_t __ui_click_handler_count = 0;`);
  }
}

/** Count NODE_FILL/NODE_TEXT entries in the emitted node table (one per node). */
function countNodes(nodeTable: string): number {
  const matches = nodeTable.match(/NODE_(FILL|TEXT|BUTTON|CHECK)/g);
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
