import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { Diagnostic } from "../types.js";
import { makeDiagnostic } from "../ir/ast-node-utils.js";
import { canonicalize, buildSemanticFacts } from "./semantic-facts.js";
import type { BindingResolver } from "./semantic-facts.js";
import { verifyFacts } from "./semantic-facts-verifier.js";
import { requireUIHook, hasUIHook } from "../ui-hook.js";

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
 * @param _boardTarget Optional board package for resolving @typecad/board imports
 * @param entryFile Entrypoint source/main file
 * @returns TypeCheckResult with success status and any error messages
 */
export function typeCheckFiles(
  files: string[],
  _boardTarget?: string,
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
        // `allowArbitraryExtensions` lets Node16 module resolution type-check
        // non-JS module imports such as `.ui.html` via generated
        // `<base>.d.<ext>.ts` declarations.
        compilerOptions = { ...parsedConfig.options, noEmit: true, allowArbitraryExtensions: true };
        // Include typecad-hal-env.d.ts so module augmentations are visible to the type-checker
        const envDts = path.join(path.dirname(configPath), ".typecad-hal", "typecad-hal-env.d.ts");
        if (fs.existsSync(envDts) && !rootNames.includes(envDts)) {
          rootNames.push(envDts);
        }
      }
    }
  }

  // @typecad/ui is optional — when the engine is not loaded there are no UI
  // modules and nothing to register with the type-checker.
  const uiModules = hasUIHook() ? requireUIHook().allUIModules() : [];
  if (uiModules.length > 0) {
    compilerOptions.allowArbitraryExtensions = true;
    const rootDirs = new Set((compilerOptions.rootDirs ?? []).map((dir) => path.resolve(dir)));
    for (const mod of uiModules) {
      rootDirs.add(mod.typeDeclSourceRoot);
      rootDirs.add(mod.typeDeclRoot);
      if (fs.existsSync(mod.typeDeclPath) && !rootNames.includes(mod.typeDeclPath)) {
        rootNames.push(mod.typeDeclPath);
      }
    }
    compilerOptions.rootDirs = [...rootDirs];
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

const FUNCTIONAL_METHOD_NAMES = new Set([
  "forEach",
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "find",
  "findIndex",
  "findLast",
  "some",
  "every",
  "flatMap",
]);

const MUTATING_ARRAY_METHOD_NAMES = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

type FunctionLikeNode =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;

type FunctionLikeWithBody = FunctionLikeNode & { body: ts.Block | ts.Expression };

/**
 * Function-context carried through the gate visitor. Slimmed down from the
 * pre-Phase-1 GateScope: the per-name binding Sets (mapValueCopyBindings,
 * arrayParams, typedArrayParams) and the declaredNames shadowing machinery
 * have moved to the SemanticFacts binding pass (orchestrator/semantic-facts.ts),
 * resolved per-identifier via BindingResolver. What remains is the enclosing
 * function context that the callback-capture gate (gate 11) still needs.
 */
interface GateScope {
  parent?: GateScope;
  functionNode?: FunctionLikeWithBody;
  inClassMethod: boolean;
}

function createChildScope(parent?: GateScope, overrides: Partial<GateScope> = {}): GateScope {
  return {
    parent,
    functionNode: parent?.functionNode,
    inClassMethod: parent?.inClassMethod ?? false,
    ...overrides,
  };
}

function isFunctionLikeWithBody(node: ts.Node): node is FunctionLikeWithBody {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)) &&
    !!node.body
  );
}

function isClassMethodLike(node: ts.Node): boolean {
  return (
    (ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent))
  );
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (true) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if ((ts as any).isSatisfiesExpression?.(current)) {
      current = (current as ts.Expression & { expression: ts.Expression }).expression;
      continue;
    }
    return current;
  }
}

// Type classification now lives in semantic-facts.ts#canonicalize, which is
// the single source of truth for "what kind of C++ concept does this type
// lower to?" These wrappers preserve the existing call sites exactly while
// routing through canonicalize(). Flag-based helpers (isStringLikeType,
// typeIncludesNullish) stay here because they test bit flags, not categories.

function isMapLikeType(checker: ts.TypeChecker, type: ts.Type): boolean {
  return canonicalize(checker, type) === "map";
}

function isSetLikeType(checker: ts.TypeChecker, type: ts.Type): boolean {
  return canonicalize(checker, type) === "set";
}

function isTypedArrayType(checker: ts.TypeChecker, type: ts.Type): boolean {
  return canonicalize(checker, type) === "typed-array";
}

function isArrayLikeType(checker: ts.TypeChecker, type: ts.Type): boolean {
  return canonicalize(checker, type) === "array";
}

function isStringLikeType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.StringLike) !== 0;
}

function isContainerType(checker: ts.TypeChecker, type: ts.Type): boolean {
  const c = canonicalize(checker, type);
  return c === "map" || c === "set";
}

function typeIncludesNullish(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(typeIncludesNullish);
  return (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0;
}

function isNullishExpression(node: ts.Expression): boolean {
  const expr = unwrapExpression(node);
  return expr.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expr) && expr.text === "undefined");
}

function isNullishCompareOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
}

function isAssignmentOperatorKind(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.CaretEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken;
}

function getRootIdentifierFromAccess(expr: ts.Expression): ts.Identifier | undefined {
  const current = unwrapExpression(expr);
  if (ts.isIdentifier(current)) return current;
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    return getRootIdentifierFromAccess(current.expression);
  }
  return undefined;
}

function isCompoundAccess(expr: ts.Expression): boolean {
  const current = unwrapExpression(expr);
  return ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current);
}

function isContainerLookupCall(node: ts.Expression, checker: ts.TypeChecker): boolean {
  const expr = unwrapExpression(node);
  if (!ts.isCallExpression(expr)) return false;
  const callee = unwrapExpression(expr.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const methodName = callee.name.text;
  if (methodName !== "get" && methodName !== "at") return false;

  const receiverType = checker.getTypeAtLocation(callee.expression);
  if (methodName === "get") {
    return isMapLikeType(checker, receiverType);
  }
  return isMapLikeType(checker, receiverType) ||
    isArrayLikeType(checker, receiverType) ||
    isTypedArrayType(checker, receiverType) ||
    isStringLikeType(receiverType);
}

function getContainerLookupMethodName(node: ts.Expression): string | undefined {
  const expr = unwrapExpression(node);
  if (!ts.isCallExpression(expr)) return undefined;
  const callee = unwrapExpression(expr.expression);
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

function isOptionalFieldAccess(node: ts.Expression, checker: ts.TypeChecker): boolean {
  const expr = unwrapExpression(node);
  if (!ts.isPropertyAccessExpression(expr)) return false;
  const symbol = checker.getSymbolAtLocation(expr.name);
  const declarations = symbol?.declarations ?? [];
  if (declarations.some(decl =>
    (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) &&
    !!decl.questionToken
  )) {
    return true;
  }
  return typeIncludesNullish(checker.getTypeAtLocation(expr));
}

function getFunctionReturnTypeNode(node: FunctionLikeWithBody): ts.TypeNode | undefined {
  if (ts.isConstructorDeclaration(node)) return undefined;
  return node.type;
}

function getCallbackFunction(node: ts.Expression): FunctionLikeWithBody | undefined {
  const expr = unwrapExpression(node);
  if ((ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) && expr.body) {
    return expr;
  }
  return undefined;
}

function nodeContains(container: ts.Node, candidate: ts.Node): boolean {
  return candidate.pos >= container.pos && candidate.end <= container.end;
}

function isCaptureInsideCallback(callback: FunctionLikeWithBody, enclosingFunction: FunctionLikeWithBody, checker: ts.TypeChecker): boolean {
  let captured = false;
  const visit = (node: ts.Node): void => {
    if (captured) return;
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      captured = true;
      return;
    }
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declarations = symbol?.declarations ?? [];
      if (declarations.some(decl =>
        nodeContains(enclosingFunction, decl) &&
        !nodeContains(callback, decl) &&
        decl.getSourceFile() === callback.getSourceFile()
      )) {
        captured = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(callback.body, visit);
  return captured;
}

function makeSemanticGateDiagnostic(
  sourceText: string,
  node: ts.Node,
  message: string,
  code: string,
  hint: string,
): Diagnostic {
  const diag = makeDiagnostic(sourceText, node.getStart(), message, "error", code);
  diag.hint = hint;
  diag.sourceLine = extractLine(sourceText, diag.line);
  diag.source = "semantic-gate";
  return diag;
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
  const seenDiagnostics = new Set<string>();

  // Build the SemanticFacts store + binding resolver once. The mutation gates
  // (TS2CPP_MAP_VALUE_COPY_MUTATION, TS2CPP_ARRAY_PARAM_MUTATION,
  // TS2CPP_TYPED_ARRAY_PARAM_LENGTH) consume the resolver instead of the old
  // name-based scope-chain Sets, which were shadowing-fragile.
  const { facts, diagnostics: analysisDiagnostics, resolver } = buildSemanticFacts(program, userFiles);
  diagnostics.push(...analysisDiagnostics);

  // Phase 3 completeness verifier. Walks every expression and reports any
  // whose canonical type is "unknown" (any/unknown leak or an unclassified
  // type). Severity defaults to "warning" so existing builds aren't broken —
  // see semantic-facts-verifier.ts header for the rationale. This is the last
  // producer of analysis diagnostics; the gates below produce rule diagnostics.
  //
  // The FactStore is passed in so the verifier's existing walk also POPULATES
  // the concrete per-expression type facts (SemanticFacts.type + cppType) —
  // Phase 3 of the type-resolution consolidation. Gate rules can then read
  // facts.cppType without re-deriving it from the ts.TypeChecker.
  const verifierResult = verifyFacts(program, userFiles, { facts });
  diagnostics.push(...verifierResult.diagnostics);

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

  // ── Global name-collision pre-scan (demo #25 Finding B) ──────────────────
  // A user `class Node {}` (or interface/enum/type alias) whose name collides
  // with a globally-visible lib declaration (the DOM `Node`, `Element`,
  // `Event`, etc.) is shadowed by that global at every unqualified use site,
  // producing a cascade of spurious "property does not exist" / "duplicate
  // identifier" errors from the TS type-checker that obscure the real cause.
  // Detect the collision up front and report one clear diagnostic per
  // colliding declaration.
  //
  // We build the set of global names declared across the non-user program
  // files (lib.d.ts, lib.dom.d.ts, ambient .d.ts) and flag any user top-level
  // type declaration (class / interface / enum / type alias) whose name
  // appears in that set. This is deterministic and does not depend on the
  // checker's name-resolution quirks. (The scaffolded tsconfig no longer
  // ships with "dom" in lib, so new projects never collide; this check is
  // defense-in-depth for projects that add it back or otherwise pull in DOM
  // globals.)
  const globalNames = new Set<string>();
  for (const sf of program.getSourceFiles()) {
    const p = sf.fileName.replace(/\\/g, "/");
    // Only NON-user files contribute globals (lib + ambient declarations).
    if (userFileSet.has(p)) continue;
    // Demo #27 Finding F — third-party `@types/*` packages (e.g.
    // `@types/node`) are loaded into the TS Program from the repo-root
    // `node_modules` even when the user's tsconfig sets `"types": []` (TS
    // still *loads* the files for transitive resolution; `types: []` only
    // suppresses their automatic global-visibility). Without this filter,
    // common short names declared in `@types/node` (`Mode`, `CipherMode`,
    // `Direction`, `Event`, ...) leak into `globalNames` and false-trip this
    // gate on idiomatic user enums.
    //
    // We exclude ONLY `/node_modules/@types/` — NOT all of `node_modules`,
    // because TypeScript's own default-lib files (`lib.dom.d.ts`,
    // `lib.es2021.d.ts`, ...) live under `node_modules/typescript/lib/` and
    // DEFINE the globals this gate exists to catch (the DOM `Node`/`Element`
    // /`Event` that shadow a user class when a project adds `"dom"` back to
    // lib). Internal `packages/` are also excluded (they ship the transpiler
    // itself, not user-visible globals).
    if (p.includes("/node_modules/@types/") || p.includes("/packages/")) continue;
    const collectGlobals = (n: ts.Node): void => {
      if (ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) globalNames.add(d.name.text);
        }
      } else if (
        (ts.isInterfaceDeclaration(n) ||
          ts.isClassDeclaration(n) ||
          ts.isEnumDeclaration(n) ||
          ts.isTypeAliasDeclaration(n) ||
          ts.isFunctionDeclaration(n)) &&
        n.name
      ) {
        globalNames.add(n.name.text);
      }
      ts.forEachChild(n, collectGlobals);
    };
    ts.forEachChild(sf, collectGlobals);
  }
  const reportedCollisions = new Set<string>();
  const reportNameCollision = (nameNode: ts.Identifier, kindLabel: string): void => {
    const name = nameNode.text;
    if (!globalNames.has(name)) return;
    const filePath = nameNode.getSourceFile().fileName.replace(/\\/g, "/");
    if (!userFileSet.has(filePath)) return;
    const key = `${filePath}:${name}`;
    if (reportedCollisions.has(key)) return;
    reportedCollisions.add(key);
    const sourceText = nameNode.getSourceFile().getFullText();
    diagnostics.push(
      makeSemanticGateDiagnostic(
        sourceText,
        nameNode,
        `${kindLabel} '${name}' collides with a global type of the same name from a lib/ambient declaration. The global shadows this declaration at every unqualified use site, producing spurious type errors.`,
        "TS2CPP_GLOBAL_NAME_COLLISION",
        "Rename the declaration, or remove the colliding lib (e.g. drop \"dom\" from tsconfig \"lib\" — the scaffolded console typings live in typecad-hal-env.d.ts).",
      ),
    );
  };

  for (const sourceFile of program.getSourceFiles()) {
    const filePath = sourceFile.fileName.replace(/\\/g, "/");
    // Only scan user code — skip lib.d.ts, node_modules, and internal packages.
    if (!userFileSet.has(filePath)) continue;
    if (filePath.includes("/node_modules/") || filePath.includes("/packages/")) {
      continue;
    }
    const sourceText = sourceFile.getFullText();

    const pushDiag = (node: ts.Node, message: string, code: string, hint: string): void => {
      const key = `${filePath}:${code}:${node.getStart(sourceFile)}`;
      if (seenDiagnostics.has(key)) return;
      seenDiagnostics.add(key);
      diagnostics.push(makeSemanticGateDiagnostic(sourceText, node, message, code, hint));
    };

    const visit = (node: ts.Node, scope: GateScope): void => {
      if (ts.isSourceFile(node)) {
        ts.forEachChild(node, child => visit(child, scope));
        return;
      }

      // Global name-collision pre-scan: a user class/interface/enum/type alias
      // whose name matches a lib global is shadowed at every use site.
      if (ts.isClassDeclaration(node) && node.name) reportNameCollision(node.name, "Class");
      else if (ts.isInterfaceDeclaration(node) && node.name) reportNameCollision(node.name, "Interface");
      else if (ts.isEnumDeclaration(node) && node.name) reportNameCollision(node.name, "Enum");
      else if (ts.isTypeAliasDeclaration(node) && node.name) reportNameCollision(node.name, "Type alias");

      if (isFunctionLikeWithBody(node)) {
        const functionScope = createChildScope(scope, {
          functionNode: node,
          inClassMethod: isClassMethodLike(node),
        });

        const returnTypeNode = getFunctionReturnTypeNode(node);
        if (returnTypeNode && isTypedArrayType(checker, checker.getTypeFromTypeNode(returnTypeNode))) {
          pushDiag(
            returnTypeNode,
            "Returning a typed array is not supported because typed arrays lower to pointer-like storage in C++.",
            "TS2CPP_TYPED_ARRAY_RETURN",
            "Use an out-parameter plus an explicit length, or return a fixed-shape struct that owns its storage.",
          );
        }

        // Function-parameter origins (array-param / typed-array-param) are
        // now recorded by the SemanticFacts binding pass — no scope tracking.

        visit(node.body, functionScope);
        return;
      }

      if (ts.isBlock(node)) {
        const blockScope = createChildScope(scope);
        ts.forEachChild(node, child => visit(child, blockScope));
        return;
      }

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
            pushDiag(
              node,
              "Heterogeneous array literal has no single C++ element type.",
              "TS2CPP_HETEROGENEOUS_ARRAY",
              "Use a uniform element type (all numbers, all strings, or all objects), or declare an explicit tuple type: [number, string].",
            );
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
            pushDiag(
              node,
              `Cannot instantiate interface '${name}' — only class constructors are supported in C++.`,
              "TS2CPP_NEW_ON_INTERFACE",
              `Change 'interface ${name}' to 'class ${name}', or call a factory that returns a concrete class instance.`,
            );
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
        if (isMapLikeType(checker, iterType)) {
          const typeStr = checker.typeToString(iterType);
          pushDiag(
            node,
            `for...in over a ${typeStr} is not supported — the Map lowering iterates key-value pairs, not keys.`,
            "TS2CPP_FORIN_ON_MAP",
            "Use a for...of loop over Object.keys(m), Object.values(m), or Object.entries(m), depending on which part of the Map you need.",
          );
        }
      }

      // 4. Member access on a discriminated-union (std::variant) type.
      //    `m.kind` / `m.payload` where `m: A | B` lowers to a std::variant,
      //    but member access doesn't lower to std::get_if/std::holds_alternative,
      //    so dispatch is broken end-to-end. Reject it with a clear message.
      //    (Nullable unions `T | null` are excluded — they erase to T and the
      //    value-type null comparison is handled separately.)
      if (ts.isPropertyAccessExpression(node)) {
        const baseType = checker.getTypeAtLocation(node.expression);
        const typeStr = checker.typeToString(baseType);
        // A non-nullable union: either the typeStr shows "A | B", or the TS
        // Type object is a union whose constituents aren't null/undefined.
        const isNonNullableUnion = (baseType.isUnion() && baseType.types.every(t => {
          const s = checker.typeToString(t);
          return s !== "null" && s !== "undefined";
        })) || (typeStr.includes(" | ") && !/\b(null|undefined)\b/.test(typeStr));
        if (isNonNullableUnion) {
          pushDiag(
            node,
            `Member access '${node.getText()}' on a union type '${typeStr}' is not supported — the union lowers to std::variant, but member access doesn't lower to std::get_if/std::holds_alternative.`,
            "TS2CPP_UNION_MEMBER_ACCESS",
            "Use a struct with a discriminator field, or narrow via a type guard before access.",
          );
        }
      }

      // 5. (Removed) Locals initialized from a Map/Record value were tracked
      //    here by name into scope.mapValueCopyBindings. That origin is now
      //    recorded on the binding node by the SemanticFacts binding pass and
      //    consumed via resolver.resolveOrigin() in gate 7 below.

      // 6. Nullish checks on container lookup calls. `.get()` / `.at()` lower
      //    to presence-asserting lookups (for example `std::map::at`), not an
      //    optional value.
      if (ts.isBinaryExpression(node) && isNullishCompareOperator(node.operatorToken.kind)) {
        const leftNullish = isNullishExpression(node.left);
        const rightNullish = isNullishExpression(node.right);
        const otherSide = leftNullish ? node.right : rightNullish ? node.left : undefined;
        if (otherSide && isContainerLookupCall(otherSide, checker)) {
          const methodName = getContainerLookupMethodName(otherSide);
          pushDiag(
            node,
            `Comparing .${methodName ?? "get"}() to null or undefined is not supported by the C++ lowering.`,
            "TS2CPP_GET_NULLISH_COMPARE",
            "Use .has(key) before .get(key), or restructure the value as an explicit { present, value } result.",
          );
        }
        if (otherSide && isOptionalFieldAccess(otherSide, checker)) {
          pushDiag(
            node,
            "Comparing an optional struct/interface field to null or undefined is not supported because optionality is flattened in C++.",
            "TS2CPP_OPTIONAL_FIELD_NULLISH",
            "Use an explicit boolean flag, sentinel enum, or separate Map/Set membership check instead of relying on x?: T.",
          );
        }
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        if (isContainerLookupCall(node.left, checker)) {
          pushDiag(
            node,
            "Nullish coalescing on .get()/.at() is not supported by the C++ lowering.",
            "TS2CPP_GET_NULLISH_COMPARE",
            "Use .has(key) before .get(key), or restructure the value as an explicit { present, value } result.",
          );
        }
        if (isOptionalFieldAccess(node.left, checker)) {
          pushDiag(
            node,
            "Nullish coalescing on an optional struct/interface field is not supported because optionality is flattened in C++.",
            "TS2CPP_OPTIONAL_FIELD_NULLISH",
            "Use an explicit boolean flag, sentinel enum, or separate Map/Set membership check instead of relying on x?: T.",
          );
        }
      }

      // 7. Mutating fields of a Map/Record-fetched copy, or of a by-value
      //    array/typed-array parameter. One rule over the root identifier's
      //    resolved origin — covers assignment (=, op=, ??=, ...) and
      //    prefix/postfix ++/--, instead of two near-identical branches.
      //    Origin comes from the SemanticFacts binding pass, not scope Sets.
      const reportMutationOnLValue = (lvalue: ts.Expression): void => {
        const root = getRootIdentifierFromAccess(lvalue);
        if (!root) return;
        const origin = resolver.resolveOrigin(root);
        if (origin === "map-value-lookup") {
          pushDiag(
            lvalue,
            `'${root.text}' is a value copy fetched from a Map/Record; mutating a field on it will not update the container.`,
            "TS2CPP_MAP_VALUE_COPY_MUTATION",
            "Store primitive mutable state in a separate Map and .set() it back, or replace the whole struct entry with .set(key, nextValue).",
          );
        } else if (origin === "array-param") {
          pushDiag(
            lvalue,
            `Mutating '${root.text}' through an indexed/property access mutates only the C++ parameter copy.`,
            "TS2CPP_ARRAY_PARAM_MUTATION",
            "Return the updated array, pass a mutable owner object, or move the mutation to the caller-side container.",
          );
        }
      };

      if (ts.isBinaryExpression(node) && isAssignmentOperatorKind(node.operatorToken.kind) && isCompoundAccess(node.left)) {
        reportMutationOnLValue(node.left);
      }

      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
        isCompoundAccess(node.operand)
      ) {
        reportMutationOnLValue(node.operand);
      }

      // 8. Typed-array parameters lower pointer-like; their length is not
      //    recoverable from the parameter expression. Origin comes from the
      //    SemanticFacts binding pass.
      if (ts.isPropertyAccessExpression(node) && node.name.text === "length") {
        const receiver = unwrapExpression(node.expression);
        if (ts.isIdentifier(receiver) && resolver.resolveOrigin(receiver) === "typed-array-param") {
          pushDiag(
            node,
            `.${node.name.text} on typed-array parameter '${receiver.text}' has no valid C++ lowering.`,
            "TS2CPP_TYPED_ARRAY_PARAM_LENGTH",
            "Pass the length as a separate parameter, or wrap the buffer and size in an explicit struct.",
          );
        }
      }

      // 9. Returning typed arrays is unsafe because storage ownership is not
      //    represented in the emitted pointer-like C++ type.
      if (ts.isReturnStatement(node) && node.expression) {
        const returnType = checker.getTypeAtLocation(node.expression);
        if (isTypedArrayType(checker, returnType)) {
          pushDiag(
            node,
            "Returning a typed array is not supported because typed arrays lower to pointer-like storage in C++.",
            "TS2CPP_TYPED_ARRAY_RETURN",
            "Use an out-parameter plus an explicit length, or return a fixed-shape struct that owns its storage.",
          );
        }
      }

      // 10. String-key computed access is only deterministic on Map/Record.
      if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        const argument = unwrapExpression(node.argumentExpression);
        const argumentType = checker.getTypeAtLocation(argument);
        const isStringKey = ts.isStringLiteralLike(argument) ||
          (argumentType.flags & ts.TypeFlags.StringLike) !== 0;
        const isNumericKey = ts.isNumericLiteral(argument) ||
          (argumentType.flags & ts.TypeFlags.NumberLike) !== 0;
        const objectType = checker.getTypeAtLocation(node.expression);
        if (isStringKey && !isNumericKey &&
          !isMapLikeType(checker, objectType) &&
          !isArrayLikeType(checker, objectType) &&
          !isTypedArrayType(checker, objectType)) {
          pushDiag(
            node,
            "Dynamic string-key access on a non-map value is not supported by the C++ lowering.",
            "TS2CPP_DYNAMIC_OBJECT_KEY",
            "Use property access for fixed struct fields (obj.field), or use Map<string, T>/Record<string, T> for dynamic keys.",
          );
        }
      }

      // 11. Array parameters are by-value std::vector copies in the current
      //     lowering, so content mutation does not affect the caller.
      if (ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        if (ts.isPropertyAccessExpression(callee)) {
          const receiver = unwrapExpression(callee.expression);
          const methodName = callee.name.text;
          if (MUTATING_ARRAY_METHOD_NAMES.has(methodName) && ts.isIdentifier(receiver) && resolver.resolveOrigin(receiver) === "array-param") {
            pushDiag(
              node,
              `Calling .${methodName}() on array parameter '${receiver.text}' mutates only the C++ parameter copy.`,
              "TS2CPP_ARRAY_PARAM_MUTATION",
              "Return the updated array, pass a mutable owner object, or move the mutation to the caller-side container.",
            );
          }

          const receiverType = checker.getTypeAtLocation(callee.expression);
          if (FUNCTIONAL_METHOD_NAMES.has(methodName) && isContainerType(checker, receiverType)) {
            pushDiag(
              node,
              `.${methodName}() is not supported on Map/Set/Record in the C++ lowering.`,
              "TS2CPP_CONTAINER_FUNCTIONAL_METHOD",
              "Use a manual for...of loop over keys/values/entries, or convert to an array before applying functional array methods.",
            );
          }

          if (scope.inClassMethod && FUNCTIONAL_METHOD_NAMES.has(methodName) && isArrayLikeType(checker, receiverType)) {
            const callback = node.arguments.map(getCallbackFunction).find((arg): arg is FunctionLikeWithBody => Boolean(arg));
            if (callback && scope.functionNode && isCaptureInsideCallback(callback, scope.functionNode, checker)) {
              pushDiag(
                callback,
                "Capturing callbacks inside class-method functional array calls are not supported by the current C++ lowering.",
                "TS2CPP_CALLBACK_CAPTURE_UNSUPPORTED",
                "Move the aggregation into a manual loop in the method, or call a module-level helper that does not capture method locals or this.",
              );
            }
          }
        }
      }

      // 12. Typed-array class fields have no safe C++ lowering. A typed array
      //     lowers to pointer-like storage (uint8_t*), but a class field needs
      //     owned, copyable storage with a valid initializer — a raw pointer
      //     member has neither (its `new Uint8Array(N)` initializer lowers to a
      //     brace-init-list that cannot initialize a pointer, and the field has
      //     no new[]/delete[] lifecycle). Typed arrays are supported only as
      //     function-local stack buffers; see also gates 8 (param .length) and
      //     9 (return). This is the same ownership boundary, applied to fields.
      if (ts.isPropertyDeclaration(node) && node.type) {
        const fieldType = checker.getTypeFromTypeNode(node.type);
        if (isTypedArrayType(checker, fieldType)) {
          pushDiag(
            node.type,
            "A typed-array class field is not supported because typed arrays lower to pointer-like storage with no owned backing buffer in C++.",
            "TS2CPP_TYPED_ARRAY_FIELD",
            "Use a function-local typed array for a stack buffer, or store the buffer in a std::vector field (number[]/int8_t[]) that owns its storage.",
          );
        }
      }

      ts.forEachChild(node, child => visit(child, scope));
    };
    visit(sourceFile, createChildScope());
  }

  return diagnostics;
}

function extractLine(sourceText: string, line1Indexed: number | undefined): string {
  if (line1Indexed == null) return "";
  const lines = sourceText.split("\n");
  const idx = line1Indexed - 1;
  return idx >= 0 && idx < lines.length ? lines[idx] : "";
}
