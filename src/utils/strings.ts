import path from "node:path";

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function toModuleKey(moduleSpecifier: string): string {
  const normalized = moduleSpecifier.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  return stripExtension(base).toLowerCase();
}

export function toPascalCase(input: string): string {
  return input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

export function withLineColumn(content: string, position: number): { line: number; column: number } {
  const prefix = content.slice(0, position);
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}
