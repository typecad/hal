import { describe, it, expect } from "vitest";
import {
  emitSignalDecl,
  emitBindingEntry,
  emitBindingTable,
  BindingSpec,
} from "@typecad/cuttlefish/ir/transformers/ui-reactive";

describe("reactive lowering", () => {
  it("emits a signal as a device variable", () => {
    const decl = emitSignalDecl("temp", "int", 22);
    expect(decl).toMatch(/int\s+temp\s*=\s*22/);
  });

  it("emits a binding entry with node index, property enum, and fn ptr", () => {
    const spec: BindingSpec = { nodeIndex: 1, property: "text", fnName: "__ui_bind_temp_text" };
    const entry = emitBindingEntry(spec);
    expect(entry).toContain("1");
    expect(entry).toContain("PROP_TEXT");
    expect(entry).toContain("__ui_bind_temp_text");
  });

  it("maps background/color properties to PROP_BG/PROP_FG", () => {
    expect(emitBindingEntry({ nodeIndex: 0, property: "background", fnName: "f" })).toContain("PROP_BG");
    expect(emitBindingEntry({ nodeIndex: 0, property: "color", fnName: "f" })).toContain("PROP_FG");
  });

  it("maps visible bindings to PROP_VISIBLE", () => {
    expect(emitBindingEntry({ nodeIndex: 0, property: "visible", fnName: "f" })).toContain("PROP_VISIBLE");
  });

  it("emits a full binding table from a spec list", () => {
    const table = emitBindingTable([
      { nodeIndex: 1, property: "text", fnName: "f1" },
      { nodeIndex: 2, property: "background", fnName: "f2" },
    ]);
    expect(table).toContain("UIBinding");
    expect(table).toContain("f1");
    expect(table).toContain("f2");
  });

  it("emits an empty binding table when no bindings", () => {
    const table = emitBindingTable([]);
    expect(table).toMatch(/UIBinding\s+__ui_bindings\[\]\s*=/);
  });

  it("a text BindingSpec with cppBody still wires .textFn in the table entry", () => {
    const spec: BindingSpec = {
      nodeIndex: 1,
      property: "text",
      fnName: "__ui_bind_text_0",
      cppBody: `snprintf(buf, size, "%d", count);`,
    };
    const entry = emitBindingEntry(spec);
    expect(entry).toContain(".textFn=__ui_bind_text_0");
    expect(entry).toContain("PROP_TEXT");
  });
});
