// Browser shim served to the preview page. The host runtime imports
// resolveScrollConfig from "@typecad/ui/..."→"@typecad/cuttlefish/api/shared",
// whose barrel index re-exports node-only modules (fs, zod) that cannot load
// in a browser. The preview's import map points the bare specifier at this
// file, which re-exports just the browser-safe piece the runtime needs, from
// the module that actually defines it.

export { resolveScrollConfig } from "../api/shared/display-profile.js";
