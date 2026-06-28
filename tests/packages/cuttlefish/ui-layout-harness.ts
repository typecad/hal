import { parseCss, parseKeyframes, type CSSRule } from "@typecad/cuttlefish/ui/css-parser";
import { extractStyleBlocks, parseHtmlWithKeyboards, type KeyboardTemplate } from "@typecad/cuttlefish/ui/html-parser";
import { buildKeyframeSets } from "@typecad/cuttlefish/ui/keyframes";
import { measure, type Box } from "@typecad/cuttlefish/ui/layout-engine";
import { lowerUIToModel, type UINodeModel, type UIProgram } from "@typecad/cuttlefish/ui/model";
import { resolveStyles, type StyledNode } from "@typecad/cuttlefish/ui/style-resolver";
import { PreviewUIRuntime } from "@typecad/cuttlefish/preview/host-ui-runtime";
import { selectEngine } from "../../../packages/cuttlefish/src/ui/select-engine";
import type { PreviewSnapshot } from "../../../packages/cuttlefish/src/preview/types";

export interface BuildUiFixtureOptions {
  html: string;
  css?: string;
  viewport?: Box;
  colorFormat?: "rgb565" | "mono";
}

export interface UiLayoutHarness {
  html: string;
  css: string;
  viewport: Box;
  cssRules: CSSRule[];
  keyboardTemplates: KeyboardTemplate[];
  screens: StyledNode[];
  boxes: Box[];
  program: UIProgram;
  styledById: Map<string, StyledNode>;
  nodeById: Map<string, UINodeModel>;
  styled(id: string): StyledNode;
  node(id: string): UINodeModel;
  previewSnapshot(): PreviewSnapshot;
  startPreview(): PreviewUIRuntime;
}

const DEFAULT_VIEWPORT: Box = { x: 0, y: 0, w: 320, h: 240 };

function indexStyled(node: StyledNode, byId: Map<string, StyledNode>): void {
  if (node.id) byId.set(node.id, node);
  for (const child of node.children) indexStyled(child, byId);
}

function requireMapValue<K, V>(map: Map<K, V>, key: K, kind: string): V {
  const value = map.get(key);
  if (!value) throw new Error(`Missing ${kind} "${String(key)}" in UI fixture`);
  return value;
}

export function buildUiFixture(options: BuildUiFixtureOptions): UiLayoutHarness {
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const colorFormat = options.colorFormat ?? "rgb565";
  const css = [options.css ?? "", extractStyleBlocks(options.html)].filter(Boolean).join("\n");
  const parsed = parseHtmlWithKeyboards(options.html);
  const cssRules = parseCss(css);
  const rawKeyframes = parseKeyframes(css);
  const screens = parsed.screens.map((screen) => resolveStyles(screen, cssRules));
  const boxes = screens.flatMap((screen) => selectEngine(screen).arrange(screen, viewport, measure));
  const display = {
    driver: "test-preview",
    width: viewport.w,
    height: viewport.h,
    colorFormat,
    rotation: 1,
    antialias: true,
  } as const;
  const keyframeSets = buildKeyframeSets(rawKeyframes, colorFormat);
  const program = lowerUIToModel(screens[0], boxes, colorFormat, display, [], screens, new Map(), keyframeSets);
  const styledById = new Map<string, StyledNode>();
  for (const screen of screens) indexStyled(screen, styledById);
  const nodeById = new Map(program.nodes.filter((node) => node.id).map((node) => [node.id!, node]));

  const harness: UiLayoutHarness = {
    html: options.html,
    css,
    viewport,
    cssRules,
    keyboardTemplates: parsed.keyboards,
    screens,
    boxes,
    program,
    styledById,
    nodeById,
    styled(id: string) {
      return requireMapValue(styledById, id, "styled node");
    },
    node(id: string) {
      return requireMapValue(nodeById, id, "model node");
    },
    previewSnapshot() {
      return {
        projectRoot: "",
        entryFile: "",
        htmlFile: "",
        profileName: "test-preview",
        program,
        keyboardTemplates: parsed.keyboards,
        cssRules,
        uiTreeNames: [],
        font: [],
        bindings: [],
        listBindings: [],
        callbacks: [],
        initialAssignments: [],
        intervals: [],
        pinControls: [],
        diagnostics: [],
      };
    },
    startPreview() {
      const runtime = new PreviewUIRuntime(harness.previewSnapshot());
      runtime.start();
      return runtime;
    },
  };

  return harness;
}

export function collectLayoutProblems(harness: UiLayoutHarness): string[] {
  const problems: string[] = [];
  if (harness.boxes.length !== harness.program.nodes.length) {
    problems.push(`box/node count mismatch: ${harness.boxes.length} boxes for ${harness.program.nodes.length} nodes`);
  }

  for (const node of harness.program.nodes) {
    const box = node.box;
    for (const prop of ["x", "y", "w", "h"] as const) {
      if (!Number.isFinite(box[prop])) problems.push(`${nodeLabel(node)} has non-finite box.${prop}: ${box[prop]}`);
    }
    if (box.w < 0 || box.h < 0) problems.push(`${nodeLabel(node)} has negative size ${box.w}x${box.h}`);
    if (node.parentIndex >= node.index) problems.push(`${nodeLabel(node)} parent index is not before the node`);
    if (node.parentIndex < -1 || node.parentIndex >= harness.program.nodes.length) {
      problems.push(`${nodeLabel(node)} has invalid parent index ${node.parentIndex}`);
    }
    if (node.subtreeEnd <= node.index || node.subtreeEnd > harness.program.nodes.length) {
      problems.push(`${nodeLabel(node)} has invalid subtreeEnd ${node.subtreeEnd}`);
    }
    if (node.parentIndex >= 0) {
      const parent = harness.program.nodes[node.parentIndex];
      if (node.index >= parent.subtreeEnd) {
        problems.push(`${nodeLabel(node)} is outside parent ${nodeLabel(parent)} subtree`);
      }
    }
  }

  const roots = harness.program.nodes.filter((node) => node.parentIndex === -1);
  for (const root of roots) {
    if (root.box.x !== harness.viewport.x || root.box.y !== harness.viewport.y) {
      problems.push(`${nodeLabel(root)} root is not anchored at viewport origin`);
    }
    if (root.box.w !== harness.viewport.w || root.box.h !== harness.viewport.h) {
      problems.push(`${nodeLabel(root)} root does not fill viewport`);
    }
  }

  return problems;
}

function nodeLabel(node: UINodeModel): string {
  return node.id ? `${node.tag}#${node.id}[${node.index}]` : `${node.tag}[${node.index}]`;
}
