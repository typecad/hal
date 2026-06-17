import { describe, it, expect } from "vitest";
import { prescanUnsupportedFeatures } from "../packages/cuttlefish/src/ir/feature-prescan";
import { parseSource } from "../packages/cuttlefish/src/ast/parse";

function prescan(sourceText: string) {
  const source = parseSource("test.ts", sourceText);
  return prescanUnsupportedFeatures(source, sourceText);
}

describe("Feature Pre-Scan", () => {
  it("returns empty diagnostics for clean TypeScript", () => {
    const diags = prescan(`const x = 42;\nconst y = "hello";\n`);
    expect(diags).toEqual([]);
  });

  it("detects tagged template expression", () => {
    const diags = prescan(`const x = tag\`hello \${world}\`;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.code === "TS2CPP_NO_EQUIVALENT" && d.message.includes("Tagged template"));
    expect(diag).toBeDefined();
    expect(diag!.hint).toContain("regular template literal");
  });

  it("detects import.meta meta property", () => {
    const diags = prescan(`const x = import.meta.url;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Meta-property"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_NO_EQUIVALENT");
  });

  it("detects new.target meta property", () => {
    const diags = prescan(`function F() { if (new.target) {} }\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Meta-property"));
    expect(diag).toBeDefined();
  });

  it("detects optional chaining", () => {
    const diags = prescan(`const x = obj?.prop;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.code === "TS2CPP_APPROXIMATE" && d.message.includes("Optional chaining"));
    expect(diag).toBeDefined();
    expect(diag!.hint).toContain("null check");
  });

  it("detects nullish coalescing", () => {
    const diags = prescan(`const x = val ?? "default";\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.code === "TS2CPP_APPROXIMATE" && d.message.includes("Nullish coalescing"));
    expect(diag).toBeDefined();
  });

  it("detects delete on plain object", () => {
    const diags = prescan(`delete obj.prop;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.code === "TS2CPP_NO_EQUIVALENT" && d.message.includes("delete"));
    expect(diag).toBeDefined();
  });

  it("detects Object.keys on non-map", () => {
    const diags = prescan(`const k = Object.keys(obj);\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Object.keys"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_NO_EQUIVALENT");
  });

  it("detects Object.values on non-map", () => {
    const diags = prescan(`const v = Object.values(obj);\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Object.values"));
    expect(diag).toBeDefined();
  });

  it("detects Object.entries on non-map", () => {
    const diags = prescan(`const e = Object.entries(obj);\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Object.entries"));
    expect(diag).toBeDefined();
  });

  it("detects multiple unsupported features in one file", () => {
    const diags = prescan(`
      const a = tag\`hello\`;
      const b = import.meta.url;
      const c = obj?.prop;
      const d = val ?? 0;
    `);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("TS2CPP_NO_EQUIVALENT");
    expect(codes).toContain("TS2CPP_APPROXIMATE");
    expect(diags.length).toBeGreaterThanOrEqual(4);
  });

  it("includes line and column in diagnostics", () => {
    const diags = prescan(`const x = tag\`hello\`;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags[0];
    expect(diag.line).toBeDefined();
    expect(diag.column).toBeDefined();
    expect(typeof diag.line).toBe("number");
    expect(typeof diag.column).toBe("number");
  });

  it("detects object spread", () => {
    const diags = prescan(`const merged = { ...obj1, ...obj2 };\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("spread") || d.message.includes("Spread"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_NO_EQUIVALENT");
  });

  it("detects computed property names", () => {
    const diags = prescan(`const obj = { [dynamicKey]: 42 };\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Computed property"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_NO_EQUIVALENT");
  });

  it("detects keyof type operator", () => {
    const diags = prescan(`type Keys = keyof MyObj;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("keyof"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_NO_EQUIVALENT");
  });

  it("detects Partial utility type", () => {
    const diags = prescan(`type P = Partial<Task>;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Partial"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_APPROXIMATE");
    expect(diag!.severity).toBe("warning");
  });

  it("detects Pick utility type", () => {
    const diags = prescan(`type P = Pick<Task, 'id'>;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Pick"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_APPROXIMATE");
    expect(diag!.severity).toBe("warning");
  });

  it("rejects ReturnType utility type", () => {
    const diags = prescan(`type R = ReturnType<() => number>;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("ReturnType"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_NO_EQUIVALENT");
    expect(diag!.severity).toBe("error");
  });

  it("does not flag string enum values (lowered to a namespace of constexpr)", () => {
    // String enums ARE supported: type-decl-emitter lowers them to
    // `namespace EnumName { constexpr const char* Member = "..."; }`. The
    // historical TS2CPP_NO_EQUIVALENT warning was stale and is removed
    // (demo #14 Finding F). Prescan must NOT warn.
    const diags = prescan(`enum Status { Active = 'ACTIVE', Inactive = 'INACTIVE' }\n`);
    const stringEnumDiag = diags.find((d) => d.message.includes("String-valued enum"));
    expect(stringEnumDiag).toBeUndefined();
  });

  it("does not flag integer enum values", () => {
    const diags = prescan(`enum Status { Active = 1, Inactive = 2 }\n`);
    const stringEnumDiag = diags.find((d) => d.message.includes("String-valued enum"));
    expect(stringEnumDiag).toBeUndefined();
  });

  it("detects as expression type assertions", () => {
    const diags = prescan(`const x = {} as MyType;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.message.includes("Type assertion"));
    expect(diag).toBeDefined();
    expect(diag!.code).toBe("TS2CPP_APPROXIMATE");
  });

  it("detects void type on variable declarations", () => {
    const diags = prescan(`let x: void = undefined;\n`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const diag = diags.find((d) => d.code === "TS2CPP_APPROXIMATE" && d.message.includes("void type annotation on variable/property"));
    expect(diag).toBeDefined();
  });

  it("does not warn on void method return types", () => {
    const diags = prescan(`class Foo { doThing(): void {} }\n`);
    const voidDiag = diags.find((d) => d.message.includes("void type annotation"));
    expect(voidDiag).toBeUndefined();
  });

  it("detects unsupported features in demo project file", () => {
    const diags = prescan(`
      enum TaskStatus { Pending = 'PENDING', InProgress = 'IN_PROGRESS' }
      type TaskUpdatePayload = Partial<{ id: string }>;
      type TaskKey = keyof { id: string };
      const merged = { ...{ id: '1' }, ...{ status: 'ok' } } as any;
    `);
    const messages = diags.map((d) => d.message);
    // String enums are now SUPPORTED (lowered to a namespace of constexpr),
    // so they must NOT be flagged here (demo #14 Finding F).
    expect(messages.some((m) => m.includes("String-valued enum"))).toBe(false);
    expect(messages.some((m) => m.includes("Partial"))).toBe(true);
    expect(messages.some((m) => m.includes("keyof"))).toBe(true);
    expect(messages.some((m) => m.includes("spread"))).toBe(true);
    expect(diags.length).toBeGreaterThanOrEqual(3);
  });
});
