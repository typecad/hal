// ---------------------------------------------------------------------------
// Auto-wire built-in elements — when the transpiler encounters <check>,
// <select>, or <button> in the HTML, it automatically registers the default
// behavior (onClick handlers, visual bindings) so the author doesn't have to.
//
// Authors can still override or add to this behavior in their TS code.
// For custom elements, use <view> + <text> + manual bindings.
// ---------------------------------------------------------------------------

import { recordClickHandler, recordBinding, markRunNode, lowerInterpolationText } from "./transformers/ui-call-resolver.js";
import { recordInputBinding } from "./transformers/ui-reactive.js";

interface AutoWireNode {
  tag: string;
  id?: string;
  text?: string;
  children?: AutoWireNode[];
  options?: Array<{ value: string; text: string }>;
  name?: string;
  checked?: boolean;
  href?: string;
  /** Rich-text runs (present only for text nodes with mixed inline content).
   *  A run may carry an href (inline <a href>); those make the node a link
   *  target that needs a click handler so it's hit-testable. */
  runs?: Array<{ href?: string }>;
  /** True when text contains a `{expr}` interpolation; auto-wire synthesizes an
   *  implicit text binding for it (no id required — {expr} references a signal). */
  hasInterpolation?: boolean;
  /** Declarative on:* event handlers (named-function references). Each value
   *  names an exported TS function emitted as a standalone C++ function. */
  events?: { click?: string; hold?: string; release?: string; change?: string };
  /** Declarative bind:* two-way bindings (signal names). bind:text on <input>
   *  composes a text binding + an input binding; bind:value on <range>/<check>
   *  composes a value binding + a change/click handler. */
  bind?: { text?: string; value?: string };
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
    // Record run-bearing node indices so the binding resolver can reject
    // PROP_TEXT bindings on them (runs are static-only).
    if (node.runs && node.runs.length > 0) markRunNode(currentIndex);
    // Auto-wire nodes with an id, <a href> links, run-bearing link nodes
    // (an inline <a href> inside a paragraph makes the paragraph a tap target),
    // {expr} text interpolations, and on:* declarative event handlers. The last
    // two may have no id — {expr} references a signal; on:* names a function.
    const hasLinkRun = !!node.runs?.some(r => r.href);
    const hasEvents = !!node.events && Object.keys(node.events).length > 0;
    const hasBind = !!node.bind && Object.keys(node.bind).length > 0;
    if (node.id || node.href || hasLinkRun || node.hasInterpolation || hasEvents || hasBind) {
      autoWireNode(treeName, node, currentIndex);
    }
    node.children?.forEach(walk);
  };
  walk(root);
  return nodeIndex;
}

function autoWireNode(treeName: string, node: AutoWireNode, nodeIndex: number): void {
  // {expr} text interpolation → synthesize an implicit text binding. This runs
  // before the id/href guard below because an interpolation node may have no id
  // ({expr} references a signal, not a screen.<id> handle). recordBinding rejects
  // run-bearing nodes via the run-text-binding-conflict guard, so inline+interp
  // combinations are caught there rather than here.
  if (node.hasInterpolation && node.text) {
    const cppBody = lowerInterpolationText(node.text);
    if (cppBody) {
      recordBinding({
        nodeIndex,
        property: "text",
        fnName: `__ui_interp_${nodeIndex}`,
        cppBody,
      });
    }
  }

  // bind:* declarative two-way bindings → compose a read-binding (signal→node)
  // with a write-callback (node→signal). bind:text on <input> uses a text
  // binding + an input binding (fires on keyboard commit). bind:value on
  // <range>/<check> uses a value binding + a change/click handler.
  if (node.bind) {
    if (node.bind.text) {
      const sig = node.bind.text;
      // Read: signal → node text (reuses the binding table).
      recordBinding({
        nodeIndex,
        property: "text",
        fnName: `__ui_bindtext_${nodeIndex}`,
        cppBody: `snprintf(buf, static_cast<size_t>(size), "%s", ${sig});`,
      });
      // Write: keyboard commit → signal.set(text).
      recordInputBinding({
        nodeIndex,
        cbFnName: `__ui_bindtext_cb_${nodeIndex}`,
        cbFnBody: `${sig}.set(std::string(text));`,
      });
    }
    if (node.bind.value) {
      const sig = node.bind.value;
      // Read: signal → node value.
      recordBinding({
        nodeIndex,
        property: "value",
        fnName: `__ui_bindval_${nodeIndex}`,
        cppExpr: sig,
      });
      // Write: range drag / check toggle → plain assignment (signals lower
      // to plain device variables; .set() is author-facing syntax only).
      recordClickHandler({
        nodeIndex,
        kind: node.tag === "check" ? "click" : "rangechange",
        fnName: `__ui_bindval_cb_${nodeIndex}`,
        callbackBody: `${sig} = __ui_nodes[${nodeIndex}].value;`,
      });
    }
  }

  // on:* declarative event handlers → record click/hold/release/change handlers
  // that reference the named C++ function by name (no inlined body). The named
  // function comes from the author's `export function name() {...}` in TS,
  // which the transpiler emits as a standalone C++ function.
  if (node.events) {
    const kindMap = { click: "click", hold: "hold", release: "release", change: "change" } as const;
    for (const key of Object.keys(node.events) as Array<keyof typeof kindMap>) {
      const fnName = node.events[key];
      if (fnName) {
        recordClickHandler({
          nodeIndex,
          kind: kindMap[key],
          fnName,
          callbackBody: "",
          isNamedRef: true,
        });
      }
    }
  }

  // The check/select/radio branches generate fnNames from node.id, so they
  // require one. The href (navigation) branch below works with or without id.
  // Run-bearing link nodes also work without id (handler body is a no-op; the
  // real navigation happens via the run hit-test in the tap path).
  const hasLinkRun = !!node.runs?.some(r => r.href);
  if (!node.id && !node.href && !hasLinkRun) return;
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

    // Auto-wire: onClick opens the modal option list (ui_select_menu_open);
    // tapping a row in the modal sets the value. Preview parity: the preview
    // runtime opens its own overlay on tap instead of cycling.
    recordClickHandler({
      nodeIndex,
      kind: "click",
      fnName: `__ui_${node.id}_autoclick`,
      callbackBody: `ui_select_menu_open(${nodeIndex});`,
    });

    // Auto-bind text to show the current option via snprintf if/else chain.
    // Cast size to size_t to satisfy -Wformat (snprintf's n param is size_t;
    // the textFn signature uses uint8_t).
    const branches = options.map((opt, i) => {
      if (i === 0) return `if (__ui_nodes[${nodeIndex}].value == 0) { snprintf(buf, static_cast<size_t>(size), "%s", "${opt}"); }`;
      return `else if (__ui_nodes[${nodeIndex}].value == ${i}) { snprintf(buf, static_cast<size_t>(size), "%s", "${opt}"); }`;
    }).join(" ");
    const elseBranch = `else { snprintf(buf, static_cast<size_t>(size), "%s", "${options[0] || ""}"); }`;

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
      callbackBody: `for (uint8_t __r = 0; __r < __ui_radio_groups[${groupIdx}].count; __r++) { uint16_t __rn = __ui_radio_groups[${groupIdx}].nodeIndices[__r]; __ui_nodes[__rn].value = 0; ui_mark_dirty(__rn); } __ui_nodes[${nodeIndex}].value = 1; ui_mark_dirty(${nodeIndex});`,
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
  } else if (hasLinkRun) {
    // Run-bearing link node (an inline <a href> inside a paragraph). The link
    // targets live on the runs and are resolved into the model at lower time;
    // the tap path calls ui_rich_link_hit / richLinkHit to pick the target.
    // Register a no-op click handler so the node is hit-testable in the first
    // place (hit-test only considers nodes with a registered handler).
    recordClickHandler({
      nodeIndex,
      kind: "click",
      fnName: `__ui_${node.id ?? "richlink" + nodeIndex}_nav`,
      callbackBody: `/* rich-text link; target resolved by ui_rich_link_hit */`,
    });
  }
}
