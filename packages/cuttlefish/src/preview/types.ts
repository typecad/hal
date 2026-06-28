import type { UIProgram } from "../ui/model.js";
import type { CSSRule } from "../ui/css-parser.js";
import type { KeyboardTemplate } from "../ui/html-parser.js";

export interface PreviewBindingSpec {
  nodeId: string;
  nodeIndex: number;
  property: string;
  expression: string;
}

export interface PreviewCallbackSpec {
  nodeId: string;
  nodeIndex: number;
  kind: "click" | "hold" | "release" | "change";
  body: string;
}

export interface PreviewInitialAssignment {
  nodeId: string;
  nodeIndex: number;
  expression: string;
}

export interface PreviewListBindingSpec {
  nodeId: string;
  nodeIndex: number;
  countExpression: string;
  itemExpression: string;
  itemParam?: string;
  tapBody?: string;
  tapParam?: string;
}

export interface PreviewIntervalSpec {
  body: string;
  delayMs: number;
}

export interface PreviewPinControlSpec {
  label: string;
  kind: "watch" | "toggle" | "change" | "press" | "release";
  pin: string;
  nodeId?: string;
  nodeIndex?: number;
  optionCount?: number;
  body?: string;
}

export interface PreviewCanvasBindingSpec {
  nodeId: string;
  nodeIndex: number;
  /** The drawBody source text: `ctx.X(...)` calls the host runtime re-lowers. */
  drawBody: string;
}

export interface PreviewDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
}

export interface PreviewSnapshot {
  projectRoot: string;
  entryFile: string;
  htmlFile: string;
  profileName?: string;
  program: UIProgram;
  keyboardTemplates: KeyboardTemplate[];
  cssRules: CSSRule[];
  uiTreeNames: string[];
  font: number[];
  bindings: PreviewBindingSpec[];
  listBindings: PreviewListBindingSpec[];
  callbacks: PreviewCallbackSpec[];
  initialAssignments: PreviewInitialAssignment[];
  intervals: PreviewIntervalSpec[];
  pinControls: PreviewPinControlSpec[];
  canvasBindings: PreviewCanvasBindingSpec[];
  diagnostics: PreviewDiagnostic[];
}
