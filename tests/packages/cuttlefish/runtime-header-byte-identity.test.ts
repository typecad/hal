import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { emitRuntimeHeader } from "../../../packages/cuttlefish/src/ui/runtime-header";

const here = path.dirname(fileURLToPath(import.meta.url));
const baseline = readFileSync(
  path.join(here, "__fixtures__", "runtime-header-baseline.txt"),
  "utf8",
);

test("emitRuntimeHeader() output is byte-identical to the committed baseline", () => {
  expect(emitRuntimeHeader()).toBe(baseline);
});
