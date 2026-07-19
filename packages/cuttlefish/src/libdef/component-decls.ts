// Public barrel for component declaration generation.
//
// framework-esp32 imports `generateComponentDeclsForProject` from here so its
// dependency on cuttlefish is declared through the package exports map rather
// than a deep relative path. Spec: 2026-07-19-framework-esp32-components-design.md
export { generateComponentDeclsForProject } from "./cpp-to-decl.js";
export type { ComponentScanRoots } from "./component-discovery.js";
