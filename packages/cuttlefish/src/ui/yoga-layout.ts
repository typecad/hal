// ---------------------------------------------------------------------------
// YogaLayoutEngine — flexbox layout via Facebook's Yoga engine.
//
// Implements the LayoutEngine interface using yoga-layout (WASM, ~2MB).
// Handles display:flex, flex-direction, gap, align-self, padding (shorthand),
// border, and content-sized leaf nodes. Falls back gracefully when flex
// properties are absent.
//
// The critical contract: arrange() returns Box[] in pre-order DFS order
// matching the StyledNode tree, so lowerUIToCpp's flatten() can index
// boxes[] in lockstep with the styled nodes.
// ---------------------------------------------------------------------------

import { Box, IntrinsicSize, LayoutEngine } from "./layout-engine.js";
import { StyledNode } from "./style-resolver.js";
import { CSSProperty } from "./css-parser.js";
import Yoga from "yoga-layout";

/** Parse the first numeric value from a CSS string ("8px", "8px 16px" → 8). */
function cssNum(val: string | undefined): number {
  if (!val) return 0;
  const m = val.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

/** Parse horizontal padding from shorthand ("8px 16px" → 16 for left/right). */
function cssPadH(val: string | undefined): number {
  if (!val) return 0;
  const nums = val.match(/(\d+)/g) ?? [];
  if (nums.length <= 1) return parseInt(nums[0] ?? "0");
  return parseInt(nums[1] ?? nums[0]);
}

/** Parse vertical padding from shorthand ("8px 16px" → 8 for top/bottom). */
function cssPadV(val: string | undefined): number {
  if (!val) return 0;
  const nums = val.match(/(\d+)/g) ?? [];
  return parseInt(nums[0] ?? "0");
}

/** Parse border width from "2px solid #808080" → 2. */
function cssBorderWidth(val: string | undefined): number {
  if (!val) return 0;
  const m = val.match(/(\d+)px/);
  return m ? parseInt(m[1]) : 0;
}

/** Metadata stored per Yoga node, indexed by traversal position. */
interface NodeMeta {
  style: CSSProperty;
}

export class YogaLayoutEngine implements LayoutEngine {
  readonly id = "flex" as const;

  arrange(
    root: StyledNode,
    viewport: Box,
    measureFn: (node: StyledNode) => IntrinsicSize,
  ): Box[] {
    const metaArray: NodeMeta[] = [];

    // Build the Yoga tree from the StyledNode tree.
    const yogaRoot = this.buildTree(root, metaArray, measureFn);

    yogaRoot.setWidth(viewport.w);
    yogaRoot.setHeight(viewport.h);
    yogaRoot.calculateLayout(viewport.w, viewport.h, Yoga.DIRECTION_LTR);

    // Extract boxes in pre-order DFS matching the StyledNode tree.
    const boxes: Box[] = [];
    let extractIdx = 0;
    this.extractBoxes(yogaRoot, boxes, () => metaArray[extractIdx++]);

    return boxes;
  }

  /** Recursively build a Yoga node tree from a StyledNode tree. */
  private buildTree(
    node: StyledNode,
    metaArray: NodeMeta[],
    measureFn: (node: StyledNode) => IntrinsicSize,
    myIndex: number = metaArray.length,
  ): any {
    const yn = Yoga.Node.create();
    const idx = metaArray.length;
    metaArray.push({ style: node.style });

    const s = node.style;

    // Flex container
    if (s.display === "flex") {
      yn.setFlexDirection(
        s.flexDirection === "row"
          ? Yoga.FLEX_DIRECTION_ROW
          : Yoga.FLEX_DIRECTION_COLUMN,
      );
    } else {
      // Default to column layout for the screen root.
      yn.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    }

    // Padding (all edges from shorthand, using the vertical value for uniformity)
    const padV = cssPadV(s.padding);
    const padH = cssPadH(s.padding);
    if (padV || padH) {
      yn.setPadding(Yoga.EDGE_TOP, padV);
      yn.setPadding(Yoga.EDGE_BOTTOM, padV);
      yn.setPadding(Yoga.EDGE_LEFT, padH);
      yn.setPadding(Yoga.EDGE_RIGHT, padH);
    }

    // Margin
    const marginV = cssPadV(s.margin);
    const marginH = cssPadH(s.margin);
    if (marginV || marginH) {
      yn.setMargin(Yoga.EDGE_TOP, marginV);
      yn.setMargin(Yoga.EDGE_BOTTOM, marginV);
      yn.setMargin(Yoga.EDGE_LEFT, marginH);
      yn.setMargin(Yoga.EDGE_RIGHT, marginH);
    }

    // Gap
    const gap = cssNum(s.gap);
    if (gap) yn.setGap(Yoga.GUTTER_ALL, gap);

    // Border
    const borderW = cssBorderWidth(s.border);
    if (borderW) {
      yn.setBorder(Yoga.EDGE_ALL, borderW);
    }

    // Align-self
    if (s.alignSelf === "flex-start") yn.setAlignSelf(Yoga.ALIGN_FLEX_START);
    else if (s.alignSelf === "center") yn.setAlignSelf(Yoga.ALIGN_CENTER);
    else if (s.alignSelf === "stretch") yn.setAlignSelf(Yoga.ALIGN_STRETCH);

    // Width/height (explicit)
    if (s.width) yn.setWidth(cssNum(s.width));
    if (s.height) yn.setHeight(cssNum(s.height));

    // Children
    for (const child of node.children) {
      const childNode = this.buildTree(child, metaArray, measureFn);
      yn.insertChild(childNode, yn.getChildCount());
    }

    // Leaf nodes with text: set content-sized dimensions
    if (node.children.length === 0) {
      const intrinsic = measureFn(node);
      const childPadV = cssPadV(s.padding);
      const childPadH = cssPadH(s.padding);
      const childBorder = cssBorderWidth(s.border);
      if (intrinsic.w > 0) {
        yn.setWidth(Math.ceil(intrinsic.w + childPadH * 2 + childBorder * 2));
      }
      if (intrinsic.h > 0) {
        yn.setHeight(intrinsic.h + childPadV * 2 + childBorder * 2);
      }
    }

    return yn;
  }

  /** Walk the Yoga tree in pre-order DFS, extracting {x,y,w,h} per node.
   * Must match the StyledNode tree's traversal order exactly. */
  private extractBoxes(
    node: any,
    out: Box[],
    nextMeta: () => NodeMeta | undefined,
  ): void {
    const x = Math.round(node.getComputedLeft());
    const y = Math.round(node.getComputedTop());
    const w = Math.round(node.getComputedWidth());
    const h = Math.round(node.getComputedHeight());
    out.push({ x, y, w, h });

    // Advance the metadata cursor (stays in sync with the styled tree's DFS).
    nextMeta();

    for (let i = 0; i < node.getChildCount(); i++) {
      this.extractBoxes(node.getChild(i), out, nextMeta);
    }
  }
}
