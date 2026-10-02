import { it } from "vitest";
import { transpileNative } from "../../setup";
import { runNode, runNative } from "./differential-corpus";
import * as fs from "node:fs";

it("nested templates", () => {
  const ts = `
    declare function report(line: string): void;
    const nested = \`outer \${\`inner \${1 + 1}\`} end\`;
    report(nested);
  `;
  const dir = ".build/nest";
  fs.mkdirSync(dir, { recursive: true });
  const nodeOut = runNode(ts, dir).replace(/\r\n/g, "\n");
  let nativeOut: string;
  try {
    nativeOut = runNative(ts, dir, "nest").replace(/\r\n/g, "\n");
  } catch (e) {
    nativeOut = "FAIL: " + (e as Error).message.slice(0, 150);
  }
  console.log("NODE:", JSON.stringify(nodeOut));
  console.log("NATIVE:", JSON.stringify(nativeOut));
  const out = transpileNative(ts);
  console.log(out.cpp.split("\n").filter(l => l.includes("cuttlefish_str")).join("\n").slice(0, 500));
});
