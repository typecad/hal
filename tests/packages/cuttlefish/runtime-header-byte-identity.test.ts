import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { emitRuntimeHeader } from "../../../packages/ui/src/ui-engine/runtime-header";
import { emitCuttlefishGfx } from "../../../packages/ui/src/ui-engine/runtime-header/cuttlefish-gfx";

const here = path.dirname(fileURLToPath(import.meta.url));
const baseline = readFileSync(
  path.join(here, "__fixtures__", "runtime-header-baseline.txt"),
  "utf8",
);
const gfxBaseline = readFileSync(
  path.join(here, "__fixtures__", "cuttlefish-gfx-baseline.txt"),
  "utf8",
);

test("emitRuntimeHeader() output is byte-identical to the committed baseline", () => {
  expect(emitRuntimeHeader()).toBe(baseline);
});

test("emitCuttlefishGfx() output is byte-identical to the committed baseline", () => {
  expect(emitCuttlefishGfx(true)).toBe(gfxBaseline);
  expect(emitCuttlefishGfx(false)).toBe("");
});
