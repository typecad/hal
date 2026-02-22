import path from "node:path";
import { spawnSync } from "node:child_process";
import { ArduinoCompileError, ArduinoCompileResult } from "../types";

const GCC_STYLE = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/i;

function parseCompileErrors(output: string): ArduinoCompileError[] {
  const errors: ArduinoCompileError[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(GCC_STYLE);
    if (!match) {
      continue;
    }

    const severityRaw = match[4].toLowerCase();
    const severity: "error" | "warning" | "note" =
      severityRaw.includes("error") ? "error" : severityRaw === "warning" ? "warning" : "note";

    errors.push({
      filePath: path.resolve(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
      severity,
      message: match[5],
    });
  }

  return errors;
}

export function compileArduinoSketch(sketchFilePath: string, fqbn: string): ArduinoCompileResult {
  const sketchDir = path.dirname(sketchFilePath);
  const cmd = spawnSync("arduino-cli", ["compile", "--fqbn", fqbn, sketchDir], {
    encoding: "utf8",
    timeout: 120000,
  });

  const output = `${cmd.stdout ?? ""}\n${cmd.stderr ?? ""}`.trim();
  const errors = parseCompileErrors(output);

  return {
    success: cmd.status === 0,
    output,
    errors,
  };
}
