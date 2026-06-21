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
import { uiSignalDecls, uiBindings, uiPressBindings, watchPinSpecs } from "../../ir/transformers/ui-call-resolver.js";
import { emitBindingTable } from "../../ir/transformers/ui-reactive.js";

export function emitUIRuntime(ctx: EmitterContext): void {
  // Only the entry file carries the UI runtime + tables.
  if (!ctx.isEntryFile || !entryHasUI()) return;

  // 0. The display driver (ILI9341 over SPI) needs the SPI library. Includes
  // are gathered at preamble time; push this so it lands at file top.
  if (!ctx.includes.includes("<SPI.h>")) {
    ctx.includes.push("<SPI.h>");
  }
  // 0b. snprintf (used by text-binding bodies) needs <stdio.h>.
  if (!ctx.includes.includes("<stdio.h>")) {
    ctx.includes.push("<stdio.h>");
  }

  // 0.5. File-scope display object declaration. Must precede the runtime header
  // so ui_tick (a static inline in the header) can reference __tc_display.
  // Uses the 3-arg HARDWARE SPI constructor (CS, DC, RST) — the ESP32's VSPI
  // bus (MOSI=23, SCK=18, MISO=19) matches the breakout wiring and runs at
  // 40MHz via the hardware peripheral. The 6-arg constructor bit-bangs GPIO
  // (software SPI) which is ~1000x slower and unusable for per-frame redraws.
  ctx.sourceLines.push("Adafruit_ILI9341 __tc_display = Adafruit_ILI9341(5, 21, 22);");

  // 1. Runtime header (structs + helpers, guarded so repeat emission is safe).
  ctx.sourceLines.push(emitRuntimeHeader());

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
    const access = spec.property === "background" ? "bg" : spec.property === "color" ? "fg" : "0";
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
}

/** Count NODE_FILL/NODE_TEXT entries in the emitted node table (one per node). */
function countNodes(nodeTable: string): number {
  const matches = nodeTable.match(/NODE_(FILL|TEXT|BUTTON)/g);
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
