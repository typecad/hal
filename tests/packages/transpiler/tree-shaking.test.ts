import { describe, it, expect } from "vitest";
import { buildProgramIR, buildCallGraph, getReachableSymbols, detectEntryPoints, analyzeReachability, getReachabilityStats, filterProgramIR } from "@typehal/transpiler/testing";

describe("buildCallGraph", () => {
  it("should build a call graph for a simple function", () => {
    const source = `
      function foo(): void {
        bar();
      }
      
      function bar(): void {
        console.log("bar");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const graph = buildCallGraph(programIR);

    expect(graph.nodes.has("foo")).toBe(true);
    expect(graph.nodes.has("bar")).toBe(true);
    expect(graph.nodes.has("__top_level__")).toBe(true);

    const fooNode = graph.nodes.get("foo")!;
    expect(fooNode.dependencies.has("bar")).toBe(true);
  });

  it("should track class instantiations", () => {
    const source = `
      class MyClass {
        public value: number = 0;
      }
      
      function createInstance(): MyClass {
        const instance = new MyClass();
        return instance;
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const graph = buildCallGraph(programIR);

    expect(graph.nodes.has("MyClass")).toBe(true);
    expect(graph.nodes.has("createInstance")).toBe(true);

    const createInstanceNode = graph.nodes.get("createInstance")!;
    expect(createInstanceNode.dependencies.has("MyClass")).toBe(true);
  });

  it("should track method calls", () => {
    const source = `
      class Calculator {
        public add(a: number, b: number): number {
          return a + b;
        }
      }
      
      function main(): void {
        const calc = new Calculator();
        calc.add(1, 2);
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const graph = buildCallGraph(programIR);

    expect(graph.nodes.has("Calculator")).toBe(true);
    expect(graph.nodes.has("main")).toBe(true);

    const mainNode = graph.nodes.get("main")!;
    expect(mainNode.dependencies.has("Calculator")).toBe(true);
  });

  it("should handle nested function calls", () => {
    const source = `
      function a(): void { b(); }
      function b(): void { c(); }
      function c(): void { console.log("c"); }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const graph = buildCallGraph(programIR);

    expect(graph.nodes.get("a")!.dependencies.has("b")).toBe(true);
    expect(graph.nodes.get("b")!.dependencies.has("c")).toBe(true);
  });
});

describe("detectEntryPoints", () => {
  it("should detect setup and loop for embedded targets", () => {
    const source = `
      function setup(): void {
        console.log("setup");
      }

      function loop(): void {
        console.log("loop");
      }

      function unused(): void {
        console.log("unused");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const entryPoints = detectEntryPoints(programIR, {}, ["setup", "loop"]);

    expect(entryPoints.has("setup")).toBe(true);
    expect(entryPoints.has("loop")).toBe(true);
    expect(entryPoints.has("unused")).toBe(false);
    expect(entryPoints.has("__top_level__")).toBe(true);
  });

  it("should detect main for generic target", () => {
    const source = `
      function main(): number {
        return 0;
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const entryPoints = detectEntryPoints(programIR, {}, ["main"]);

    expect(entryPoints.has("main")).toBe(true);
    expect(entryPoints.has("unused")).toBe(false);
  });

  it("should include custom entry points", () => {
    const source = `
      function customEntry(): void {
        console.log("custom");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const entryPoints = detectEntryPoints(programIR, {
      customEntryPoints: ["customEntry"],
    }, ["main"]);

    expect(entryPoints.has("customEntry")).toBe(true);
    expect(entryPoints.has("unused")).toBe(false);
  });

  it("should detect top-level class instantiations", () => {
    const source = `
      class MyClass {
        public value: number = 0;
      }
      
      const instance = new MyClass();
    `;
    const programIR = buildProgramIR("test.ts", source);
    const entryPoints = detectEntryPoints(programIR, {}, ["main"]);

    expect(entryPoints.has("MyClass")).toBe(true);
  });
});

describe("analyzeReachability", () => {
  it("should identify reachable functions from entry points", () => {
    const source = `
      function main(): void {
        foo();
      }
      
      function foo(): void {
        bar();
      }
      
      function bar(): void {
        console.log("bar");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);
    const entryPoints = detectEntryPoints(programIR, {}, ["main"]);
    const result = analyzeReachability(programIR, callGraph, { target: "generic" });

    expect(result.reachableFunctions.has("main")).toBe(true);
    expect(result.reachableFunctions.has("foo")).toBe(true);
    expect(result.reachableFunctions.has("bar")).toBe(true);
    expect(result.reachableFunctions.has("unused")).toBe(false);

    expect(result.unreachable.functions.length).toBe(1);
    expect(result.unreachable.functions[0].originalName).toBe("unused");
  });

  it("should identify reachable classes", () => {
    const source = `
      class UsedClass {
        public value: number = 0;
      }
      
      class UnusedClass {
        public value: number = 0;
      }
      
      function main(): void {
        const obj = new UsedClass();
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);
    const result = analyzeReachability(programIR, callGraph, { target: "generic" });

    expect(result.reachableClasses.has("UsedClass")).toBe(true);
    expect(result.reachableClasses.has("UnusedClass")).toBe(false);
  });

  it("should respect keepUnusedEnums option", () => {
    const source = `
      enum UsedEnum { A, B }
      enum UnusedEnum { X, Y }
      
      function main(): void {
        const value = UsedEnum.A;
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);

    const resultWithKeep = analyzeReachability(programIR, callGraph, {
      target: "generic",
      keepUnusedEnums: true,
    });
    expect(resultWithKeep.reachableEnums.has("UnusedEnum")).toBe(true);

    const resultWithoutKeep = analyzeReachability(programIR, callGraph, {
      target: "generic",
      keepUnusedEnums: false,
    });
    expect(resultWithoutKeep.reachableEnums.has("UnusedEnum")).toBe(false);
  });

  it("should generate diagnostics for unreachable code", () => {
    const source = `
      function main(): void {
        console.log("main");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);
    const result = analyzeReachability(programIR, callGraph, {
      target: "generic",
      reportUnused: true,
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    const unusedDiagnostic = result.diagnostics.find(
      (d) => d.code === "TS2CPP_UNREACHABLE_FUNCTION"
    );
    expect(unusedDiagnostic).toBeDefined();
    expect(unusedDiagnostic!.message).toContain("unused");
  });
});

describe("filterProgramIR", () => {
  it("should remove unreachable functions", () => {
    const source = `
      function main(): void {
        used();
      }
      
      function used(): void {
        console.log("used");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);
    const entryPoints = detectEntryPoints(programIR, {}, ["main"]);
    const reachability = analyzeReachability(programIR, callGraph, { target: "generic" });
    const filtered = filterProgramIR(programIR, reachability, { enabled: true });

    expect(filtered.functions.length).toBe(2);
    expect(filtered.functions.find((f) => f.originalName === "unused")).toBeUndefined();
  });

  it("should remove unreachable classes", () => {
    const source = `
      class UsedClass {
        public value: number = 0;
      }
      
      class UnusedClass {
        public value: number = 0;
      }
      
      function main(): void {
        const obj = new UsedClass();
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);
    const reachability = analyzeReachability(programIR, callGraph, { target: "generic" });
    const filtered = filterProgramIR(programIR, reachability, { enabled: true });

    expect(filtered.classes.length).toBe(1);
    expect(filtered.classes.find((c) => c.name === "UnusedClass")).toBeUndefined();
  });

  it("should preserve all code when disabled", () => {
    const source = `
      function main(): void {
        console.log("main");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);
    const reachability = analyzeReachability(programIR, callGraph, { target: "generic" });
    const filtered = filterProgramIR(programIR, reachability, { enabled: false });

    expect(filtered.functions.length).toBe(programIR.functions.length);
  });

  it("should include reachability diagnostics in filtered output", () => {
    const source = `
      function main(): void {
        console.log("main");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);
    const reachability = analyzeReachability(programIR, callGraph, {
      target: "generic",
      reportUnused: true,
    });
    const filtered = filterProgramIR(programIR, reachability, { enabled: true, reportUnused: true });

    const unreachableDiagnostic = filtered.diagnostics.find(
      (d) => d.code === "TS2CPP_UNREACHABLE_FUNCTION"
    );
    expect(unreachableDiagnostic).toBeDefined();
  });
});

describe("getReachabilityStats", () => {
  it("should calculate correct statistics", () => {
    const source = `
      function main(): void { used(); }
      function used(): void { console.log("used"); }
      function unused1(): void { console.log("unused1"); }
      function unused2(): void { console.log("unused2"); }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);
    const reachability = analyzeReachability(programIR, callGraph, { target: "generic" });
    const stats = getReachabilityStats(programIR, reachability);

    expect(stats.totalFunctions).toBe(4);
    expect(stats.reachableFunctions).toBe(2);
    expect(stats.reductionPercent).toBe(50);
  });
});

describe("getReachableSymbols", () => {
  it("should traverse transitive dependencies", () => {
    const source = `
      function a(): void { b(); }
      function b(): void { c(); }
      function c(): void { d(); }
      function d(): void { console.log("d"); }
      function unused(): void { console.log("unused"); }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);

    const reachable = getReachableSymbols(callGraph, new Set(["a"]));

    expect(reachable.has("a")).toBe(true);
    expect(reachable.has("b")).toBe(true);
    expect(reachable.has("c")).toBe(true);
    expect(reachable.has("d")).toBe(true);
    expect(reachable.has("unused")).toBe(false);
  });

  it("should handle circular dependencies", () => {
    const source = `
      function a(): void { b(); }
      function b(): void { c(); }
      function c(): void { a(); }
    `;
    const programIR = buildProgramIR("test.ts", source);
    const callGraph = buildCallGraph(programIR);

    // Should not infinite loop
    const reachable = getReachableSymbols(callGraph, new Set(["a"]));

    expect(reachable.has("a")).toBe(true);
    expect(reachable.has("b")).toBe(true);
    expect(reachable.has("c")).toBe(true);
  });
});
