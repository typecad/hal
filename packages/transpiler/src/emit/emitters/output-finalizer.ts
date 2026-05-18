import path from "node:path";
import type { ProgramIR } from "@typehal/core";
import type { GeneratedOutputs, SourceMapEntry } from "../../types";
import { writeText } from "../../utils/fs";
import { makeGeneratedMap, writeSourceMap } from "../../mapping/source-map";
import { dedupe, hasConsoleCalls, resolveTranspiledModuleInclude } from "../utils";
import type { EmitterContext } from "./emitter-context";

export function emitPreamble(ctx: EmitterContext): void {
  const { strategy, effectiveEmitMode, program, shimLines, emittedPolyfills, asyncTaskClasses, includes, programAnalysis } = ctx;

  for (const include of dedupe(includes)) {
    appendSourceLineLocal(ctx, `#include ${include}`);
  }
  appendSourceLineLocal(ctx, "");

  if (emittedPolyfills) {
    if (emittedPolyfills.declarations.length > 0) {
      for (const declaration of emittedPolyfills.declarations) {
        appendSourceLineLocal(ctx, declaration);
      }
      appendSourceLineLocal(ctx, "");
    }
    if (emittedPolyfills.definitions.length > 0) {
      for (const definition of emittedPolyfills.definitions) {
        appendSourceLineLocal(ctx, definition.trimEnd());
        appendSourceLineLocal(ctx, "");
      }
    }
  }

  if (asyncTaskClasses.length > 0) {
    for (const { classDef, instanceDecl } of asyncTaskClasses) {
      for (const line of classDef.split("\n")) {
        appendSourceLineLocal(ctx, line);
      }
      appendSourceLineLocal(ctx, "");
      appendSourceLineLocal(ctx, instanceDecl);
      appendSourceLineLocal(ctx, "");
    }
  }

  if (strategy.needsVectorOverload() && hasConsoleCalls(program, strategy) && (programAnalysis.usesVectorTypes || programAnalysis.hasArrayInObjectLiteral)) {
    appendSourceLineLocal(ctx, "template <typename T>");
    appendSourceLineLocal(ctx, "std::ostream& operator<<(std::ostream& os, const std::vector<T>& values)");
    appendSourceLineLocal(ctx, "{");
    appendSourceLineLocal(ctx, '  os << "[";');
    appendSourceLineLocal(ctx, "  for (size_t i = 0; i < values.size(); ++i)");
    appendSourceLineLocal(ctx, "  {");
    appendSourceLineLocal(ctx, "    if (i > 0)");
    appendSourceLineLocal(ctx, "    {");
    appendSourceLineLocal(ctx, '      os << ", ";');
    appendSourceLineLocal(ctx, "    }");
    appendSourceLineLocal(ctx, "    os << values[i];");
    appendSourceLineLocal(ctx, "  }");
    appendSourceLineLocal(ctx, '  os << "]";');
    appendSourceLineLocal(ctx, "  return os;");
    appendSourceLineLocal(ctx, "}");
    appendSourceLineLocal(ctx, "");
  }

  if (shimLines.length > 0) {
    for (const line of shimLines) {
      appendSourceLineLocal(ctx, line);
    }
    appendSourceLineLocal(ctx, "");
  }
}

export function finalizeOutput(ctx: EmitterContext): GeneratedOutputs {
  const { program, strategy, options, effectiveEmitMode, isNpmPackage, baseName, includes, shimLines, emittedPolyfills, globalPointerVarTypes } = ctx;
  const outDir = options.outDir;
  const sourceExtension = strategy.sourceExtension(ctx.isEntryFile, isNpmPackage);
  const headerPath = path.join(outDir, `${baseName}.h`);
  const sourcePath = path.join(outDir, `${baseName}.${sourceExtension}`);

  let outputHeaderPath: string | undefined;
  let outputHeaderMapPath: string | undefined;

  if (effectiveEmitMode === "split") {
    // Re-export includes to the header
    const headerIncludes: string[] = [];
    for (const reExport of program.reExports) {
      const transpiledInclude = resolveTranspiledModuleInclude(
        reExport.moduleSpecifier,
        options.npmPackages,
        program.fileName
      );
      if (transpiledInclude.isTranspiled) {
        headerIncludes.push(transpiledInclude.include);
        continue;
      }
      if (reExport.moduleSpecifier.startsWith(".")) {
        let modulePath = reExport.moduleSpecifier;
        modulePath = modulePath.replace(/\.js$/, "").replace(/\.mjs$/, "");
        const segments = modulePath.split("/");
        const baseName = segments[segments.length - 1] || segments[segments.length - 2];
        const headerName = `${baseName}.h`;
        headerIncludes.push(`"${headerName}"`);
      }
    }

    const finalHeaderLines = [...ctx.headerLines];
    const headerIncludeLines = dedupe([
      ...includes,
      ...headerIncludes,
    ]);
    if (headerIncludeLines.length > 0) {
      const includeLines = headerIncludeLines.map((inc) => `#include ${inc}`);
      finalHeaderLines.splice(1, 0, ...includeLines, "");
    }

    // Cross-module class forward declarations
    if (options.crossModuleClasses && options.crossModuleClasses.size > 0) {
      const localClasses = new Set(program.classes.map(cls => cls.name));
      const importedSymbols = new Set<string>();
      for (const imp of program.imports) {
        for (const sym of imp.namedImports) {
          importedSymbols.add(sym);
        }
      }
      const forwardDecls: string[] = [];
      for (const className of options.crossModuleClasses) {
        if (!localClasses.has(className) && importedSymbols.has(className)) {
          forwardDecls.push(`class ${className};`);
        }
      }
      if (forwardDecls.length > 0) {
        let insertIdx = 1;
        while (insertIdx < finalHeaderLines.length &&
          (finalHeaderLines[insertIdx].startsWith("#include") ||
            finalHeaderLines[insertIdx] === "")) {
          insertIdx++;
        }
        finalHeaderLines.splice(insertIdx, 0, ...forwardDecls, "");
      }
    }

    writeText(headerPath, finalHeaderLines.join("\n").trimEnd() + "\n");
    outputHeaderPath = headerPath;
    if (options.emitMaps) {
      outputHeaderMapPath = writeSourceMap(makeGeneratedMap(headerPath, program.fileName, ctx.headerMapEntries));
    }
  }

  // Non-entry Arduino files: header-only
  const sourceExtension2 = strategy.sourceExtension(ctx.isEntryFile, isNpmPackage);
  if (sourceExtension2 === "h" && !isNpmPackage) {
    ctx.sourceLines.unshift("#pragma once", "");
  }

  // Post-process pointer -> transform
  if (typeof globalPointerVarTypes !== "undefined" && globalPointerVarTypes.size > 0) {
    const pointerNames = Array.from(globalPointerVarTypes.keys()).filter((varName) => {
      const varType = globalPointerVarTypes.get(varName);
      return typeof varType === "string" && varType.trim().endsWith("*");
    });
    if (pointerNames.length > 0) {
      const shimLineCount = shimLines.length + (shimLines.length > 0 ? 1 : 0);
      const polyfillLineCount = emittedPolyfills
        ? emittedPolyfills.declarations.join("\n").split("\n").length +
          emittedPolyfills.definitions.join("\n").split("\n").length
        : 0;
      const protectedLineCount = shimLineCount + polyfillLineCount;

      let userCodeStartIdx = 0;
      for (let i = 0; i < ctx.sourceLines.length; i++) {
        const line = ctx.sourceLines[i];
        if (line.includes("// TypeHAL Native Polyfills") || line.includes("// String helpers")) {
          userCodeStartIdx = i + protectedLineCount;
          break;
        }
      }

      if (userCodeStartIdx > 0 && userCodeStartIdx < ctx.sourceLines.length) {
        const protectedLines = ctx.sourceLines.slice(0, userCodeStartIdx);
        const userLines = ctx.sourceLines.slice(userCodeStartIdx);
        const userText = userLines.join("\n");
        const fixedUserText = pointerNames.reduce((text, varName) => {
          const pattern = new RegExp(`\\b${varName}\\.`, "g");
          return text.replace(pattern, `${varName}->`);
        }, userText);
        ctx.sourceLines = [...protectedLines, ...fixedUserText.split("\n")];
      }
    }
  }

  writeText(sourcePath, ctx.sourceLines.join("\n").trimEnd() + "\n");
  const outputSourceMapPath = options.emitMaps
    ? writeSourceMap(makeGeneratedMap(sourcePath, program.fileName, ctx.sourceMapEntries))
    : undefined;

  const diagnostics = [...program.diagnostics, ...ctx.profileDiagnostics];
  diagnostics.push(...strategy.emitDiagnostics(options.emitMode));

  return {
    headerPath: outputHeaderPath,
    sourcePath,
    headerMapPath: outputHeaderMapPath,
    sourceMapPath: outputSourceMapPath,
    diagnostics,
    asyncTaskNames: ctx.asyncTaskClasses.map(t => t.taskVarName),
    usesTimers: ctx.usesTimers,
  };
}

function appendSourceLineLocal(
  ctx: EmitterContext,
  line: string,
): void {
  ctx.sourceLines.push(line);
}
