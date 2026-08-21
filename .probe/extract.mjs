import { writeFileSync } from "node:fs";
import { emitRuntimeHeader } from "../packages/ui/src/ui-engine/runtime-header.js";
writeFileSync(new URL("./ui_runtime.h", import.meta.url), emitRuntimeHeader());
console.log("header extracted");
