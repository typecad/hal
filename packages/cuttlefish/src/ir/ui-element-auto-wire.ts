// ---------------------------------------------------------------------------
// Auto-wire built-in elements — when the transpiler encounters <check>,
// <select>, or <button> in the HTML, it automatically registers the default
// behavior (onClick handlers, visual bindings) so the author doesn't have to.
//
// Authors can still override or add to this behavior in their TS code.
// For custom elements, use <view> + <text> + manual bindings.
// ---------------------------------------------------------------------------

import { recordClickHandler, recordBinding, resolveElementValue } from "./transformers/ui-call-resolver.js";

interface AutoWireNode {
  tag: string;
  id?: string;
  text?: string;
  children?: AutoWireNode[];
  options?: Array<{ value: string; text: string }>;
}

/**
 * Walk the styled tree and auto-wire built-in element behaviors.
 */
export function autoWireElements(treeName: string, root: AutoWireNode): void {
  const walk = (node: AutoWireNode) => {
    if (node.id) {
      autoWireNode(treeName, node);
    }
    node.children?.forEach(walk);
  };
  walk(root);
}

function autoWireNode(treeName: string, node: AutoWireNode): void {
  const nodeIndex = resolveElementValue(treeName, node.id!);
  if (nodeIndex === undefined) return;

  if (node.tag === "check") {
    // Auto-wire: onClick toggles value 0↔1
    recordClickHandler({
      nodeIndex,
      kind: "click",
      fnName: `__ui_${node.id}_autoclick`,
      callbackBody: `__ui_nodes[${nodeIndex}].value = (__ui_nodes[${nodeIndex}].value > 0 ? 0 : 1);`,
    });
  }

  if (node.tag === "select") {
    // Use parsed options (from <option> children) or fallback to comma text
    const options = node.options && node.options.length > 0
      ? node.options.map(o => o.text)
      : (node.text || "").split(",").map(s => s.trim()).filter(Boolean);
    const count = Math.max(options.length, 2);

    // Auto-wire: onClick cycles value 0..count-1
    recordClickHandler({
      nodeIndex,
      kind: "click",
      fnName: `__ui_${node.id}_autoclick`,
      callbackBody: `__ui_nodes[${nodeIndex}].value = (__ui_nodes[${nodeIndex}].value + 1) % ${count};`,
    });

    // Auto-bind text to show the current option via snprintf if/else chain
    const branches = options.map((opt, i) => {
      if (i === 0) return `if (__ui_nodes[${nodeIndex}].value == 0) { snprintf(buf, size, "%s", "${opt}"); }`;
      return `else if (__ui_nodes[${nodeIndex}].value == ${i}) { snprintf(buf, size, "%s", "${opt}"); }`;
    }).join(" ");
    const elseBranch = `else { snprintf(buf, size, "%s", "${options[0] || ""}"); }`;

    recordBinding({
      nodeIndex,
      property: "text",
      fnName: `__ui_${node.id}_autotext`,
      cppBody: branches + " " + elseBranch,
    } as any);
  }
}
