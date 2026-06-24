import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { DisplayProfile } from "../api/shared/display-profile.js";
import { resolveDisplayProfile } from "../api/shared/display-profile.js";
import { ResolvedCuttlefishConfig } from "../config-loader.js";
import { parseCss } from "../ui/css-parser.js";
import { parseHtmlWithKeyboards } from "../ui/html-parser.js";
import { measure, type Box } from "../ui/layout-engine.js";
import { lowerUIToModel } from "../ui/model.js";
import { selectEngine } from "../ui/select-engine.js";
import { resolveStyles } from "../ui/style-resolver.js";
import type {
  PreviewBindingSpec,
  PreviewCallbackSpec,
  PreviewDiagnostic,
  PreviewInitialAssignment,
  PreviewIntervalSpec,
  PreviewPinControlSpec,
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

function extractAuthorSpecs(
  source: ts.SourceFile,
  uiImports: UIModuleImport[],
  programNodes: Array<{ id?: string; tag?: string; kind?: string; options?: Array<{ text: string; value: string }> }>,
): {
  bindings: PreviewBindingSpec[];
  callbacks: PreviewCallbackSpec[];
  initialAssignments: PreviewInitialAssignment[];
  intervals: PreviewIntervalSpec[];
  pinControls: PreviewPinControlSpec[];
  diagnostics: PreviewDiagnostic[];
} {
  const diagnostics: PreviewDiagnostic[] = [];
  const importedTrees = new Set(uiImports.map((imp) => imp.treeName));
  const bindings: PreviewBindingSpec[] = [];
  const callbacks: PreviewCallbackSpec[] = [];
  const initialAssignments: PreviewInitialAssignment[] = [];
  const intervals: PreviewIntervalSpec[] = [];
  const pinControls: PreviewPinControlSpec[] = [];

  const resolveNode = (treeName: string, elemId: string): number | undefined => {
    if (!importedTrees.has(treeName)) return undefined;
    const idx = nodeIndexById(programNodes, elemId);
    if (idx === undefined) {
      diagnostics.push({ severity: "warning", message: `Preview could not find UI element "${treeName}.${elemId}".` });
    }
    return idx;
  };

  for (const statement of source.statements) {
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

  return { bindings, callbacks, initialAssignments, intervals, pinControls, diagnostics };
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
  const cssPath = firstImport.htmlPath.replace(/\.ui\.html$/, ".ui.css");
  const cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf-8") : "";
  const cssRules = parseCss(cssText);
  const parsedHtml = parseHtmlWithKeyboards(htmlText);
  const styled = resolveStyles(parsedHtml.tree, cssRules);
  const engine = selectEngine(styled);
  const viewport: Box = { x: 0, y: 0, w: profile.width, h: profile.height };
  const boxes = engine.arrange(styled, viewport, measure);
  const program = lowerUIToModel(styled, boxes, profile.colorFormat, profile);
  const specs = extractAuthorSpecs(sourceFile, uiImports, program.nodes);

  return {
    projectRoot,
    entryFile,
    htmlFile: firstImport.htmlPath,
    profileName: typeof config.display?.profile === "string" ? config.display.profile : undefined,
    program,
    keyboardTemplates: parsedHtml.keyboards,
    cssRules,
    font: loadFont(projectRoot, diagnostics),
    bindings: specs.bindings,
    callbacks: specs.callbacks,
    initialAssignments: specs.initialAssignments,
    intervals: specs.intervals,
    pinControls: specs.pinControls,
    diagnostics: [...diagnostics, ...specs.diagnostics],
  };
}
