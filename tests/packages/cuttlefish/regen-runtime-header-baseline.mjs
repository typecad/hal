// Regen helper for the runtime-header byte-identity baselines. Run from the
// repo root after an INTENTIONAL runtime-header change:
//   npx tsx tests/packages/cuttlefish/regen-runtime-header-baseline.mjs
// Reviews the diff like any other code change — the baseline is the guard
// against accidental drift, so regenerating it is a deliberate act.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { emitRuntimeHeader } from "../../../packages/ui/src/ui-engine/runtime-header.ts";
import { emitCuttlefishGfx } from "../../../packages/ui/src/ui-engine/runtime-header/cuttlefish-gfx.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "__fixtures__");
writeFileSync(path.join(fixtures, "runtime-header-baseline.txt"), emitRuntimeHeader());
writeFileSync(path.join(fixtures, "cuttlefish-gfx-baseline.txt"), emitCuttlefishGfx(true));
console.log("baselines regenerated");

