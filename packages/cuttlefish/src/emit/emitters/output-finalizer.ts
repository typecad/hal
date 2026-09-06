import path from "node:path";
import type { ProgramIR } from "../../api/index.js";
import type { GeneratedOutputs, SourceMapEntry } from "../../types.js";
import { writeText, readText } from "../../utils/fs.js";
import { makeGeneratedMap, writeSourceMap } from "../../mapping/source-map.js";
import { dedupe, resolveTranspiledModuleInclude } from "../utils/index.js";
import { appendHeaderLine } from "./line-appender.js";
import type { EmitterContext } from "./emitter-context.js";
import { runSelfCheck } from "../compliance/rule-engine.js";
import { renderRegistryJson } from "../compliance/deviation-writer.js";
import { renderArxml } from "../compliance/arxml-writer.js";
import type { Diagnostic } from "../../api/shared/index.js";

/** Derives a unique C preprocessor guard name from a source file path. */
function sanitizeGuardName(filePath: string): string {
  // Use the basename minus extension, uppercased, with non-alphanumeric
  // characters replaced by underscores.
  const base = filePath.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return base.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

/** Extracts a C preprocessor guard from a polyfill definition string. */
function polyfillDefinitionGuard(definition: string): string | null {
  // Match function names after 'inline', 'template<...>', or at start of line.
  // Handles: "inline double __tc_random() { ... }"
  //          "template<typename T> std::string __tc_join(...) { ... }"
  //          "int __tc_setTimeout(...) { ... }"
  //          "struct __tc_task_state { ... };"
  const funcMatch = definition.match(/\b(__tc_\w+)\s*\(/);
  if (funcMatch) return `__TC_POLYFILL_${funcMatch[1].toUpperCase()}`;
  const structMatch = definition.match(/\b(struct|class)\s+(\w+)/);
  if (structMatch) return `__TC_POLYFILL_${structMatch[2].toUpperCase()}`;
  return null;
}

export function emitPreamble(ctx: EmitterContext): void {
  const { strategy, effectiveEmitMode, program, shimLines, emittedPolyfills, includes, programAnalysis } = ctx;

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
      if (effectiveEmitMode === "split") {
        // Use per-definition guards based on function/struct names so that
        // the same inline helper (e.g. __tc_random) is only defined once
        // even when multiple headers are included by the same TU.
        for (const definition of emittedPolyfills.definitions) {
          const guard = polyfillDefinitionGuard(definition);
          if (guard) {
            appendHeaderLine(ctx, `#ifndef ${guard}`);
            appendHeaderLine(ctx, `#define ${guard}`);
          }
          appendHeaderLine(ctx, definition.trimEnd());
          if (guard) {
            appendHeaderLine(ctx, `#endif // ${guard}`);
          }
        }
        appendHeaderLine(ctx, "");
      } else {
        for (const definition of emittedPolyfills.definitions) {
          appendSourceLineLocal(ctx, definition.trimEnd());
          appendSourceLineLocal(ctx, "");
        }
      }
    }
  }

  // Shim lines (CUTTLEFISH_UNDEFINED, nullish helpers) must come BEFORE
  // async task classes — the async state machine references CUTTLEFISH_UNDEFINED
  // for default timeout values (e.g. waitForRising with no timeout arg).
  if (shimLines.length > 0) {
    for (const line of shimLines) {
      appendSourceLineLocal(ctx, line);
    }
    appendSourceLineLocal(ctx, "");
  }

  // Async task classes are emitted later (emitAsyncTaskClasses) AFTER top-level
  // globals so references like WIFI_SSID inside the state machine compile.

  if (programAnalysis.hasGenerators) {
    appendSourceLineLocal(ctx, "#include <coroutine>");
    appendSourceLineLocal(ctx, "#include <optional>");
    appendSourceLineLocal(ctx, "");
    appendSourceLineLocal(ctx, "template<typename T>");
    appendSourceLineLocal(ctx, "struct __tc_Generator {");
    appendSourceLineLocal(ctx, "  struct promise_type {");
    appendSourceLineLocal(ctx, "    T current_value;");
    appendSourceLineLocal(ctx, "    auto get_return_object() { return __tc_Generator{std::coroutine_handle<promise_type>::from_promise(*this)}; }");
    appendSourceLineLocal(ctx, "    auto initial_suspend() { return std::suspend_always{}; }");
    appendSourceLineLocal(ctx, "    auto final_suspend() noexcept { return std::suspend_always{}; }");
    appendSourceLineLocal(ctx, "    auto yield_value(T value) { current_value = value; return std::suspend_always{}; }");
    appendSourceLineLocal(ctx, "    void return_void() {}");
    appendSourceLineLocal(ctx, "    void unhandled_exception() { throw; }");
    appendSourceLineLocal(ctx, "  };");
    appendSourceLineLocal(ctx, "  std::coroutine_handle<promise_type> handle;");
    appendSourceLineLocal(ctx, "  __tc_Generator(std::coroutine_handle<promise_type> h) : handle(h) {}");
    appendSourceLineLocal(ctx, "  ~__tc_Generator() { if (handle) handle.destroy(); }");
    appendSourceLineLocal(ctx, "  __tc_Generator(const __tc_Generator&) = delete;");
    appendSourceLineLocal(ctx, "  __tc_Generator(__tc_Generator&& other) noexcept : handle(other.handle) { other.handle = nullptr; }");
    appendSourceLineLocal(ctx, "  bool next() { handle.resume(); return !handle.done(); }");
    appendSourceLineLocal(ctx, "  T value() { return handle.promise().current_value; }");
    appendSourceLineLocal(ctx, "  struct iterator {");
    appendSourceLineLocal(ctx, "    std::coroutine_handle<promise_type> handle;");
    appendSourceLineLocal(ctx, "    bool done;");
    appendSourceLineLocal(ctx, "    iterator& operator++() { handle.resume(); done = handle.done(); return *this; }");
    appendSourceLineLocal(ctx, "    T operator*() { return handle.promise().current_value; }");
    appendSourceLineLocal(ctx, "    bool operator!=(const iterator& other) const { return done != other.done; }");
    appendSourceLineLocal(ctx, "  };");
    appendSourceLineLocal(ctx, "  iterator begin() { handle.resume(); return {handle, handle.done()}; }");
    appendSourceLineLocal(ctx, "  iterator end() { return {handle, true}; }");
    appendSourceLineLocal(ctx, "};");
    appendSourceLineLocal(ctx, "");
  }
}

/**
 * Emit cooperative async state-machine classes. Must run AFTER top-level
 * globals (emitTypeDeclarations) so identifiers like WIFI_SSID referenced
 * from task bodies are already declared.
 */
export function emitAsyncTaskClasses(ctx: EmitterContext): void {
  const { asyncTaskClasses } = ctx;
  if (asyncTaskClasses.length === 0) return;
  for (const t of asyncTaskClasses) {
    // Async-METHOD tasks move to emitAsyncMethodTasks (after the user
    // classes): their segment bodies dereference `_owner->field`, which
    // needs the owning class COMPLETE — at this point only the forward
    // declaration exists.
    if (t.starterDef !== undefined) continue;
    for (const line of t.classDef.split("\n")) {
      appendSourceLineLocal(ctx, line);
    }
    appendSourceLineLocal(ctx, "");
    appendSourceLineLocal(ctx, t.instanceDecl);
    appendSourceLineLocal(ctx, "");
  }
}

/**
 * Emit async-METHOD task classes + instances + starter definitions. Must run
 * AFTER emitClasses (segments dereference _owner->field on the now-complete
 * owning class) and BEFORE emitFunctions (the loop pump references the
 * instances; the starter definitions call .start on them).
 */
export function emitAsyncMethodTasks(ctx: EmitterContext): void {
  const { asyncTaskClasses } = ctx;
  for (const t of asyncTaskClasses) {
    if (t.starterDef === undefined) continue;
    for (const line of t.classDef.split("\n")) {
      appendSourceLineLocal(ctx, line);
    }
    appendSourceLineLocal(ctx, "");
    appendSourceLineLocal(ctx, t.instanceDecl);
    appendSourceLineLocal(ctx, t.starterDef);
    appendSourceLineLocal(ctx, "");
  }
}

export function finalizeOutput(ctx: EmitterContext): GeneratedOutputs {
  const { program, strategy, options, effectiveEmitMode, isNpmPackage, baseName, includes, shimLines, emittedPolyfills } = ctx;
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

    // Non-entry split-file headers may contain inline class method bodies
    // that emit cuttlefish_nullish(...) calls (from `??` lowering). The
    // helper shim is appended to the .cpp source via appendHelpers above,
    // but the .h header — which is #included by the entry .cpp and by other
    // headers — also needs the shim, because the inline method bodies live
    // in the header. The shim is wrapped in a single #ifndef guard so
    // emitting it into every non-entry header is safe.
    //
    // To decide whether THIS header needs the shim, scan its already-emitted
    // lines for an actual cuttlefish_nullish( call. The programAnalysis flag
    // is unreliable here (it's computed per-file before emit, and class
    // method bodies on abstract bases can produce cuttlefish_nullish calls
    // the analysis didn't attribute). A post-emit text scan is exact.
    if (!ctx.isEntryFile && shimLines.length > 0) {
      const headerNeedsNullish = finalHeaderLines.some(l => l.includes('cuttlefish_nullish('));
      if (headerNeedsNullish) {
        let insertIdx = 1;
        while (insertIdx < finalHeaderLines.length) {
          const l = finalHeaderLines[insertIdx].trim();
          // Skip blank lines, includes, comments, and forward declarations
          // (e.g. `class Foo;`) — these are all preamble.
          if (l === "" || l.startsWith("#include") || l.startsWith("//") || /^class\s+\w+\s*;$/.test(l)) {
            insertIdx++;
            continue;
          }
          break;
        }
        finalHeaderLines.splice(insertIdx, 0, ...shimLines, "");
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

  // NOTE: The file-wide `\b${varName}\.` → `${varName}->` text sweep that lived
  // here has been REMOVED. The `->`/`.` decision for global pointer variables
  // (including ISR-captured ones like `const btn = new Button()` accessed inside
  // a hoisted callback) is now made structurally by ExpressionRenderer, which
  // consults `globalPointerVarTypes` (threaded in from this context) in
  // inferExpressionCppType. That decision runs per-IR-node with the resolved
  // symbol/type, replacing the name-keyed regex that operated on joined output
  // text and could not distinguish a global pointer variable from a same-named
  // value field/member (the demo #15–#23 failure class).

  writeText(sourcePath, ctx.sourceLines.join("\n").trimEnd() + "\n");
  const outputSourceMapPath = options.emitMaps
    ? writeSourceMap(makeGeneratedMap(sourcePath, program.fileName, ctx.sourceMapEntries))
    : undefined;

  const diagnostics = [...program.diagnostics, ...ctx.profileDiagnostics, ...ctx.emitDiagnostics];
  diagnostics.push(...strategy.emitDiagnostics(options.emitMode));

  // ── AUTOSAR compliance self-check + sidecar ────────────────────────────
  // Runs only when --autosar is warn or strict. Emits an AUTOSAR_<ruleId>
  // diagnostic per finding (severity: error for required unrecorded
  // violations in strict mode, otherwise warning) and writes the sidecar
  // deviation registry next to the emitted artifact.
  if (ctx.compliance.isEnabled()) {
    // Scan the ACTUAL file content (post-writeText) rather than ctx.sourceLines,
    // because some ctx.sourceLines entries contain embedded newlines (e.g. ESP32
    // shim blocks pushed as multi-line strings), making array indices != file
    // line numbers. Reading the written file gives correct 1:1 line numbers.
    const actualSourceLines = outputHeaderPath
      ? readText(sourcePath).split("\n")
      : readText(sourcePath).split("\n");
    const actualHeaderLines = outputHeaderPath
      ? readText(outputHeaderPath).split("\n")
      : [];
    const findings = runSelfCheck(ctx.compliance, actualSourceLines, actualHeaderLines);
    const mode = ctx.compliance.mode();

    // Helper: map a C++ generated line back to its originating TS source
    // line via the source map, so diagnostics point at the user's code.
    const mapCppLineToTs = (cppLine: number): { filePath: string; line: number } | null => {
      // Find the source-map entry whose generated range covers cppLine.
      // Entries are ordered by generatedStartLine; find the last one whose
      // start is ≤ cppLine.
      let best: SourceMapEntry | null = null;
      for (const entry of ctx.sourceMapEntries) {
        if (entry.generatedStartLine <= cppLine) {
          if (!best || entry.generatedStartLine > best.generatedStartLine) {
            best = entry;
          }
        }
      }
      if (best) {
        return { filePath: best.tsSpan.filePath, line: best.tsSpan.startLine };
      }
      return null;
    };

    for (const f of findings) {
      const isError =
        mode === "strict" &&
        f.kind === "unrecorded-violation" &&
        f.severity === "required";

      // Map the C++ line back to TS so the diagnostic points at user code.
      const tsLoc = mapCppLineToTs(f.line);
      const emittedFile = f.file === "header" ? `${baseName}.h` : path.basename(sourcePath);
      const cppRef = `${emittedFile}:${f.line}`;
      const tsRef = tsLoc ? `${path.basename(tsLoc.filePath)}:${tsLoc.line}` : null;
      const locationDesc = tsRef
        ? `${tsRef} (emitted at ${cppRef})`
        : cppRef;

      const diag: Diagnostic = {
        severity: isError ? "error" : "warning",
        code: `AUTOSAR_${f.ruleId}`,
        message: `AUTOSAR ${f.ruleId} ${f.kind} at ${locationDesc}: ${f.snippet}`,
        // Point the diagnostic at the TS source line (if mapped) so the
        // CLI's file:line:col display is meaningful to the user. If the
        // violation is in framework/runtime shim code with no TS origin,
        // point at the emitted C++ artifact instead.
        filePath: tsLoc?.filePath ?? sourcePath,
        line: tsLoc?.line ?? f.line,
        column: 1,
      };
      diagnostics.push(diag);
    }

    // Sidecar deviation registry — written for both warn and strict modes
    // alongside the emitted artifact (mirrors how .thcppmap.json sits next
    // to the .cpp today).
    const toolVersion = options.toolVersion ?? "unknown";
    const registryPath = path.join(outDir, `${baseName}.autosar-deviations.json`);
    writeText(registryPath, renderRegistryJson(ctx.compliance, path.basename(sourcePath), toolVersion));

    // Optional ARXML projection (Artop/DaVinci tooling). Gated behind
    // --autosar-arxml so projects that don't need it pay no cost.
    if (options.autosarArxml) {
      const arxmlPath = path.join(outDir, `${baseName}.autosar-deviations.arxml`);
      writeText(arxmlPath, renderArxml(ctx.compliance, path.basename(sourcePath)));
    }
  }

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
