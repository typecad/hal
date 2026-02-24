import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { ArduinoCompileError, ArduinoCompileResult, ArduinoUploadResult } from "../types";

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

function collectCppFiles(rootDir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".cpp")) {
      continue;
    }
    results.push(path.join(rootDir, entry.name));
  }
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

export function flattenGeneratedModulesIntoSketch(sketchDir: string, sketchPath: string): void {
  const normalizedSketchPath = path.resolve(sketchPath);
  const cppFiles = collectCppFiles(sketchDir).filter((filePath) => path.resolve(filePath) !== normalizedSketchPath);
  if (cppFiles.length === 0) {
    return;
  }

  const originalSketch = fs.readFileSync(normalizedSketchPath, "utf8");
  const sanitizedSketch = originalSketch
    .replace(/^\s*#include\s+<Arduino\.h>\s*$/gm, "")
    .replace(/^\s*#include\s+"Arduino\.h"\s*$/gm, "");
  const moduleContents = cppFiles
    .map((cppPath) => {
      const relativePath = path.relative(sketchDir, cppPath).replace(/\\/g, "/");
      const content = fs.readFileSync(cppPath, "utf8");
      const rewritten = content.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_line, includePath: string) => {
        const resolved = path.resolve(path.dirname(cppPath), includePath);
        if (!resolved.startsWith(path.resolve(sketchDir))) {
          return `#include "${includePath}"`;
        }
        let relativeToSketch = path.relative(sketchDir, resolved).replace(/\\/g, "/");
        relativeToSketch = relativeToSketch.replace(/(^|\/)([^\/]+)\/\2(?=\/|$)/g, "$1$2");
        if (!relativeToSketch.startsWith(".")) {
          relativeToSketch = `./${relativeToSketch}`;
        }
        return `#include "${relativeToSketch}"`;
      });
      const sanitized = rewritten
        .replace(/^\s*#include\s+<Arduino\.h>\s*$/gm, "")
        .replace(/^\s*#include\s+"Arduino\.h"\s*$/gm, "");
      return `\n// ---- merged from ${relativePath} ----\n${sanitized}\n`;
    })
    .join("\n");

  const mergedSketch = `${moduleContents}\n// ---- entry sketch ----\n${sanitizedSketch}\n`;
  fs.writeFileSync(normalizedSketchPath, mergedSketch, "utf8");

  for (const cppPath of cppFiles) {
    fs.rmSync(cppPath, { force: true });
  }
}

export function compileArduinoSketch(sketchFilePath: string, fqbn: string): ArduinoCompileResult {
  const resolvedSketchFilePath = path.resolve(sketchFilePath);
  let sketchDir = path.dirname(resolvedSketchFilePath);
  let sketchDirName = path.basename(sketchDir);
  let requiredSketchPath = path.join(sketchDir, `${sketchDirName}.ino`);

  if (sketchDirName.startsWith(".")) {
    const stagingDir = path.join(path.dirname(sketchDir), "ts2cpp_sketch");
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.cpSync(sketchDir, stagingDir, { recursive: true });
      sketchDir = stagingDir;
      sketchDirName = path.basename(sketchDir);
      requiredSketchPath = path.join(sketchDir, `${sketchDirName}.ino`);
    } catch {
      // Best-effort staging; fall back to original directory behavior.
    }
  }

  if (path.extname(resolvedSketchFilePath).toLowerCase() === ".ino" && resolvedSketchFilePath !== requiredSketchPath) {
    try {
      const sourceText = fs.readFileSync(resolvedSketchFilePath, "utf8");
      if (!fs.existsSync(requiredSketchPath) || fs.readFileSync(requiredSketchPath, "utf8") !== sourceText) {
        fs.writeFileSync(requiredSketchPath, sourceText, "utf8");
      }

      // Arduino sketches must have a single primary .ino matching the folder name.
      // Remove other .ino files in the sketch root to avoid duplicate setup()/loop().
      for (const child of fs.readdirSync(sketchDir)) {
        if (!child.toLowerCase().endsWith(".ino")) {
          continue;
        }
        const candidate = path.join(sketchDir, child);
        if (path.resolve(candidate) !== path.resolve(requiredSketchPath)) {
          fs.rmSync(candidate, { force: true });
        }
      }
    } catch {
      // Best-effort sketch alias generation. If this fails, arduino-cli output will report details.
    }
  }

  try {
    if (fs.existsSync(requiredSketchPath)) {
      flattenGeneratedModulesIntoSketch(sketchDir, requiredSketchPath);
    }
  } catch {
    // Best-effort flattening for generated modules.
  }

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

export function uploadArduinoSketch(sketchDir: string, fqbn: string, port: string): ArduinoUploadResult {
  const cmd = spawnSync("arduino-cli", ["upload", "--fqbn", fqbn, "--port", port, sketchDir], {
    encoding: "utf8",
    timeout: 60000,
  });

  const output = `${cmd.stdout ?? ""}\n${cmd.stderr ?? ""}`.trim();

  return {
    success: cmd.status === 0,
    output,
  };
}

export function monitorArduinoSketch(port: string, baud: number): void {
  spawnSync("arduino-cli", ["monitor", "--port", port, "--config", `baudrate=${baud}`], {
    stdio: "inherit",
    timeout: 0,
  });
}
