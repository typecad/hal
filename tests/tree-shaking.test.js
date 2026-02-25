"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const build_ir_1 = require("../packages/cli/src/ir/build-ir");
const call_graph_1 = require("../packages/cli/src/ir/call-graph");
const entry_points_1 = require("../packages/cli/src/ir/entry-points");
const reachability_1 = require("../packages/cli/src/ir/reachability");
const filter_1 = require("../packages/cli/src/ir/filter");
(0, vitest_1.describe)("buildCallGraph", () => {
    (0, vitest_1.it)("should build a call graph for a simple function", () => {
        const source = `
      function foo(): void {
        bar();
      }
      
      function bar(): void {
        console.log("bar");
      }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const graph = (0, call_graph_1.buildCallGraph)(programIR);
        (0, vitest_1.expect)(graph.nodes.has("foo")).toBe(true);
        (0, vitest_1.expect)(graph.nodes.has("bar")).toBe(true);
        (0, vitest_1.expect)(graph.nodes.has("__top_level__")).toBe(true);
        const fooNode = graph.nodes.get("foo");
        (0, vitest_1.expect)(fooNode.dependencies.has("bar")).toBe(true);
    });
    (0, vitest_1.it)("should track class instantiations", () => {
        const source = `
      class MyClass {
        public value: number = 0;
      }
      
      function createInstance(): MyClass {
        const instance = new MyClass();
        return instance;
      }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const graph = (0, call_graph_1.buildCallGraph)(programIR);
        (0, vitest_1.expect)(graph.nodes.has("MyClass")).toBe(true);
        (0, vitest_1.expect)(graph.nodes.has("createInstance")).toBe(true);
        const createInstanceNode = graph.nodes.get("createInstance");
        (0, vitest_1.expect)(createInstanceNode.dependencies.has("MyClass")).toBe(true);
    });
    (0, vitest_1.it)("should track method calls", () => {
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
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const graph = (0, call_graph_1.buildCallGraph)(programIR);
        (0, vitest_1.expect)(graph.nodes.has("Calculator")).toBe(true);
        (0, vitest_1.expect)(graph.nodes.has("main")).toBe(true);
        const mainNode = graph.nodes.get("main");
        (0, vitest_1.expect)(mainNode.dependencies.has("Calculator")).toBe(true);
    });
    (0, vitest_1.it)("should handle nested function calls", () => {
        const source = `
      function a(): void { b(); }
      function b(): void { c(); }
      function c(): void { console.log("c"); }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const graph = (0, call_graph_1.buildCallGraph)(programIR);
        (0, vitest_1.expect)(graph.nodes.get("a").dependencies.has("b")).toBe(true);
        (0, vitest_1.expect)(graph.nodes.get("b").dependencies.has("c")).toBe(true);
    });
});
(0, vitest_1.describe)("detectEntryPoints", () => {
    (0, vitest_1.it)("should detect setup and loop for Arduino target", () => {
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
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const entryPoints = (0, entry_points_1.detectEntryPoints)(programIR, "arduino");
        (0, vitest_1.expect)(entryPoints.has("setup")).toBe(true);
        (0, vitest_1.expect)(entryPoints.has("loop")).toBe(true);
        (0, vitest_1.expect)(entryPoints.has("unused")).toBe(false);
        (0, vitest_1.expect)(entryPoints.has("__top_level__")).toBe(true);
    });
    (0, vitest_1.it)("should detect main for generic target", () => {
        const source = `
      function main(): number {
        return 0;
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const entryPoints = (0, entry_points_1.detectEntryPoints)(programIR, "generic");
        (0, vitest_1.expect)(entryPoints.has("main")).toBe(true);
        (0, vitest_1.expect)(entryPoints.has("unused")).toBe(false);
    });
    (0, vitest_1.it)("should include custom entry points", () => {
        const source = `
      function customEntry(): void {
        console.log("custom");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const entryPoints = (0, entry_points_1.detectEntryPoints)(programIR, "generic", {
            customEntryPoints: ["customEntry"],
        });
        (0, vitest_1.expect)(entryPoints.has("customEntry")).toBe(true);
        (0, vitest_1.expect)(entryPoints.has("unused")).toBe(false);
    });
    (0, vitest_1.it)("should detect top-level class instantiations", () => {
        const source = `
      class MyClass {
        public value: number = 0;
      }
      
      const instance = new MyClass();
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const entryPoints = (0, entry_points_1.detectEntryPoints)(programIR, "generic");
        (0, vitest_1.expect)(entryPoints.has("MyClass")).toBe(true);
    });
});
(0, vitest_1.describe)("analyzeReachability", () => {
    (0, vitest_1.it)("should identify reachable functions from entry points", () => {
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
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const entryPoints = (0, entry_points_1.detectEntryPoints)(programIR, "generic");
        const result = (0, reachability_1.analyzeReachability)(programIR, callGraph, { target: "generic" });
        (0, vitest_1.expect)(result.reachableFunctions.has("main")).toBe(true);
        (0, vitest_1.expect)(result.reachableFunctions.has("foo")).toBe(true);
        (0, vitest_1.expect)(result.reachableFunctions.has("bar")).toBe(true);
        (0, vitest_1.expect)(result.reachableFunctions.has("unused")).toBe(false);
        (0, vitest_1.expect)(result.unreachable.functions.length).toBe(1);
        (0, vitest_1.expect)(result.unreachable.functions[0].originalName).toBe("unused");
    });
    (0, vitest_1.it)("should identify reachable classes", () => {
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
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const result = (0, reachability_1.analyzeReachability)(programIR, callGraph, { target: "generic" });
        (0, vitest_1.expect)(result.reachableClasses.has("UsedClass")).toBe(true);
        (0, vitest_1.expect)(result.reachableClasses.has("UnusedClass")).toBe(false);
    });
    (0, vitest_1.it)("should respect keepUnusedEnums option", () => {
        const source = `
      enum UsedEnum { A, B }
      enum UnusedEnum { X, Y }
      
      function main(): void {
        const value = UsedEnum.A;
      }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const resultWithKeep = (0, reachability_1.analyzeReachability)(programIR, callGraph, {
            target: "generic",
            keepUnusedEnums: true,
        });
        (0, vitest_1.expect)(resultWithKeep.reachableEnums.has("UnusedEnum")).toBe(true);
        const resultWithoutKeep = (0, reachability_1.analyzeReachability)(programIR, callGraph, {
            target: "generic",
            keepUnusedEnums: false,
        });
        (0, vitest_1.expect)(resultWithoutKeep.reachableEnums.has("UnusedEnum")).toBe(false);
    });
    (0, vitest_1.it)("should generate diagnostics for unreachable code", () => {
        const source = `
      function main(): void {
        console.log("main");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const result = (0, reachability_1.analyzeReachability)(programIR, callGraph, {
            target: "generic",
            reportUnused: true,
        });
        (0, vitest_1.expect)(result.diagnostics.length).toBeGreaterThan(0);
        const unusedDiagnostic = result.diagnostics.find((d) => d.code === "TS2CPP_UNREACHABLE_FUNCTION");
        (0, vitest_1.expect)(unusedDiagnostic).toBeDefined();
        (0, vitest_1.expect)(unusedDiagnostic.message).toContain("unused");
    });
});
(0, vitest_1.describe)("filterProgramIR", () => {
    (0, vitest_1.it)("should remove unreachable functions", () => {
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
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const entryPoints = (0, entry_points_1.detectEntryPoints)(programIR, "generic");
        const reachability = (0, reachability_1.analyzeReachability)(programIR, callGraph, { target: "generic" });
        const filtered = (0, filter_1.filterProgramIR)(programIR, reachability, { enabled: true });
        (0, vitest_1.expect)(filtered.functions.length).toBe(2);
        (0, vitest_1.expect)(filtered.functions.find((f) => f.originalName === "unused")).toBeUndefined();
    });
    (0, vitest_1.it)("should remove unreachable classes", () => {
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
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const reachability = (0, reachability_1.analyzeReachability)(programIR, callGraph, { target: "generic" });
        const filtered = (0, filter_1.filterProgramIR)(programIR, reachability, { enabled: true });
        (0, vitest_1.expect)(filtered.classes.length).toBe(1);
        (0, vitest_1.expect)(filtered.classes.find((c) => c.name === "UnusedClass")).toBeUndefined();
    });
    (0, vitest_1.it)("should preserve all code when disabled", () => {
        const source = `
      function main(): void {
        console.log("main");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const reachability = (0, reachability_1.analyzeReachability)(programIR, callGraph, { target: "generic" });
        const filtered = (0, filter_1.filterProgramIR)(programIR, reachability, { enabled: false });
        (0, vitest_1.expect)(filtered.functions.length).toBe(programIR.functions.length);
    });
    (0, vitest_1.it)("should include reachability diagnostics in filtered output", () => {
        const source = `
      function main(): void {
        console.log("main");
      }
      
      function unused(): void {
        console.log("unused");
      }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const reachability = (0, reachability_1.analyzeReachability)(programIR, callGraph, {
            target: "generic",
            reportUnused: true,
        });
        const filtered = (0, filter_1.filterProgramIR)(programIR, reachability, { enabled: true, reportUnused: true });
        const unreachableDiagnostic = filtered.diagnostics.find((d) => d.code === "TS2CPP_UNREACHABLE_FUNCTION");
        (0, vitest_1.expect)(unreachableDiagnostic).toBeDefined();
    });
});
(0, vitest_1.describe)("getReachabilityStats", () => {
    (0, vitest_1.it)("should calculate correct statistics", () => {
        const source = `
      function main(): void { used(); }
      function used(): void { console.log("used"); }
      function unused1(): void { console.log("unused1"); }
      function unused2(): void { console.log("unused2"); }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const reachability = (0, reachability_1.analyzeReachability)(programIR, callGraph, { target: "generic" });
        const stats = (0, reachability_1.getReachabilityStats)(programIR, reachability);
        (0, vitest_1.expect)(stats.totalFunctions).toBe(4);
        (0, vitest_1.expect)(stats.reachableFunctions).toBe(2);
        (0, vitest_1.expect)(stats.reductionPercent).toBe(50);
    });
});
(0, vitest_1.describe)("getReachableSymbols", () => {
    (0, vitest_1.it)("should traverse transitive dependencies", () => {
        const source = `
      function a(): void { b(); }
      function b(): void { c(); }
      function c(): void { d(); }
      function d(): void { console.log("d"); }
      function unused(): void { console.log("unused"); }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        const reachable = (0, call_graph_1.getReachableSymbols)(callGraph, new Set(["a"]));
        (0, vitest_1.expect)(reachable.has("a")).toBe(true);
        (0, vitest_1.expect)(reachable.has("b")).toBe(true);
        (0, vitest_1.expect)(reachable.has("c")).toBe(true);
        (0, vitest_1.expect)(reachable.has("d")).toBe(true);
        (0, vitest_1.expect)(reachable.has("unused")).toBe(false);
    });
    (0, vitest_1.it)("should handle circular dependencies", () => {
        const source = `
      function a(): void { b(); }
      function b(): void { c(); }
      function c(): void { a(); }
    `;
        const programIR = (0, build_ir_1.buildProgramIR)("test.ts", source);
        const callGraph = (0, call_graph_1.buildCallGraph)(programIR);
        // Should not infinite loop
        const reachable = (0, call_graph_1.getReachableSymbols)(callGraph, new Set(["a"]));
        (0, vitest_1.expect)(reachable.has("a")).toBe(true);
        (0, vitest_1.expect)(reachable.has("b")).toBe(true);
        (0, vitest_1.expect)(reachable.has("c")).toBe(true);
    });
});
