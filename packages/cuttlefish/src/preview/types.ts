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
  font: number[];
  bindings: PreviewBindingSpec[];
  callbacks: PreviewCallbackSpec[];
  initialAssignments: PreviewInitialAssignment[];
  intervals: PreviewIntervalSpec[];
  pinControls: PreviewPinControlSpec[];
  diagnostics: PreviewDiagnostic[];
}
