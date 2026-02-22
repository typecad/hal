import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { buildProgramIR } from "./ir/build-ir";
import { emitCpp } from "./emit/cpp-emitter";
import { GenerateLibdefOptions, GeneratedOutputs, TranspileOptions } from "./types";
import { readText } from "./utils/fs";
import { loadLibraryDefinitions, generateLibdefStubs } from "./libdef/registry";
import { createPolyfillRegistry, PolyfillContext } from "./polyfill";
import { ProgramIR, StatementIR, ExpressionIR } from "./ir/model";

function cleanStaleArduinoOutputs(outDir: string, currentBaseName: string): void {
  if (!fs.existsSync(outDir)) {
    return;
  }

  for (const fileName of fs.readdirSync(outDir)) {
    const fullPath = path.join(outDir, fileName);
    const lower = fileName.toLowerCase();
    const isSourceArtifact = lower.endsWith(".ino") || lower.endsWith(".cpp") || lower.endsWith(".h");
    const isMapArtifact = lower.endsWith(".tscppmap.json");
    if (!isSourceArtifact && !isMapArtifact) {
      continue;
    }

    const artifactBase = lower.endsWith(".tscppmap.json")
      ? path.basename(fileName.slice(0, -".tscppmap.json".length)).replace(/\.[^.]+$/, "")
      : path.basename(fileName).replace(/\.[^.]+$/, "");

    const isCurrentSketch = artifactBase === currentBaseName && (lower.endsWith(".ino") || lower.endsWith(".ino.tscppmap.json"));
    if (isCurrentSketch) {
      continue;
    }

    try {
      fs.unlinkSync(fullPath);
    } catch {
      // Ignore cleanup failures and continue with transpilation.
    }
  }
}

function resolveLocalImport(fromFile: string, moduleSpecifier: string): string | undefined {
  if (!moduleSpecifier.startsWith(".")) {
    return undefined;
  }

  const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }

    const extension = path.extname(candidate).toLowerCase();
    if (extension === ".ts" || extension === ".tsx") {
      return path.resolve(candidate);
    }
  }

  return undefined;
}

function collectTranspileGraph(entryFile: string): string[] {
  const ordered: string[] = [];
  const pending: string[] = [path.resolve(entryFile)];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const filePath = pending.shift();
    if (!filePath || visited.has(filePath)) {
      continue;
    }

    visited.add(filePath);
    ordered.push(filePath);

    const sourceText = readText(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const source = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      extension === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      let moduleSpecifier: string | undefined;

      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        moduleSpecifier = statement.moduleSpecifier.text;
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        moduleSpecifier = statement.moduleSpecifier.text;
      }

      if (!moduleSpecifier) {
        continue;
      }

      const resolved = resolveLocalImport(filePath, moduleSpecifier);
      if (resolved && !visited.has(resolved)) {
        pending.push(resolved);
      }
    }
  }

  return ordered;
}

function collectExpressionIdentifiers(expr: ExpressionIR, identifiers: Set<string>): void {
  if (expr.kind === "identifier") {
    identifiers.add(expr.value);
    return;
  }

  if (expr.kind === "raw") {
    const matches = expr.value.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (matches) {
      for (const match of matches) {
        identifiers.add(match);
      }
    }
    return;
  }

  if (expr.kind === "await") {
    collectExpressionIdentifiers(expr.value, identifiers);
    return;
  }

  if (expr.kind === "ternary") {
    collectExpressionIdentifiers(expr.condition, identifiers);
    collectExpressionIdentifiers(expr.whenTrue, identifiers);
    collectExpressionIdentifiers(expr.whenFalse, identifiers);
    return;
  }

  if (expr.kind === "array") {
    for (const element of expr.elements) {
      collectExpressionIdentifiers(element, identifiers);
    }
    return;
  }

  if (expr.kind === "object") {
    for (const field of expr.fields) {
      collectExpressionIdentifiers(field.value, identifiers);
    }
    return;
  }

  if (expr.kind === "instanceof") {
    collectExpressionIdentifiers(expr.object, identifiers);
    identifiers.add(expr.className);
    return;
  }

  if (expr.kind === "spread_array") {
    collectExpressionIdentifiers(expr.spreadExpr, identifiers);
    for (const element of expr.additionalElements) {
      collectExpressionIdentifiers(element, identifiers);
    }
  }
}

function collectStatementIdentifiers(statement: StatementIR, identifiers: Set<string>): void {
  if (statement.kind === "call") {
    identifiers.add(statement.callee);
    for (const arg of statement.args) {
      collectExpressionIdentifiers(arg, identifiers);
    }
    return;
  }

  if (statement.kind === "var_decl") {
    identifiers.add(statement.name);
    if (statement.initializer) {
      collectExpressionIdentifiers(statement.initializer, identifiers);
    }
    return;
  }

  if (statement.kind === "assign") {
    identifiers.add(statement.target);
    collectExpressionIdentifiers(statement.value, identifiers);
    return;
  }

  if (statement.kind === "update") {
    identifiers.add(statement.target);
    return;
  }

  if (statement.kind === "return") {
    if (statement.value) {
      collectExpressionIdentifiers(statement.value, identifiers);
    }
    return;
  }

  if (statement.kind === "while" || statement.kind === "do_while") {
    collectExpressionIdentifiers(statement.condition, identifiers);
    for (const nested of statement.body) {
      collectStatementIdentifiers(nested, identifiers);
    }
    return;
  }

  if (statement.kind === "if") {
    collectExpressionIdentifiers(statement.condition, identifiers);
    for (const nested of statement.thenBranch) {
      collectStatementIdentifiers(nested, identifiers);
    }
    for (const nested of statement.elseBranch ?? []) {
      collectStatementIdentifiers(nested, identifiers);
    }
    return;
  }

  if (statement.kind === "for") {
    if (statement.initializer) {
      collectStatementIdentifiers(statement.initializer, identifiers);
    }
    if (statement.condition) {
      collectExpressionIdentifiers(statement.condition, identifiers);
    }
    if (statement.increment) {
      collectStatementIdentifiers(statement.increment, identifiers);
    }
    for (const nested of statement.body) {
      collectStatementIdentifiers(nested, identifiers);
    }
    return;
  }

  if (statement.kind === "for_of") {
    collectStatementIdentifiers(statement.variable, identifiers);
    collectExpressionIdentifiers(statement.iterable, identifiers);
    for (const nested of statement.body) {
      collectStatementIdentifiers(nested, identifiers);
    }
    return;
  }

  if (statement.kind === "for_in") {
    collectStatementIdentifiers(statement.variable, identifiers);
    collectExpressionIdentifiers(statement.object, identifiers);
    for (const nested of statement.body) {
      collectStatementIdentifiers(nested, identifiers);
    }
    return;
  }

  if (statement.kind === "switch") {
    collectExpressionIdentifiers(statement.expression, identifiers);
    for (const caseClause of statement.cases) {
      if (caseClause.value) {
        collectExpressionIdentifiers(caseClause.value, identifiers);
      }
      for (const nested of caseClause.body) {
        collectStatementIdentifiers(nested, identifiers);
      }
    }
    return;
  }

  if (statement.kind === "try") {
    if (statement.catchParam) {
      identifiers.add(statement.catchParam);
    }
    for (const nested of statement.tryBlock) {
      collectStatementIdentifiers(nested, identifiers);
    }
    for (const nested of statement.catchBlock ?? []) {
      collectStatementIdentifiers(nested, identifiers);
    }
    return;
  }

  if (statement.kind === "throw") {
    collectExpressionIdentifiers(statement.value, identifiers);
  }
}

function collectUsedIdentifiers(program: ProgramIR): Set<string> {
  const identifiers = new Set<string>();

  for (const imported of program.imports) {
    identifiers.add(imported.moduleSpecifier);
    for (const symbol of imported.namedImports) {
      identifiers.add(symbol);
    }
  }

  for (const fn of program.functions) {
    identifiers.add(fn.originalName);
    for (const parameter of fn.parameters) {
      identifiers.add(parameter.name);
    }
    for (const statement of fn.statements) {
      collectStatementIdentifiers(statement, identifiers);
    }
  }

  for (const statement of program.topLevelStatements) {
    collectStatementIdentifiers(statement, identifiers);
  }

  for (const cls of program.classes) {
    identifiers.add(cls.name);
    for (const field of cls.fields) {
      identifiers.add(field.name);
      if (field.initializer) {
        collectExpressionIdentifiers(field.initializer, identifiers);
      }
    }
    for (const method of cls.methods) {
      identifiers.add(method.name);
      for (const parameter of method.parameters) {
        identifiers.add(parameter.name);
      }
      for (const statement of method.statements) {
        collectStatementIdentifiers(statement, identifiers);
      }
    }
    if (cls.constructor) {
      for (const parameter of cls.constructor.parameters) {
        identifiers.add(parameter.name);
      }
      for (const statement of cls.constructor.statements) {
        collectStatementIdentifiers(statement, identifiers);
      }
    }
  }

  for (const enumDef of program.enums) {
    identifiers.add(enumDef.name);
    for (const member of enumDef.members) {
      identifiers.add(member.name);
    }
  }

  for (const typeAlias of program.typeAliases) {
    identifiers.add(typeAlias.name);
  }

  return identifiers;
}

export function transpileFile(options: TranspileOptions): GeneratedOutputs {
  const entryFile = path.resolve(options.inputFile);
  const transpileFiles = collectTranspileGraph(entryFile);
  const sourceDir = path.dirname(entryFile);
  const outBaseDir = options.outDir ?? sourceDir;
  const outDir = path.join(outBaseDir, ".build");
  const currentBaseName = path.basename(entryFile).replace(/\.[^.]+$/, "");

  if (options.target === "arduino") {
    cleanStaleArduinoOutputs(outDir, currentBaseName);
  }

  const definitions = loadLibraryDefinitions(sourceDir);
  const polyfillRegistry = createPolyfillRegistry();

  let entryOutputs: GeneratedOutputs | undefined;
  const diagnostics = [] as GeneratedOutputs["diagnostics"];

  for (const filePath of transpileFiles) {
    const sourceText = readText(filePath);
    const programIR = buildProgramIR(filePath, sourceText);
    const polyfillContext: PolyfillContext = {
      target: options.target,
      architecture: options.platformContext?.arduino?.architecture,
      usedIdentifiers: collectUsedIdentifiers(programIR),
    };
    const polyfills = polyfillRegistry.detectAndGenerate(programIR, polyfillContext);

    const emitted = emitCpp(programIR, {
      outDir,
      emitMode: options.emitMode,
      target: options.target,
      libdefs: definitions,
      emitMaps: options.emitMaps,
      platformContext: options.platformContext,
      polyfills,
    });

    diagnostics.push(...emitted.diagnostics);
    if (filePath === entryFile) {
      entryOutputs = emitted;
    }
  }

  if (!entryOutputs) {
    throw new Error(`Unable to transpile entry file '${entryFile}'.`);
  }

  return {
    ...entryOutputs,
    diagnostics,
  };
}

export function generateLibraryDefinitions(options: GenerateLibdefOptions): string[] {
  const sourceText = readText(options.inputFile);
  const programIR = buildProgramIR(options.inputFile, sourceText);
  return generateLibdefStubs(options.inputFile, programIR.imports, options.outDir);
}
