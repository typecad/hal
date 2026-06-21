// ---------------------------------------------------------------------------
// Reactive lowering — ui.signal / ui.bind → C++ device variables + binding table.
//
// A signal lowers to a plain variable (with an initial value). A bind lowers
// to a UIBinding entry: { nodeIndex, property, fn_ptr }. The runtime evaluates
// each binding each tick; if the computed value differs from the node's current
// value, the node is marked dirty (and the transition armed if applicable).
//
// The compute functions (fn_ptr) are emitted as free C++ functions that return
// the property value, generated from the author's arrow-function bodies.
// ---------------------------------------------------------------------------

export interface BindingSpec {
  nodeIndex: number;
  property: string;
  fnName: string;
  /** The C++ expression for the color-binding compute function (v1: may be
   *  empty if the arrow body couldn't be lowered; the emitter falls back to
   *  returning the node's current value). */
  cppExpr?: string;
  /** The imperative C++ statement body for a text binding (e.g.
   *  `snprintf(buf, size, "%d", count);`). Mutually exclusive with cppExpr:
   *  text bindings use cppBody, color bindings use cppExpr. */
  cppBody?: string;
}

/** Emit a signal as a device variable declaration. */
export function emitSignalDecl(name: string, cppType: string, initialValue: number | string | boolean): string {
  const val = typeof initialValue === "string" ? `"${initialValue}"` : `${initialValue}`;
  return `${cppType} ${name} = ${val};`;
}

/** Map a bind property name to the runtime property enum. */
function propEnum(property: string): string {
  switch (property) {
    case "background": return "PROP_BG";
    case "color": return "PROP_FG";
    case "text": return "PROP_TEXT";
    case "visible": return "PROP_VISIBLE";
    case "borderColor": return "PROP_BORDER_COLOR";
    default: return `PROP_${property.toUpperCase()}`;
  }
}

/** Emit a single binding-table entry line. */
export function emitBindingEntry(spec: BindingSpec): string {
  // Text bindings wire to textFn (void fill-style); color bindings wire to fn.
  if (spec.property === "text") {
    return `  { .node=${spec.nodeIndex}, .prop=${propEnum(spec.property)}, .fn=nullptr, .textFn=${spec.fnName} },`;
  }
  return `  { .node=${spec.nodeIndex}, .prop=${propEnum(spec.property)}, .fn=${spec.fnName}, .textFn=nullptr },`;
}

/** Emit a full binding table from a list of specs. */
export function emitBindingTable(specs: BindingSpec[]): string {
  if (specs.length === 0) return `UIBinding __ui_bindings[] = {};`;
  return [
    `UIBinding __ui_bindings[] = {`,
    ...specs.map(emitBindingEntry),
    `};`,
  ].join("\n");
}
