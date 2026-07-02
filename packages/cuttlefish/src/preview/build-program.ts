import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { DisplayProfile } from "../api/shared/display-profile.js";
import { resolveDisplayProfile } from "../api/shared/display-profile.js";
import { ResolvedCuttlefishConfig } from "../config-loader.js";
import { parseCss, parseFontFaces, parseKeyframes } from "../ui/css-parser.js";
import { extractStyleBlocks, parseHtmlWithKeyboards } from "../ui/html-parser.js";
import { buildUIFontAssets } from "../ui/font-assets.js";
import { loadImageAssets } from "../ui/image-assets.js";
import { buildKeyframeSets } from "../ui/keyframes.js";
import { measure, measureWithFonts, type Box } from "../ui/layout-engine.js";
import { lowerUIToModel } from "../ui/model.js";
import { selectEngine } from "../ui/select-engine.js";
import { resolveStyles, type StyledNode } from "../ui/style-resolver.js";
import { getThemeClass, setThemeClass } from "../ui/theme-store.js";
import type {
  PreviewBindingSpec,
  PreviewCallbackSpec,
  PreviewDiagnostic,
  PreviewInitialAssignment,
  PreviewIntervalSpec,
  PreviewListBindingSpec,
  PreviewPinControlSpec,
  PreviewCanvasBindingSpec,
  PreviewModuleVarSpec,
  PreviewSnapshot,
} from "./types.js";

export interface BuildPreviewSnapshotOptions {
  config: ResolvedCuttlefishConfig;
  projectRoot: string;
}

interface UIModuleImport {
  treeName: string;
  htmlPath: string;
}

function nodeIndexById(programNodes: Array<{ id?: string }>, id: string): number | undefined {
  const found = programNodes.find((node) => node.id === id);
  return found?.id ? programNodes.indexOf(found) : undefined;
}

/** Convert a `{expr}` interpolation text into a TS template-literal expression
 *  string the preview can evaluate. E.g. `taps: {count}` → `` `taps: ${count}` ``.
 *  Mirrors lowerInterpolationText's scanning but produces a JS expression rather
 *  than a snprintf format string. Returns undefined when there's no interpolation. */
function interpolationToExpression(raw: string): string | undefined {
  const parts: string[] = [];
  let hasInterp = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < raw.length && depth > 0) {
        if (raw[j] === "{") depth++;
        else if (raw[j] === "}") depth--;
        if (depth === 0) break;
        j++;
      }
      const content = raw.slice(i + 1, j);
      if (depth === 0 && content.length > 0 && !content.includes("{")) {
        hasInterp = true;
        parts.push("${" + content.trim() + "}");
        i = j + 1;
        continue;
      }
    }
    // Literal text — escape backticks and ${ in the literal parts.
    parts.push(ch === "`" ? "\\`" : (ch === "$" && raw[i + 1] === "{") ? "\\${" : ch);
    i++;
  }
  if (!hasInterp) return undefined;
  return "`" + parts.join("") + "`";
}

/** Walk styled trees for {expr} interpolation nodes and synthesize preview text
 *  bindings (mirroring the runtime's auto-wire synthesis). Each produces a
 *  PreviewBindingSpec whose expression is a template-literal the preview evals. */
function collectInterpolationBindings(
  trees: StyledNode[],
  programNodes: Array<{ id?: string }>,
): PreviewBindingSpec[] {
  const out: PreviewBindingSpec[] = [];
  const walk = (node: StyledNode): void => {
    if (node.hasInterpolation && node.text) {
      const expression = interpolationToExpression(node.text);
      if (expression) {
        // Resolve nodeIndex by id; interpolation nodes may lack an id (when the
        // text references a signal directly), but the demo keeps the id for CSS.
        const nodeIndex = node.id ? nodeIndexById(programNodes, node.id) : undefined;
        if (nodeIndex !== undefined) {
          out.push({ nodeId: node.id ?? `__interp_${nodeIndex}`, nodeIndex, property: "text", expression });
        }
      }
    }
    node.children?.forEach(walk);
  };
  trees.forEach(walk);
  return out;
}

/** Walk styled trees for on:* declarative event handlers and synthesize preview
 *  callback specs. Each on:click="saveSettings" becomes a callback whose body is
 *  `saveSettings()` — the preview evaluates it (calling the named function from
 *  module scope) on tap. Mirrors the runtime's named-ref handler synthesis. */
function collectEventCallbacks(
  trees: StyledNode[],
  programNodes: Array<{ id?: string }>,
): PreviewCallbackSpec[] {
  const out: PreviewCallbackSpec[] = [];
  const walk = (node: StyledNode): void => {
    if (node.events) {
      const nodeIndex = node.id ? nodeIndexById(programNodes, node.id) : undefined;
      if (nodeIndex !== undefined) {
        for (const kind of ["click", "hold", "release", "change"] as const) {
          const fn = node.events[kind];
          if (fn) {
            out.push({ nodeId: node.id ?? `__event_${nodeIndex}`, nodeIndex, kind, body: `${fn}()` });
          }
        }
      }
    }
    node.children?.forEach(walk);
  };
  trees.forEach(walk);
  return out;
}

/** Walk styled trees for bind:* declarative two-way bindings and synthesize the
 *  READ half (signal → node) as preview bindings. The write half (node → signal,
 *  e.g. keyboard commit → signal.set) requires preview input-commit machinery
 *  not yet present; until then, the runtime handles both directions and the
 *  preview reflects signal → node (the visible behavior). */
function collectBindBindings(
  trees: StyledNode[],
  programNodes: Array<{ id?: string }>,
): PreviewBindingSpec[] {
  const out: PreviewBindingSpec[] = [];
  const walk = (node: StyledNode): void => {
    if (node.bind) {
      const nodeIndex = node.id ? nodeIndexById(programNodes, node.id) : undefined;
      if (nodeIndex !== undefined) {
        if (node.bind.text) {
          out.push({ nodeId: node.id ?? `__bind_${nodeIndex}`, nodeIndex, property: "text", expression: node.bind.text });
        }
        if (node.bind.value) {
          out.push({ nodeId: node.id ?? `__bind_${nodeIndex}`, nodeIndex, property: "value", expression: node.bind.value });
        }
      }
    }
    node.children?.forEach(walk);
  };
  trees.forEach(walk);
  return out;
}

async function loadProfileRegistry(frameworkPackage: string | undefined): Promise<Map<string, DisplayProfile>> {
  const registry = new Map<string, DisplayProfile>();
  if (!frameworkPackage) return registry;
  const profileMod = await import(frameworkPackage + "/displays/ili9341-spi").catch(() => null);
  if (profileMod?.BUILT_IN_PROFILES) {
    for (const [key, value] of Object.entries(profileMod.BUILT_IN_PROFILES)) {
      registry.set(key, value as DisplayProfile);
    }
  }
  return registry;
}

function loadFont(projectRoot: string, diagnostics: PreviewDiagnostic[]): number[] {
  const fontPath = path.join(projectRoot, "lib", "Adafruit_GFX_Library", "glcdfont.c");
  if (!fs.existsSync(fontPath)) {
    diagnostics.push({
      severity: "warning",
      message: `Default GFX font not found at ${fontPath}; text pixels will be blank.`,
    });
    return Array.from(new Uint8Array(1280));
  }
  const source = fs.readFileSync(fontPath, "utf-8");
  const match = /font\[\]\s+PROGMEM\s*=\s*\{([\s\S]*?)\};/.exec(source);
  const body = match?.[1] ?? source;
  const bytes = [...body.matchAll(/0x([0-9a-fA-F]{1,2})/g)].map((m) => parseInt(m[1], 16));
  if (bytes.length < 1280) {
    diagnostics.push({
      severity: "warning",
      message: `Parsed ${bytes.length} font bytes from ${fontPath}; expected 1280.`,
    });
  }
  return bytes.slice(0, 1280);
}

function callbackBodyText(cb: ts.Expression | undefined, source: ts.SourceFile): string {
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) return "";
  if (ts.isExpression(cb.body)) return `${cb.body.getText(source)};`;
  return cb.body.statements.map((statement) => statement.getText(source)).join("\n");
}

function callbackExpressionText(cb: ts.Expression | undefined, source: ts.SourceFile): string | undefined {
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) return undefined;
  if (ts.isExpression(cb.body)) return cb.body.getText(source);
  for (const statement of cb.body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression.getText(source);
    }
  }
  return undefined;
}

function callbackFirstParamName(cb: ts.Expression | undefined): string | undefined {
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) return undefined;
  const param = cb.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return undefined;
  return param.name.text;
}

function numericArgText(arg: ts.Expression | undefined, source: ts.SourceFile, fallback: string): string {
  if (!arg) return fallback;
  if (ts.isNumericLiteral(arg)) return arg.text;
  if (ts.isIdentifier(arg)) return arg.text;
  return arg.getText(source);
}

function readTreeElement(expr: ts.Expression): { treeName: string; elemId: string } | undefined {
  if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.expression)) return undefined;
  return { treeName: expr.expression.text, elemId: expr.name.text };
}

function readTreeElementMethod(call: ts.CallExpression): { treeName: string; elemId: string; method: string } | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text;
  const receiver = call.expression.expression;
  const element = readTreeElement(receiver);
  return element ? { ...element, method } : undefined;
}

function findUIModuleImports(
  source: ts.SourceFile,
  entryDir: string,
  diagnostics: PreviewDiagnostic[],
): UIModuleImport[] {
  const imports: UIModuleImport[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.endsWith(".ui.html")) {
      if (statement.importClause?.name) {
        imports.push({
          treeName: statement.importClause.name.text,
          htmlPath: path.resolve(entryDir, specifier),
        });
      }
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          imports.push({
            treeName: element.name.text,
            htmlPath: path.resolve(entryDir, specifier),
          });
        }
      }
    } else if (specifier.includes("/lib/") || specifier.startsWith("../lib/") || specifier.startsWith("./lib/")) {
      diagnostics.push({
        severity: "info",
        message: `Preview is stubbing embedded-only import "${specifier}".`,
      });
    }
  }
  return imports;
}

function themeCssPath(displayThemeCss: string | undefined, htmlPath: string, configDir: string): string {
  if (!displayThemeCss) return htmlPath.replace(/\.ui\.html$/, ".ui.css");
  return path.isAbsolute(displayThemeCss)
    ? displayThemeCss
    : path.resolve(configDir, displayThemeCss);
}

function collectHrefCallbacks(
  screens: StyledNode[],
  programNodes: Array<{ id?: string }>,
): PreviewCallbackSpec[] {
  const screenIds = new Map<string, number>();
  screens.forEach((screen, index) => {
    if (screen.id) screenIds.set(screen.id, index);
  });

  const callbacks: PreviewCallbackSpec[] = [];

  // Walk in document order with a running index, matching how lowerUIToModel
  // assigns node indices (flatten(): index = cursor.i++ for every node, depth-
  // first). The cursor advances by each subtree's size, so a child's index is
  // always (parent + 1 + sum of earlier siblings' subtree sizes). This lets us
  // resolve id-less <a href> links the same way the device does
  // (ui-element-auto-wire.ts wires any node with href, id or not).
  const visit = (node: StyledNode, nodeIndex: number): number => {
    if (node.href) {
      const target = node.href.startsWith("#") ? node.href.slice(1) : node.href;
      const targetScreen = screenIds.get(target);
      if (targetScreen !== undefined && nodeIndex < programNodes.length) {
        callbacks.push({
          nodeId: node.id ?? `__ui_link${nodeIndex}_nav`,
          nodeIndex,
          kind: "click",
          body: `ui.navigate(${targetScreen});`,
        });
      }
    } else if (node.runs?.some(r => r.href)) {
      // Run-bearing link node (inline <a href> inside a paragraph). The link
      // targets are resolved into the model at lower time; the preview tap path
      // calls richLinkHit to pick the target. Register a no-op click callback so
      // the node is hit-testable.
      if (nodeIndex < programNodes.length) {
        callbacks.push({
          nodeId: node.id ?? `__ui_richlink${nodeIndex}_nav`,
          nodeIndex,
          kind: "click",
          body: `/* rich-text link; target resolved by richLinkHit */`,
        });
      }
    }
    let nextIndex = nodeIndex + 1;
    for (const child of node.children) nextIndex = visit(child, nextIndex);
    return nextIndex;
  };

  // Each screen is a contiguous subtree in the flattened node table; find where
  // screen i starts (first node with that screenId) and walk its styled tree.
  for (let i = 0; i < screens.length; i++) {
    const startIndex = programNodes.findIndex((n) => (n as { screenId?: number }).screenId === i);
    if (startIndex >= 0) visit(screens[i], startIndex);
  }
  return callbacks;
}

function extractAuthorSpecs(
  source: ts.SourceFile,
  uiImports: UIModuleImport[],
  programNodes: Array<{ id?: string; tag?: string; kind?: string; options?: Array<{ text: string; value: string }> }>,
): {
  bindings: PreviewBindingSpec[];
  listBindings: PreviewListBindingSpec[];
  callbacks: PreviewCallbackSpec[];
  initialAssignments: PreviewInitialAssignment[];
  intervals: PreviewIntervalSpec[];
  pinControls: PreviewPinControlSpec[];
  canvasBindings: PreviewCanvasBindingSpec[];
  moduleVars: PreviewModuleVarSpec[];
  diagnostics: PreviewDiagnostic[];
} {
  const diagnostics: PreviewDiagnostic[] = [];
  const importedTrees = new Set(uiImports.map((imp) => imp.treeName));
  const bindings: PreviewBindingSpec[] = [];
  const listBindings: PreviewListBindingSpec[] = [];
  const callbacks: PreviewCallbackSpec[] = [];
  const initialAssignments: PreviewInitialAssignment[] = [];
  const intervals: PreviewIntervalSpec[] = [];
  const pinControls: PreviewPinControlSpec[] = [];
  const canvasBindings: PreviewCanvasBindingSpec[] = [];
  const moduleVars: PreviewModuleVarSpec[] = [];

  const resolveNode = (treeName: string, elemId: string): number | undefined => {
    if (!importedTrees.has(treeName)) return undefined;
    const idx = nodeIndexById(programNodes, elemId);
    if (idx === undefined) {
      diagnostics.push({ severity: "warning", message: `Preview could not find UI element "${treeName}.${elemId}".` });
    }
    return idx;
  };

  for (const statement of source.statements) {
    // Top-level `let`/`const`/`var` declarations become module-scoped bindings
    // the device hoists to C++ globals. Capture each declared name + initializer
    // so callback bodies (setInterval, onClick, ui.bind, ...) that reference them
    // resolve at preview runtime instead of throwing ReferenceError.
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          moduleVars.push({
            name: decl.name.text,
            initializer: decl.initializer ? decl.initializer.getText(source) : undefined,
          });
        }
      }
      continue;
    }
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
      const expr = statement.expression;
      if (
        expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(expr.left) &&
        expr.left.name.text === "value"
      ) {
        const element = readTreeElement(expr.left.expression);
        if (element) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            initialAssignments.push({
              nodeId: element.elemId,
              nodeIndex,
              expression: expr.right.getText(source),
            });
          }
        }
      }
      continue;
    }

    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;

    if (ts.isIdentifier(call.expression) && call.expression.text === "setInterval") {
      const delay = call.arguments[1] && ts.isNumericLiteral(call.arguments[1])
        ? Number(call.arguments[1].text)
        : 0;
      intervals.push({ body: callbackBodyText(call.arguments[0], source), delayMs: delay });
      continue;
    }

    if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression)) {
      const objectName = call.expression.expression.text;
      const method = call.expression.name.text;
      if (objectName === "ui" && method === "bind") {
        const elementArg = call.arguments[0];
        const propArg = call.arguments[1];
        const fnArg = call.arguments[2];
        const element = elementArg ? readTreeElement(elementArg) : undefined;
        const property = propArg && ts.isStringLiteral(propArg) ? propArg.text : "text";
        const expression = callbackExpressionText(fnArg, source);
        if (element && expression) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            bindings.push({ nodeId: element.elemId, nodeIndex, property, expression });
          }
        }
        continue;
      }
      if (objectName === "ui" && method === "bindList") {
        const elementArg = call.arguments[0];
        const countArg = call.arguments[1];
        const itemArg = call.arguments[2];
        const tapArg = call.arguments[3];
        const element = elementArg ? readTreeElement(elementArg) : undefined;
        const countExpression = callbackExpressionText(countArg, source);
        const itemExpression = callbackExpressionText(itemArg, source);
        if (element && countExpression && itemExpression) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            listBindings.push({
              nodeId: element.elemId,
              nodeIndex,
              countExpression,
              itemExpression,
              itemParam: callbackFirstParamName(itemArg),
              tapBody: tapArg ? callbackBodyText(tapArg, source) : undefined,
              tapParam: callbackFirstParamName(tapArg),
            });
          }
        }
        continue;
      }
      if (objectName === "ui" && method === "drawCanvas") {
        const elementArg = call.arguments[0];
        const cbArg = call.arguments[1];
        const element = elementArg ? readTreeElement(elementArg) : undefined;
        if (element && cbArg && (ts.isArrowFunction(cbArg) || ts.isFunctionExpression(cbArg))) {
          const nodeIndex = resolveNode(element.treeName, element.elemId);
          if (nodeIndex !== undefined) {
            canvasBindings.push({
              nodeId: element.elemId,
              nodeIndex,
              drawBody: callbackBodyText(cbArg, source),
            });
          }
        }
        continue;
      }
      if (objectName === "ui" && method === "watchPin") {
        const pin = numericArgText(call.arguments[0], source, "0");
        pinControls.push({
          label: `ui.watchPin(${pin})`,
          kind: "watch",
          pin,
          body: callbackBodyText(call.arguments[1], source),
        });
      }
    }

    const elementMethod = readTreeElementMethod(call);
    if (!elementMethod) continue;
    const nodeIndex = resolveNode(elementMethod.treeName, elementMethod.elemId);
    if (nodeIndex === undefined) continue;

    if (elementMethod.method === "onClick" || elementMethod.method === "onHold" || elementMethod.method === "onRelease") {
      callbacks.push({
        nodeId: elementMethod.elemId,
        nodeIndex,
        kind: elementMethod.method === "onClick" ? "click" : elementMethod.method === "onHold" ? "hold" : "release",
        body: callbackBodyText(call.arguments[0], source),
      });
    } else if (elementMethod.method === "onToggle") {
      const pin = numericArgText(call.arguments[0], source, "0");
      pinControls.push({
        label: `${elementMethod.elemId}.onToggle(${pin})`,
        kind: "toggle",
        pin,
        nodeId: elementMethod.elemId,
        nodeIndex,
        body: callbackBodyText(call.arguments[1], source),
      });
    } else if (elementMethod.method === "onChange") {
      const nodeInfo = programNodes[nodeIndex];
      if (nodeInfo?.tag === "input" || nodeInfo?.kind === "input") {
        callbacks.push({
          nodeId: elementMethod.elemId,
          nodeIndex,
          kind: "change",
          body: callbackBodyText(call.arguments[0], source),
        });
        continue;
      }
      const pin = numericArgText(call.arguments[0], source, "0");
      const count = call.arguments[1] && ts.isNumericLiteral(call.arguments[1])
        ? Number(call.arguments[1].text)
        : Math.max(programNodes[nodeIndex].options?.length ?? 0, 2);
      pinControls.push({
        label: `${elementMethod.elemId}.onChange(${pin})`,
        kind: "change",
        pin,
        nodeId: elementMethod.elemId,
        nodeIndex,
        optionCount: count,
        body: callbackBodyText(call.arguments[2], source),
      });
    } else if (elementMethod.method === "onPress" || elementMethod.method === "onRelease") {
      const pin = numericArgText(call.arguments[0], source, "0");
      pinControls.push({
        label: `${elementMethod.elemId}.${elementMethod.method}(${pin})`,
        kind: elementMethod.method === "onPress" ? "press" : "release",
        pin,
        nodeId: elementMethod.elemId,
        nodeIndex,
      });
    }
  }

  return { bindings, listBindings, callbacks, initialAssignments, intervals, pinControls, canvasBindings, moduleVars, diagnostics };
}

export async function buildPreviewSnapshot(options: BuildPreviewSnapshotOptions): Promise<PreviewSnapshot> {
  const { config, projectRoot } = options;
  const diagnostics: PreviewDiagnostic[] = [];
  const configDir = path.dirname(config.configPath);
  if (!config.entry) {
    throw new Error(`cuttlefish preview requires an entry field in ${config.configPath}`);
  }

  const entryFile = path.resolve(configDir, config.entry);
  const entrySource = fs.readFileSync(entryFile, "utf-8");
  const sourceFile = ts.createSourceFile(entryFile, entrySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const entryDir = path.dirname(entryFile);
  const uiImports = findUIModuleImports(sourceFile, entryDir, diagnostics);
  const firstImport = uiImports[0];
  if (!firstImport) {
    throw new Error(`Preview could not find a .ui.html import in ${entryFile}`);
  }
  if (uiImports.length > 1) {
    diagnostics.push({
      severity: "warning",
      message: "Preview v1 renders the first imported UI tree only.",
    });
  }

  const registry = await loadProfileRegistry(config.framework);
  const resolved = resolveDisplayProfile(config.display ?? { profile: "ili9341-spi" }, registry);
  const profile = resolved.profile;
  const htmlText = fs.readFileSync(firstImport.htmlPath, "utf-8");
  const cssPath = themeCssPath(config.display?.themeCss, firstImport.htmlPath, configDir);
  const cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf-8") : "";
  const parsedHtml = parseHtmlWithKeyboards(htmlText);
  const fullCss = cssText + "\n" + extractStyleBlocks(htmlText);
  const cssRules = (() => {
    const previousThemeClass = getThemeClass();
    setThemeClass(config.display?.themeClass ?? null);
    try {
      return parseCss(fullCss);
    } finally {
      setThemeClass(previousThemeClass);
    }
  })();
  const fontFaces = parseFontFaces(fullCss);
  const rawKeyframes = parseKeyframes(fullCss);
  const styled = resolveStyles(parsedHtml.tree, cssRules);
  const allStyledScreens = parsedHtml.screens.map((screen) => resolveStyles(screen, cssRules));
  const fontRoot: StyledNode = { tag: "screen", classes: [], style: {}, children: allStyledScreens };
  const fontAssets = buildUIFontAssets(fontRoot, fontFaces, path.dirname(cssPath));
  const viewport: Box = { x: 0, y: 0, w: profile.width, h: profile.height };
  const boxes = allStyledScreens.flatMap((screen) => {
    const engine = selectEngine(screen);
    return engine.arrange(screen, viewport, measureWithFonts(fontAssets));
  });
  const keyframeSets = buildKeyframeSets(rawKeyframes, profile.colorFormat);
  const imageAssets = loadImageAssets(allStyledScreens.length > 0 ? allStyledScreens : [styled], path.dirname(firstImport.htmlPath));
  const program = lowerUIToModel(styled, boxes, profile.colorFormat, profile, fontAssets, allStyledScreens, imageAssets.nodeIdToAssetIndex, keyframeSets, imageAssets.assets);
  const specs = extractAuthorSpecs(sourceFile, uiImports, program.nodes);
  const hrefCallbacks = collectHrefCallbacks(allStyledScreens, program.nodes);
  // {expr} interpolation bindings synthesized from the HTML (mirrors the runtime's
  // auto-wire synthesis). Authors write `taps: {count}` in markup; this collects
  // them so the preview evaluates the template-literal expression each frame.
  const interpolationBindings = collectInterpolationBindings(
    allStyledScreens.length > 0 ? allStyledScreens : [styled],
    program.nodes,
  );
  // on:* declarative event handlers from markup → preview callbacks (named fn).
  const eventCallbacks = collectEventCallbacks(
    allStyledScreens.length > 0 ? allStyledScreens : [styled],
    program.nodes,
  );
  // bind:* declarative two-way read bindings (signal → node).
  const bindBindings = collectBindBindings(
    allStyledScreens.length > 0 ? allStyledScreens : [styled],
    program.nodes,
  );

  return {
    projectRoot,
    entryFile,
    htmlFile: firstImport.htmlPath,
    profileName: typeof config.display?.profile === "string" ? config.display.profile : undefined,
    program,
    keyboardTemplates: parsedHtml.keyboards,
    cssRules,
    uiTreeNames: [...new Set(uiImports.map((imp) => imp.treeName))],
    font: loadFont(projectRoot, diagnostics),
    bindings: [...specs.bindings, ...interpolationBindings, ...bindBindings],
    listBindings: specs.listBindings,
    callbacks: [...hrefCallbacks, ...specs.callbacks, ...eventCallbacks],
    initialAssignments: specs.initialAssignments,
    intervals: specs.intervals,
    pinControls: specs.pinControls,
    canvasBindings: specs.canvasBindings,
    moduleVars: specs.moduleVars,
    diagnostics: [...diagnostics, ...specs.diagnostics],
  };
}
