import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { Diagnostic } from "../types";
import { makeDiagnostic } from "../ir/ast-node-utils";

/**
 * Result of type-checking files
 */
export interface TypeCheckResult {
  /** Whether all files passed type-checking */
  success: boolean;
  /** Array of formatted error messages */
  errors: string[];
  /** Auto-generated declaration files (for user notification) */
  generatedDecls: string[];
  /**
   * The TypeScript Program built during type-checking. Present only on success
   * (so callers can run semantic gates without rebuilding it). Undefined when
   * type-checking failed or was skipped.
   */
  program?: ts.Program;
}

/**
 * Type-checks TypeScript files using the TypeScript compiler.
 * Returns early if any errors are found.
 * 
 * @param files List of TypeScript files to type-check
 * @param _boardPackage Optional board package for resolving @typecad imports
 * @param entryFile Entrypoint sketch/main file
 * @returns TypeCheckResult with success status and any error messages
 */
export function typeCheckFiles(
  files: string[],
  _boardPackage?: string,
  entryFile?: string,
): TypeCheckResult {
  // Find the nearest tsconfig.json by walking up from the entry file (preferred)
  // or the first file in the graph. Using the entry file ensures we pick up the
  // user's tsconfig (with path mappings) rather than a dependency's tsconfig.
  let configPath: string | undefined;
  let currentDir = path.dirname(entryFile ?? files[0]);
  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  // Read compiler options from tsconfig.json if found
  let compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  };
  let rootNames = [...files];

  if (configPath) {
    const configResult = ts.readConfigFile(configPath, (path) => fs.readFileSync(path, "utf8"));
    if (!configResult.error) {
      const parsedConfig = ts.parseJsonConfigFileContent(
        configResult.config,
        ts.sys,
        path.dirname(configPath),
      );
      if (!parsedConfig.errors.length) {
        compilerOptions = { ...parsedConfig.options, noEmit: true };
        // Include cuttlefish-env.d.ts so module augmentations are visible to the type-checker
        const envDts = path.join(path.dirname(configPath), "cuttlefish-env.d.ts");
        if (fs.existsSync(envDts) && !rootNames.includes(envDts)) {
          rootNames.push(envDts);
        }
      }
    }
  }

  // Create a TypeScript program with the transpile graph files, using compiler options from tsconfig
  const program = ts.createProgram(rootNames, compilerOptions);

  // Collect all diagnostics
  const allDiagnostics: ts.Diagnostic[] = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];

  // Filter to only errors (ignore suggestions and hints)
  // Also skip errors from files in node_modules or packages directories (not user code)
  const errors = allDiagnostics.filter(d => {
    if (d.category !== ts.DiagnosticCategory.Error) {
      return false;
    }
    // Include errors without a file (global errors)
    if (!d.file) {
      return true;
    }
    const filePath = d.file.fileName.replace(/\\/g, "/");
    // Skip errors from node_modules and internal packages
    if (filePath.includes("/node_modules/") || filePath.includes("/packages/")) {
      return false;
    }
    return true;
  });

  if (errors.length === 0) {
    return { success: true, errors: [], generatedDecls: [], program };
  }

  // Format error messages
  const formattedErrors: string[] = [];
  for (const error of errors) {
    const message = ts.flattenDiagnosticMessageText(error.messageText, "\n");
    if (error.file && error.start !== undefined) {
      const { line, character } = error.file.getLineAndCharacterOfPosition(error.start);
      const relativePath = path.relative(process.cwd(), error.file.fileName);
      formattedErrors.push(`${relativePath}(${line + 1}:${character + 1}): ${message}`);
    } else {
      formattedErrors.push(message);
    }
  }

  return { success: false, errors: formattedErrors, generatedDecls: [] };
}

// ---------------------------------------------------------------------------
// Semantic gates (Phase 3)
//
// These checks require a TypeChecker and therefore cannot live in the
// syntactic feature-prescan. They run after a successful typeCheckFiles and
// emit structured Diagnostic[] (severity "error") that flow through the
// normal ProgramIR.diagnostics channel. They never throw.
// ---------------------------------------------------------------------------

/**
 * Bucket a resolved type into a coarse "kind" used to detect heterogeneous
 * array literals. Numeric and boolean collapse to one bucket because the
 * transpiler widens bool to int silently (an accepted trade-off — see Q2 of
 * the semantic-gate plan). `any`, nullish types, and `void` are skipped.
 */
function classifyElementType(type: ts.Type): "numeric" | "string" | "object" | null {
  const flags = type.flags;
  // Skip `any`/`unknown` — the explicit-any gate (Phase 2) already flags the
  // source. Skip null/undefined/void — they do not conflict with primitives.
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Null |
               ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never)) {
    return null;
  }
  if (flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike)) {
    return "numeric";
  }
  if (flags & (ts.TypeFlags.StringLike)) {
    return "string";
  }
  // BigInt widens to a distinct C++ type — treat like numeric for the
  // widening-friendly case but as its own signal if it's the only object-ish
  // thing? Keep it simple: bigint is numeric-compatible.
  if (flags & ts.TypeFlags.BigIntLike) {
    return "numeric";
  }
  // Anything else (object, class, enum, union of distinct primitives, array,
  // function, etc.) is an object bucket.
  return "object";
}

/**
 * Run semantic gates against the user files of a type-checked program.
 *
 * @param program  The TypeScript Program built by typeCheckFiles.
 * @param userFiles  Absolute paths of user (transpile-graph) files to scan.
 *                   Files outside this set (node_modules, internal packages)
 *                   are skipped even if present in the program.
 * @returns Diagnostic[] — never throws.
 */
export function runSemanticGates(
  program: ts.Program,
  userFiles: string[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const checker = program.getTypeChecker();

  // Normalise the user-file set for membership lookup.
  const userFileSet = new Set(userFiles.map(f => f.replace(/\\/g, "/")));

  // Pre-compute the set of interface names across all user files. Interfaces
  // are type-only: `getSymbolAtLocation` on `new IFoo()` returns undefined
  // (interfaces have no value symbol), so we resolve the name against this set
  // instead. Names are unique enough for diagnostic purposes; if a class and
  // an interface share a name in the same scope, TS itself errors.
  const interfaceNames = new Set<string>();
  for (const sf of program.getSourceFiles()) {
    const p = sf.fileName.replace(/\\/g, "/");
    if (!userFileSet.has(p)) continue;
    if (p.includes("/node_modules/") || p.includes("/packages/")) continue;
    const collect = (n: ts.Node): void => {
      if (ts.isInterfaceDeclaration(n) && n.name) {
        interfaceNames.add(n.name.text);
      }
      ts.forEachChild(n, collect);
    };
    ts.forEachChild(sf, collect);
  }

  for (const sourceFile of program.getSourceFiles()) {
    const filePath = sourceFile.fileName.replace(/\\/g, "/");
    // Only scan user code — skip lib.d.ts, node_modules, and internal packages.
    if (!userFileSet.has(filePath)) continue;
    if (filePath.includes("/node_modules/") || filePath.includes("/packages/")) {
      continue;
    }
    const sourceText = sourceFile.getFullText();

    const visit = (node: ts.Node): void => {
      // 1. Heterogeneous array literals.
      if (ts.isArrayLiteralExpression(node)) {
        const contextual = checker.getContextualType(node);
        // Tuple contextual types are intentionally heterogeneous — skip.
        const isTupleContext = contextual && checker.isTupleType(contextual);
        if (!isTupleContext && node.elements.length > 1) {
          const buckets = new Set<"numeric" | "string" | "object">();
          for (const element of node.elements) {
            // Spread elements ([...x]) — skip rather than guess.
            if (ts.isSpreadElement(element)) continue;
            const t = checker.getTypeAtLocation(element);
            const bucket = classifyElementType(t);
            if (bucket) buckets.add(bucket);
          }
          if (buckets.size > 1) {
            const diag = makeDiagnostic(
              sourceText,
              node.getStart(),
              "Heterogeneous array literal has no single C++ element type.",
              "error",
              "TS2CPP_HETEROGENEOUS_ARRAY",
            );
            diag.hint = "Use a uniform element type (all numbers, all strings, or all objects), or declare an explicit tuple type: [number, string].";
            diag.sourceLine = extractLine(sourceText, diag.line);
            diag.source = "semantic-gate";
            diagnostics.push(diag);
          }
        }
      }

      // 2. new on interface (symbol-based — supersedes the Phase 2 heuristic
      //    by resolving across files).
      if (ts.isNewExpression(node)) {
        const target = node.expression;
        if (ts.isIdentifier(target)) {
          const name = target.text;
          // Resolve the value symbol (classes have one; interfaces do not).
          let sym = checker.getSymbolAtLocation(target);
          if (sym && (sym.flags & ts.SymbolFlags.Alias)) {
            try { sym = checker.getAliasedSymbol(sym); } catch { /* keep sym */ }
          }
          const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
          // Flag if the resolved declaration is an interface, OR if there is no
          // value symbol (interface used as a value) and the name matches a
          // known interface declaration anywhere in the program.
          const isInterfaceDecl = !!decl && ts.isInterfaceDeclaration(decl);
          const isInterfaceByName = !sym && interfaceNames.has(name);
          if (isInterfaceDecl || isInterfaceByName) {
            const diag = makeDiagnostic(
              sourceText,
              node.getStart(),
              `Cannot instantiate interface '${name}' — only class constructors are supported in C++.`,
              "error",
              "TS2CPP_NEW_ON_INTERFACE",
            );
            diag.hint = `Change 'interface ${name}' to 'class ${name}', or call a factory that returns a concrete class instance.`;
            diag.sourceLine = extractLine(sourceText, diag.line);
            diag.source = "semantic-gate";
            diagnostics.push(diag);
          }
        }
      }

      // 3. for...in over a Map / Record. `for (const k in m)` where `m` is a
      //    Map or Record lowers to iterating std::map pairs and indexing by a
      //    pair (malformed). Reject it at the semantic gate so users get a
      //    clear error before the broken C++ is emitted. Plain-object for...in
      //    is a separate path and is allowed.
      if (ts.isForInStatement(node)) {
        const iterType = checker.getTypeAtLocation(node.expression);
        const typeStr = checker.typeToString(iterType);
        const isMapOrRecord = /\b(Map|ReadonlyMap|Record)\b/.test(typeStr) || /\bstd::map\b/.test(typeStr);
        if (isMapOrRecord) {
          const diag = makeDiagnostic(
            sourceText,
            node.getStart(),
            `for...in over a ${typeStr} is not supported — the Map lowering iterates key-value pairs, not keys.`,
            "error",
            "TS2CPP_FORIN_ON_MAP",
          );
          diag.hint = "Use Object.keys(m).forEach(...), a for...of over Object.keys(m), or m.forEach((v, k) => ...).";
          diag.sourceLine = extractLine(sourceText, diag.line);
          diag.source = "semantic-gate";
          diagnostics.push(diag);
        }
      }

      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  return diagnostics;
}

function extractLine(sourceText: string, line1Indexed: number | undefined): string {
  if (line1Indexed == null) return "";
  const lines = sourceText.split("\n");
  const idx = line1Indexed - 1;
  return idx >= 0 && idx < lines.length ? lines[idx] : "";
}
