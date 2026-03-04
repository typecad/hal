import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { ArduinoCompileError, ArduinoCompileResult, ArduinoUploadResult } from "../types";

const GCC_STYLE = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/i;
const ARDUINO_ERROR = /^(.*?):(\d+):\d+:\s*(error|warning|note):\s*(.*)$/i;
const CLANG_ERROR = /^(.*?):(\d+):(\d+):\s*(error|warning|note):\s*(.*)$/i;

function parseCompileErrors(output: string, sketchDir?: string): ArduinoCompileError[] {
  const errors: ArduinoCompileError[] = [];
  
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let match = line.match(GCC_STYLE);
    if (!match) {
      match = line.match(ARDUINO_ERROR);
      if (match) {
        // Arduino error format: file:line:column: severity: message
        // Sometimes column is missing, so we use 1 as default
        match = [match[0], match[1], match[2], "1", match[3], match[4]];
      }
    }
    
    if (!match) {
      match = line.match(CLANG_ERROR);
    }

    if (!match) {
      continue;
    }

    const severityRaw = match[4].toLowerCase();
    const severity: "error" | "warning" | "note" =
      severityRaw.includes("error") ? "error" : severityRaw === "warning" ? "warning" : "note";

    let filePath = match[1];
    
    // Normalize file paths
    if (sketchDir) {
      // Try to resolve relative paths against sketch directory
      if (!path.isAbsolute(filePath)) {
        const resolved = path.resolve(sketchDir, filePath);
        if (fs.existsSync(resolved)) {
          filePath = resolved;
        }
      }
    }
    
    // Handle sketch directory references
    if (sketchDir && filePath.includes(path.basename(sketchDir))) {
      filePath = path.resolve(sketchDir, path.basename(sketchDir) + ".ino");
    }

    errors.push({
      filePath: path.resolve(filePath),
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

  // Collect header file names that correspond to the merged .cpp files
  // These includes should be stripped from the entry sketch since the code is merged inline
  const mergedHeaderNames = new Set<string>();
  for (const cppPath of cppFiles) {
    const baseName = path.basename(cppPath, path.extname(cppPath));
    mergedHeaderNames.add(`${baseName}.h`);
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
  // Collect module names and their contents for namespace wrapping
  const moduleInfos: { namespaceName: string; content: string; relativePath: string }[] = [];
  
  for (const cppPath of cppFiles) {
    const relativePath = path.relative(sketchDir, cppPath).replace(/\\/g, "/");
    // Generate namespace name from the file name (without extension)
    // e.g., "bme280.cpp" -> "bme280", "lib/sensor.cpp" -> "lib_sensor"
    const baseName = path.basename(cppPath, path.extname(cppPath));
    const dirName = path.dirname(relativePath);
    const namespaceName = dirName && dirName !== "." 
      ? `${dirName.replace(/[\/\\]/g, "_")}_${baseName}`
      : baseName;
    
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
    
    // Skip modules whose body is empty after tree-shaking
    const stripped = sanitized
      .replace(/^\s*#include\s+.*$/gm, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (stripped.length === 0) {
      continue;
    }
    
    moduleInfos.push({ namespaceName, content: sanitized, relativePath });
  }

  // Wrap each module's content in a namespace to avoid naming conflicts
  const moduleContents = moduleInfos.map(({ namespaceName, content, relativePath }) => {
    // Indent content for namespace wrapping
    const indentedContent = content
      .split("\n")
      .map(line => line.length > 0 ? `  ${line}` : line)
      .join("\n");
    return `\n// ---- merged from ${relativePath} ----\nnamespace ${namespaceName} {\n${indentedContent}\n} // namespace ${namespaceName}\n`;
  }).join("");
  
  // Generate using declarations for entry sketch to access module symbols without qualification
  const usingDeclarations = moduleInfos.map(({ namespaceName }) => `using namespace ${namespaceName};`).join("\n");

  // Add using declarations before entry sketch so symbols are accessible without qualification
  const usingSection = usingDeclarations.length > 0 
    ? `\n// Import merged module symbols into global scope\n${usingDeclarations}\n` 
    : "";
  const mergedSketch = `${moduleContents}${usingSection}// ---- entry sketch ----\n${sanitizedSketch}\n`;
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
  const errors = parseCompileErrors(output, sketchDir);

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
