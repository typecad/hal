# Build Diagnostics

> **Source:** `sketch.ts` | **Target:** `arduino` | **Generated:** 5/17/2026, 5:57:49 PM
> **Board:** ./.typehal/board | **Framework:** @typehal/framework-arduino

---

## Project Summary

| Metric | Status / Value |
| :--- | :--- |
| **Output File** | `C:\typecad\typecode\demo\src\out\sketch\sketch.ino` |
| **Entry Points** | 0 |
| **Static Memory** | 8 bytes |
| **Async Tasks** | None |
| **Pin Usage** | 0 / 0 pins |

---

## Execution Flow

> This graph shows the relationships between entry points, HAL objects, and Arduino APIs.

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#e1f5fe', 'edgeColor': '#546e7a', 'fontFamily': 'Segoe UI, Roboto, Helvetica Neue, sans-serif' } } }%%
flowchart TD
  classDef entry fill:#4caf50,stroke:#2e7d32,color:#fff,stroke-width:2px;
  classDef api fill:#fff9c4,stroke:#fbc02d,color:#333,stroke-width:1px;
  classDef var fill:#e1f5fe,stroke:#0288d1,color:#01579b,stroke-width:1px;
  classDef fn fill:#e8f5e9,stroke:#43a047,color:#1b5e20,stroke-width:1px;
  classDef obj fill:#f3e5f5,stroke:#8e24aa,color:#4a148c,stroke-width:1px;
  classDef board fill:#fafafa,stroke:#9e9e9e,color:#616161,stroke-width:1px,stroke-dasharray: 5 5;
  subgraph Objects["HAL Objects"]
    direction LR
    test{{test}}:::obj
  end

```




## Pin Configuration

> **Tip:** Unused pins are available for connecting additional sensors, actuators, or peripherals.

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'pie1': '#4caf50', 'pie2': '#2196f3', 'pie3': '#ff9800', 'pie4': '#f44336', 'pie5': '#9c27b0', 'pie6': '#795548', 'pie7': '#9e9e9e' } } }%%
pie showData
  title Pin Usage Distribution
```

### 🔌 GPIO Assignments

_No GPIO pins configured._

### 🧩 Peripheral Resource Allocation

| Peripheral | Instance | Pins |
|------------|----------|------|
| Serial | 0 | — |

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#f3e5f5', 'edgeColor': '#7b1fa2' } } }%%
flowchart LR
  classDef peri fill:#f3e5f5,stroke:#8e24aa,color:#4a148c,stroke-width:1px;
  classDef pin fill:#ffffff,stroke:#9c27b0,color:#333,stroke-width:1px;
  subgraph Serial[Serial]
    direction LR
  end
  Serial:::peri
```


## Cooperative Multitasking

> _No async tasks registered in this sketch._


## Memory Estimate

> ⚠️ Static estimate only — excludes dynamic heap allocations (malloc/new).
> String literals may be deduplicated by the compiler/linker.
> **Tip:** Compare this static estimate to the total SRAM of your target board.

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'pie1': '#03a9f4', 'pie2': '#673ab7', 'pie3': '#ff5722', 'pie4': '#4caf50' } } }%%
pie showData
  title Static Memory Allocation (bytes)
  "String Literals" : 8
```

| Category | Bytes |
|----------|-------|
| Global Variables | 0 |
| Struct/Class Sizes | 0 |
| String Literals | 8 |
| **Total Static** | **8** |
| Est. Max Stack Depth | 1 frames |

### 🧱 SRAM Memory Map

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#37474f', 'edgeColor': '#ffffff' } } }%%
flowchart TD
  classDef section fill:#263238,stroke:#eceff1,color:#fff,font-weight:bold;
  classDef item fill:#455a64,stroke:#607d8b,color:#cfd8dc,font-size:12px;
  classDef stack fill:#eceff1,stroke:#b0bec5,color:#455a64,stroke-dasharray: 5 5;
  subgraph SRAM["SRAM Memory Layout"]
    direction TB
    subgraph StackS["ESTIMATED STACK"]
      StackFrame["~1 Recursive Frames"]:::stack
    end
    StackS:::section
    subgraph GlobalsS["GLOBAL VARIABLES"]
      v_test["test (0b)"]:::item
    end
    GlobalsS:::section
    subgraph StringsS["STRING LITERALS"]
      s_0["\"typeHAL\" (8b)"]:::item
    end
    StringsS:::section
  end
```

### Stack Analysis (Deepest Paths)

> The following call sequences represent the maximum stack depth detected.

```mermaid
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#e1f5fe', 'edgeColor': '#0288d1' } } }%%
flowchart LR
  classDef frame fill:#ffffff,stroke:#0288d1,color:#01579b,font-size:11px;
  classDef entry fill:#4caf50,stroke:#2e7d32,color:#fff,font-weight:bold;
  p0_n0[setup]:::entry
  p1_n0[loop]:::entry
```

### Global Variables

| Variable | Type | Est. Bytes |
|----------|------|------------|
| `test` | `std::string` | 0 |


## Module Dependency Graph

> Displays the file import hierarchy and dependencies.

```mermaid
flowchart TD
  classDef module_file fill:#fafafa,stroke:#9e9e9e,color:#333,stroke-width:1px;
  sketch_ts["sketch.ts"]:::module_file
  typehal["@typehal"]:::module_file
  sketch_ts --> typehal
```


## Tree Shaking Report

> Symbols that were removed by the transpiler because they were unused.

_No symbols were removed by tree shaking._


## Build Timing Breakdown

> Execution time for each transpiler phase.

| Phase | Time (ms) |
|-------|-----------|
| setup:caches#0 | 0.18 |
| setup:load-strategy#1 | 0.57 |
| graph:collect#2 | 2.69 |
| typecheck:full#3 | 735.55 |
| ir:build-all#4 | 36.65 |
| ir:build:sketch.ts#5 | 36.51 |
| ir:build-ir:sketch.ts#6 | 34.62 |
| ir:cross-module-imports#7 | 0.48 |
| tree-shake:sketch.ts#8 | 2.28 |
| tree-shake:call-graph#9 | 1.02 |
| tree-shake:entry-points#10 | 0.37 |
| tree-shake:reachability#11 | 0.56 |
| tree-shake:filter#12 | 0.13 |
| emit:register-enums#13 | 0.04 |
| emit:all#14 | 15.97 |
| emit:file:sketch.ts#15 | 15.96 |
| post:native-modules#16 | 0.01 |
| post:flatten#17 | 0.61 |
| post:save-cache#18 | 0.71 |
| **Total** | **884.91** |
