// ---------------------------------------------------------------------------
// capture-layout-yoga.mjs — Yoga + css-tree layout prototype
//
// Parses the demo-ui HTML+CSS with real CSS/DOM tools, runs Yoga flexbox
// layout, and emits the primitive list (fillRect, drawRect, text) that the
// GFX runtime would draw. No browser needed.
//
// Run: node demo-ui/scripts/capture-layout-yoga.mjs
// ---------------------------------------------------------------------------

import { parse, walk, generate } from "css-tree";
import { parseHTML } from "linkedom";
import Yoga from "yoga-layout";

const htmlSrc = `<screen>
  <text id="greeting">hello cuttlefish</text>
  <button id="btn">typeCAD</button>
</screen>`;

const cssSrc = `
screen {
  background: #e73b3b;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#greeting {
  color: #ffffff;
  font-size: 16px;
}
#btn {
  background: #404040;
  color: #ffffff;
  border: 2px solid #808080;
  border-radius: 6px;
  padding: 8px 16px;
  align-self: flex-start;
}
`;

// ── 1. Parse the CSS into a rule map (selector → properties) ───────────────

const rules = [];
const ast = parse(cssSrc, { parseAtrule: false });
walk(ast, {
  enter(node) {
    if (node.type === "Rule") {
      // Extract selector text via generate (robust across css-tree versions)
      const selector = generate(node.prelude).trim();

      // Extract declarations
      const props = {};
      node.block.children.forEach((child) => {
        if (child.type === "Declaration") {
          const val = generate(child.value).trim();
          props[child.property] = val;
        }
      });
      rules.push({ selector, props });
    }
  },
});

// ── 2. Build a lightweight DOM and resolve computed styles ─────────────────

const { document } = parseHTML("<!DOCTYPE html><body></body>");

function makeEl(tag, id, text) {
  const el = document.createElement("div");
  el.setAttribute("data-tag", tag);
  el.setAttribute("data-id", id || "");
  el.setAttribute("data-text", text || "");
  // Also set textContent on leaf elements (no children) so it's retrievable
  if (text) el.textContent = text;
  return el;
}

const body = document.body;
body.setAttribute("data-tag", "screen");

// Parse the custom HTML tags into divs with data attributes
const tagRegex = /<(text|button)\s+id="([^"]*)">([^<]*)<\/\1>/g;
let m;
while ((m = tagRegex.exec(htmlSrc)) !== null) {
  body.appendChild(makeEl(m[1], m[2], m[3].trim()));
}

// Resolve computed style for each element (simplified cascade: last match wins)
function resolveStyle(el) {
  const id = el.getAttribute("data-id") || el.id || "";
  const tag = el.getAttribute("data-tag") || "";
  const isBody = el.tagName === "BODY";
  const computed = {};
  for (const { selector, props } of rules) {
    let match = false;
    const sel = selector.trim();
    if (sel.startsWith("#")) {
      match = sel.slice(1) === id;
    } else if (sel.startsWith(".")) {
      match = false;
    } else {
      // Element selector: "screen" matches body (the root), "text"/"button"
      // match the data-tag attribute
      match = (isBody && (sel === "screen" || sel === "body")) || sel === tag;
    }
    if (match) Object.assign(computed, props);
  }
  return computed;
}

// ── 3. Run Yoga layout ─────────────────────────────────────────────────────

// Yoga WASM nodes return new wrapper objects from getChild(), so WeakMap
// identity fails. Store metadata in an array indexed by pre-order traversal
// position — both buildYogaTree and extractPrimitives walk in the same order.
const nodeMetaArray = [];
let metaIndex = 0;

const W = 320, H = 240;  // landscape viewport

function parsePx(val) {
  if (!val) return 0;
  // Take the first numeric value (handles "8px", "8px 16px", "8px 16px 4px 2px")
  const m = String(val).match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function parsePxShorthand(val, which) {
  // which: 0=all, 1=top/bottom, 2=left/right — for 2-value shorthand
  if (!val) return 0;
  const nums = String(val).match(/(\d+)/g) || [];
  if (nums.length === 0) return 0;
  if (nums.length === 1) return parseInt(nums[0]);
  return parseInt(nums[which] ?? nums[0]);
}

function buildYogaTree(el) {
  const node = Yoga.Node.create();
  const style = resolveStyle(el);
  const myIndex = metaIndex++;
  nodeMetaArray.push(null); // placeholder, filled below

  // Flexbox properties
  if (style["display"] === "flex") {
    node.setFlexDirection(
      style["flex-direction"] === "row"
        ? Yoga.FLEX_DIRECTION_ROW
        : Yoga.FLEX_DIRECTION_COLUMN
    );
  }
  node.setPadding(Yoga.EDGE_ALL, parsePx(style["padding"]));
  node.setMargin(Yoga.EDGE_ALL, parsePx(style["margin"]));

  if (style["align-self"] === "flex-start") node.setAlignSelf(Yoga.ALIGN_FLEX_START);

  // Gap (row/column gap)
  const gap = parsePx(style["gap"]);
  if (gap) node.setGap(Yoga.GAP_ALL, gap);

  // Store style data in the array (WeakMap doesn't work — getChild returns new refs)
  const hasChildren = Array.from(el.children).some(c => c.getAttribute && c.getAttribute("data-tag"));
  const text = hasChildren ? "" : (el.textContent || el.getAttribute("data-text") || "").trim();
  nodeMetaArray[myIndex] = {
    style,
    tag: el.getAttribute("data-tag") || "div",
    id: el.getAttribute("data-id") || el.id || "",
    text,
  };

  // Children — use Array.from since linkedom's HTMLCollection may not be for-of iterable
  for (const child of Array.from(el.children)) {
    if (child.getAttribute && child.getAttribute("data-tag")) {
      const childNode = buildYogaTree(child);
      node.insertChild(childNode, node.getChildCount());
    }
  }

  // If leaf with text, set a fixed size based on text length + padding + border
  const meta = nodeMetaArray[myIndex];
  if (node.getChildCount() === 0 && meta.text) {
    const fontSize = parsePx(style["font-size"]) || 16;
    const charW = fontSize * 0.6;
    const textW = meta.text.length * charW;
    const padH = parsePxShorthand(style["padding"], 1);  // horizontal padding (left/right)
    const padV = parsePxShorthand(style["padding"], 0);  // vertical padding (top/bottom)
    const borderW = parsePx(style["border"]);  // border width
    node.setWidth(Math.ceil(textW + padH * 2 + borderW * 2));
    node.setHeight(fontSize + padV * 2 + borderW * 2);
  }

  return node;
}

const root = buildYogaTree(body);
nodeMetaArray[0].text = "";  // screen has no direct text
root.setWidth(W);
root.setHeight(H);
root.calculateLayout(W, H, Yoga.DIRECTION_LTR);

// ── 4. Extract primitives from the Yoga tree ──────────────────────────────

function rgb565(hex) {
  if (!hex) return 0;
  const m = hex.match(/#([0-9a-fA-F]{6})/);
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff;
  return "0x" + (((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)).toString(16).padStart(4, "0");
}

const primitives = [];
let extractIndex = 0;

function extractPrimitives(node, depth = 0) {
  const x = Math.round(node.getComputedLeft());
  const y = Math.round(node.getComputedTop());
  const w = Math.round(node.getComputedWidth());
  const h = Math.round(node.getComputedHeight());
  const meta = nodeMetaArray[extractIndex++] || {};
  const style = meta.style || {};
  const id = meta.id || "";
  const text = meta.text || "";

  // Background fill
  if (style["background"]) {
    primitives.push({ type: "fillRect", x, y, w, h, color: rgb565(style["background"]), id, reason: "background" });
  }

  // Border
  const borderMatch = String(style["border"] || "").match(/(\d+)px\s+solid\s+(#[0-9a-fA-F]{6})/);
  if (borderMatch) {
    const bw = parseInt(borderMatch[1]);
    const bc = rgb565(borderMatch[2]);
    primitives.push({ type: "drawRect", x, y, w, h, color: bc, lineWidth: bw, id, reason: "border" });
  }

  // Border radius → drawRoundRect (if supported by the GFX lib)
  const radius = parsePx(style["border-radius"]);
  if (radius > 0) {
    primitives.push({ type: "drawRoundRect", x, y, w, h, r: radius, id, reason: "border-radius" });
  }

  // Text
  if (text) {
    const fontSize = parsePx(style["font-size"]) || 16;
    const padH = parsePxShorthand(style["padding"], 1);
    const padV = parsePxShorthand(style["padding"], 0);
    const borderW = parsePx(style["border"]);
    primitives.push({ type: "text", x: x + padH + borderW, y: y + padV + borderW, text, color: rgb565(style["color"]), fontSize, id, reason: "text" });
  }

  // Recurse children
  for (let i = 0; i < node.getChildCount(); i++) {
    extractPrimitives(node.getChild(i), depth + 1);
  }
}

extractPrimitives(root);

// ── 5. Output ─────────────────────────────────────────────────────────────

console.log("\n=== Yoga Layout (css-tree + linkedom) ===");
console.log(`Viewport: ${W}×${H}\n`);

console.log("Computed Boxes:");
let printIndex = 0;
function printBoxes(node, indent = "") {
  const x = Math.round(node.getComputedLeft());
  const y = Math.round(node.getComputedTop());
  const w = Math.round(node.getComputedWidth());
  const h = Math.round(node.getComputedHeight());
  const meta = nodeMetaArray[printIndex++] || {};
  const tag = meta.tag || "?";
  const id = meta.id ? `#${meta.id}` : "";
  const txt = meta.text ? ` "${meta.text}"` : "";
  console.log(`${indent}${tag}${id}: {${x}, ${y}, ${w}×${h}}${txt}`);
  for (let i = 0; i < node.getChildCount(); i++) {
    printBoxes(node.getChild(i), indent + "  ");
  }
}
printBoxes(root);
printIndex = 0; // reset for extractPrimitives

console.log("\nPrimitive List (GFX draw calls):");
for (const p of primitives) {
  if (p.type === "fillRect") {
    console.log(`  fillRect(${p.x}, ${p.y}, ${p.w}, ${p.h}, ${p.color})  // ${p.id || "root"} ${p.reason}`);
  } else if (p.type === "drawRect") {
    console.log(`  drawRect(${p.x}, ${p.y}, ${p.w}, ${p.h}, ${p.color})  // ${p.id} ${p.reason} (${p.lineWidth}px)`);
  } else if (p.type === "drawRoundRect") {
    console.log(`  drawRoundRect(${p.x}, ${p.y}, ${p.w}, ${p.h}, ${p.r})  // ${p.id} ${p.reason}`);
  } else if (p.type === "text") {
    console.log(`  setCursor(${p.x}, ${p.y}); setTextColor(${p.color}); print("${p.text}")  // ${p.id} ${p.reason} (${p.fontSize}px)`);
  }
}

console.log(`\nTotal primitives: ${primitives.length}`);
console.log("(no bitmaps — all vector draw calls)");
