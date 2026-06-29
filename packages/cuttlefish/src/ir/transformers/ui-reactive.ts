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
    case "value": return "PROP_VALUE";
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

// ── List bindings ────────────────────────────────────────────────────────────
export interface ListBindingSpec {
  nodeIndex: number;
  countFnName: string;   // C++ function: uint16_t fn(void)
  itemFnName: string;    // C++ function: void fn(uint16_t idx, char* buf, uint8_t size)
  tapFnName: string | null;   // C++ function: void fn(uint16_t idx) — null if no tap callback
  countFnBody: string;   // lowered C++ body for the count function
  itemFnBody: string;    // lowered C++ body for the item function
  tapFnBody: string | null;   // lowered C++ body for tap, or null
}

const listBindings: ListBindingSpec[] = [];
export function recordListBinding(spec: ListBindingSpec): void {
  listBindings.push(spec);
}
export function getListBindings(): ListBindingSpec[] {
  return listBindings;
}
export function getListBindingsCount(): number {
  return listBindings.length;
}
export function resetListBindings(): void {
  listBindings.length = 0;
}

// ── Input bindings (two-way) ─────────────────────────────────────────────────
// ui.bindInput(node, (text) => { ... }) — fires the callback whenever the
// bound <input> node's textBuffer changes (e.g. the user typed via the
// on-screen keyboard). Mirrors the list-binding tap-callback pattern.
export interface InputBindingSpec {
  nodeIndex: number;
  cbFnName: string;   // C++ function: void fn(const char* text)
  cbFnBody: string;   // lowered C++ body for the callback
}

const inputBindings: InputBindingSpec[] = [];
export function recordInputBinding(spec: InputBindingSpec): void {
  inputBindings.push(spec);
}
export function getInputBindings(): InputBindingSpec[] {
  return inputBindings;
}
export function getInputBindingsCount(): number {
  return inputBindings.length;
}
export function resetInputBindings(): void {
  inputBindings.length = 0;
}

/** Emit the input-binding table + callback functions. */
export function emitInputBindings(specs: InputBindingSpec[]): string {
  if (specs.length === 0) {
    return `UIInputBinding __ui_input_bindings[] = {};\nconst uint16_t __ui_input_binding_count = 0;`;
  }
  const lines: string[] = [];
  // Emit the callback functions.
  for (const spec of specs) {
    lines.push(`void ${spec.cbFnName}(const char* text) { ${spec.cbFnBody} }`);
  }
  // Emit the binding table.
  lines.push(`UIInputBinding __ui_input_bindings[] = {`);
  for (const spec of specs) {
    lines.push(`  { .node=${spec.nodeIndex}, .cb=${spec.cbFnName} },`);
  }
  lines.push(`};`);
  lines.push(`const uint16_t __ui_input_binding_count = ${specs.length};`);
  return lines.join("\n");
}
export function emitListBindings(specs: ListBindingSpec[]): string {
  if (specs.length === 0) {
    return `UIListBinding __ui_list_bindings[] = {};\nconst uint16_t __ui_list_binding_count = 0;`;
  }
  const lines: string[] = [];
  // Emit count + item + tap functions.
  for (const spec of specs) {
    lines.push(`uint16_t ${spec.countFnName}() { ${spec.countFnBody} }`);
    lines.push(`void ${spec.itemFnName}(uint16_t idx, char* buf, uint8_t size) { ${spec.itemFnBody} }`);
    if (spec.tapFnName && spec.tapFnBody) {
      lines.push(`void ${spec.tapFnName}(uint16_t idx) { ${spec.tapFnBody} }`);
    }
  }
  // Emit the binding table.
  lines.push(`UIListBinding __ui_list_bindings[] = {`);
  for (const spec of specs) {
    const tap = spec.tapFnName && spec.tapFnBody ? spec.tapFnName : "nullptr";
    lines.push(`  { .node=${spec.nodeIndex}, .countFn=${spec.countFnName}, .itemFn=${spec.itemFnName}, .tapFn=${tap} },`);
  }
  lines.push(`};`);
  lines.push(`const uint16_t __ui_list_binding_count = ${specs.length};`);
  return lines.join("\n");
}
