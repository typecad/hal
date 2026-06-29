// ---------------------------------------------------------------------------
// Auto-wire built-in elements — when the transpiler encounters <check>,
// <select>, or <button> in the HTML, it automatically registers the default
// behavior (onClick handlers, visual bindings) so the author doesn't have to.
//
// Authors can still override or add to this behavior in their TS code.
// For custom elements, use <view> + <text> + manual bindings.
// ---------------------------------------------------------------------------

import { recordClickHandler, recordBinding } from "./transformers/ui-call-resolver.js";

interface AutoWireNode {
  tag: string;
  id?: string;
  text?: string;
  children?: AutoWireNode[];
  options?: Array<{ value: string; text: string }>;
  name?: string;
  checked?: boolean;
  href?: string;
}

// Track radio groups for mutual exclusion
const radioGroups = new Map<string, Array<{ id: string; nodeIndex: number }>>();

// Track screen IDs → screen indices for link navigation.
const screenIdMap = new Map<string, number>();

export function getRadioGroups() { return radioGroups; }

/** Register a screen ID → index mapping (called during multi-screen setup). */
export function registerScreenId(id: string, index: number): void {
  screenIdMap.set(id, index);
}

/** Resolve a href="#screenId" to a screen index, or undefined if unknown. */
export function resolveScreenHref(href: string | undefined): number | undefined {
  if (!href) return undefined;
  const target = href.startsWith("#") ? href.slice(1) : href;
  return screenIdMap.get(target);
}

/**
 * Walk the styled tree and auto-wire built-in element behaviors.
 */
export function autoWireElements(treeName: string, root: AutoWireNode, startIndex = 0): number {
  if (startIndex === 0) radioGroups.clear();
  let nodeIndex = startIndex;
  const walk = (node: AutoWireNode) => {
    const currentIndex = nodeIndex++;
    // Auto-wire nodes with an id, and <a href> links (which need
    // navigation wiring even without an explicit id attribute).
    if (node.id || node.href) {
      autoWireNode(treeName, node, currentIndex);
    }
    node.children?.forEach(walk);
  };
  walk(root);
  return nodeIndex;
}

function autoWireNode(treeName: string, node: AutoWireNode, nodeIndex: number): void {
  // The check/select/radio branches generate fnNames from node.id, so they
  // require one. The href (navigation) branch below works with or without id.
  if (!node.id && !node.href) return;
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

  if (node.tag === "radio" && node.name) {
    // Register this radio in its group
    const groupName = node.name;
    if (!radioGroups.has(groupName)) radioGroups.set(groupName, []);
    const group = radioGroups.get(groupName)!;
    group.push({ id: node.id!, nodeIndex });

    // Auto-wire: onClick clears all radios in the group, then selects this one.
    // The generated C++ references the radio group table by index.
    const groupIdx = Array.from(radioGroups.keys()).indexOf(groupName);
    recordClickHandler({
      nodeIndex,
      kind: "click",
      fnName: `__ui_${node.id}_autoclick`,
      callbackBody: `for (uint8_t __r = 0; __r < __ui_radio_groups[${groupIdx}].count; __r++) { uint8_t __rn = __ui_radio_groups[${groupIdx}].nodeIndices[__r]; __ui_nodes[__rn].value = 0; ui_mark_dirty(__rn); } __ui_nodes[${nodeIndex}].value = 1; ui_mark_dirty(${nodeIndex});`,
    });
  }

  // Auto-wire <a href="#screenId"> links: onClick navigates to the target screen.
  if (node.href) {
    const targetScreen = resolveScreenHref(node.href);
    if (targetScreen !== undefined) {
      recordClickHandler({
        nodeIndex,
        kind: "click",
        fnName: `__ui_${node.id ?? "link" + nodeIndex}_nav`,
        callbackBody: `ui_navigate(${targetScreen});`,
      });
    } else {
      console.error(`[auto-wire] WARNING: <a href="${node.href}"> (id=${node.id}) target screen not found. Known screens: ${[...screenIdMap.keys()].join(", ")}`);
    }
  }
}
