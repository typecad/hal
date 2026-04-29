// ---------------------------------------------------------------------------
// Arduino sketch compilation, upload, and monitoring
//
// Provides functions to flatten generated modules into an Arduino sketch,
// compile using arduino-cli, upload to a board, and monitor serial output.
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import type { CompileError, CompileResult, UploadResult } from "@typehal/core/shared";
import { parseCompileErrors, collectCppFiles } from "@typehal/core/shared";

export type ArduinoCompileResult = CompileResult;
export type ArduinoUploadResult = UploadResult;

const ARDUINO_ERROR = /^(.*?):(\d+):\d+:\s*(error|warning|note):\s*(.*)$/i;

/**
 * Parse compile errors with Arduino format support.
 */
function parseArduinoCompileErrors(output: string, sketchDir?: string): CompileError[] {
  const errors: CompileError[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let match = line.match(ARDUINO_ERROR);

    if (!match) {
      continue;
    }

    const severityRaw = match[3].toLowerCase();
    const severity: "error" | "warning" | "note" =
      severityRaw.includes("error") ? "error" : severityRaw === "warning" ? "warning" : "note";

    let filePath = match[1];

    if (sketchDir) {
      if (!path.isAbsolute(filePath)) {
        const resolved = path.resolve(sketchDir, filePath);
        if (fs.existsSync(resolved)) {
          filePath = resolved;
        }
      }
      if (filePath.includes(path.basename(sketchDir))) {
        filePath = path.resolve(sketchDir, path.basename(sketchDir) + ".ino");
      }
    }

    errors.push({
      filePath: path.resolve(filePath),
      line: parseInt(match[2], 10),
      column: 1,
      severity,
      message: match[4],
    });
  }

  return errors;
}

/**
 * Extract architecture from FQBN string.
 * FQBN format: vendor:arch:board[:config]
 */
export function toArchitectureFromFqbn(fqbn?: string): string | undefined {
  if (!fqbn) return undefined;
  return fqbn.split(":")[1];
}

export function flattenGeneratedModulesIntoSketch(sketchDir: string, sketchPath: string): void {
  const normalizedSketchPath = path.resolve(sketchPath);
  const cppFiles = collectCppFiles(sketchDir).filter((filePath) => path.resolve(filePath) !== normalizedSketchPath);
  if (cppFiles.length === 0) {
    return;
  }

  // Collect header file names that correspond to the merged .cpp files
  // These includes should be stripped from the entry sketch since the code is merged inline
  const mergedHeaderNames = new Set<string>();
  // Also track header file paths for inlining
  const headerFiles = new Map<string, string>(); // baseName -> headerPath
  for (const cppPath of cppFiles) {
    const baseName = path.basename(cppPath, path.extname(cppPath));
    const headerName = `${baseName}.h`;
    mergedHeaderNames.add(headerName);
    
    // Check if corresponding .h file exists
    const headerPath = path.join(path.dirname(cppPath), headerName);
    if (fs.existsSync(headerPath) && fs.statSync(headerPath).isFile()) {
      headerFiles.set(baseName, headerPath);
    }
  }

  const originalSketch = fs.readFileSync(normalizedSketchPath, "utf8");
  const sanitizedSketch = originalSketch
    .replace(/^\s*#include\s+<Arduino\.h>\s*$/gm, "")
    .replace(/^\s*#include\s+"Arduino\.h"\s*$/gm, "")
    // Strip includes for headers corresponding to merged .cpp modules
    .replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (line, includePath: string) => {
      const headerName = path.basename(includePath);
      if (mergedHeaderNames.has(headerName)) {
        return ""; // Remove the include since the module is merged inline
      }
      return line;
    });
  // Collect module contents - native C++ modules are NOT wrapped in namespaces
  // since they're already valid C++ code
  const moduleContents: string[] = [];
  
  for (const cppPath of cppFiles) {
    const baseName = path.basename(cppPath, path.extname(cppPath));
    const relativePath = path.relative(sketchDir, cppPath).replace(/\\/g, "/");
    
    // First, inline the corresponding .h file if it exists
    const headerPath = headerFiles.get(baseName);
    if (headerPath) {
      const headerRelativePath = path.relative(sketchDir, headerPath).replace(/\\/g, "/");
      const headerContent = fs.readFileSync(headerPath, "utf8");
      const sanitizedHeader = headerContent
        .replace(/^\s*#include\s+<Arduino\.h>\s*$/gm, "")
        .replace(/^\s*#include\s+"Arduino\.h"\s*$/gm, "");
      
      moduleContents.push(`\n// ---- merged from ${headerRelativePath} ----\n${sanitizedHeader}\n`);
    }
    
    const content = fs.readFileSync(cppPath, "utf8");
    const rewritten = content.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_line, includePath: string) => {
      const headerName = path.basename(includePath);
      // Strip includes for headers that we've already inlined
      if (mergedHeaderNames.has(headerName)) {
        return "";
      }
      
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
    
    // Skip modules whose body is empty after tree-shaking
    const stripped = sanitized
      .replace(/^\s*#include\s+.*$/gm, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (stripped.length === 0) {
      continue;
    }
    
    moduleContents.push(`\n// ---- merged from ${relativePath} ----\n${sanitized}\n`);
  }

  const mergedSketch = `${moduleContents.join("")}// ---- entry sketch ----\n${sanitizedSketch}\n`;
  fs.writeFileSync(normalizedSketchPath, mergedSketch, "utf8");

  // Clean up merged .cpp and .h files
  for (const cppPath of cppFiles) {
    fs.rmSync(cppPath, { force: true });
  }
  for (const headerPath of headerFiles.values()) {
    fs.rmSync(headerPath, { force: true });
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
  const gccErrors = parseCompileErrors(output, sketchDir);
  const arduinoErrors = parseArduinoCompileErrors(output, sketchDir);
  const errors = gccErrors.length > 0 ? gccErrors : arduinoErrors;

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
