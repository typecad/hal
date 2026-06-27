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

import { Box, IntrinsicSize, isDisplayNone, LayoutEngine, parseAspectRatio } from "./layout-engine.js";
import { StyledNode } from "./style-resolver.js";
import { CSSProperty } from "./css-parser.js";
import Yoga from "yoga-layout";

/** Parse the first numeric value from a CSS string ("8px", "8px 16px" → 8). */
/** Parse a single CSS length to device pixels.
 *  rem/em × 16 (root font size), px/bare as-is, decimals supported. */
function cssLength(val: string): number {
  const v = val.trim();
  const remM = /^(-?[\d.]+)rem$/.exec(v);
  if (remM) return Math.round(parseFloat(remM[1]) * 16);
  const emM = /^(-?[\d.]+)em$/.exec(v);
  if (emM) return Math.round(parseFloat(emM[1]) * 16);
  const m = /^(-?[\d.]+)(?:px|%)?$/.exec(v);
  return m ? parseFloat(m[1]) : 0;
}

function cssNum(val: string | undefined): number {
  if (!val) return 0;
  return cssLength(val);
}

/** Parse horizontal padding from shorthand ("8px 16px" → 16 for left/right). */
function cssPadH(val: string | undefined): number {
  if (!val) return 0;
  const parts = val.trim().split(/\s+/);
  if (parts.length <= 1) return cssLength(parts[0] ?? "0");
  return cssLength(parts[1] ?? parts[0]);
}

/** Parse vertical padding from shorthand ("8px 16px" → 8 for top/bottom). */
function cssPadV(val: string | undefined): number {
  if (!val) return 0;
  const parts = val.trim().split(/\s+/);
  return cssLength(parts[0] ?? "0");
}

/** Parse border width from "2px solid #808080" → 2. */
function cssBorderWidth(val: string | undefined): number {
  if (!val) return 0;
  // border shorthand: "<width> <style> <color>" — width is the first token.
  const first = val.trim().split(/\s+/)[0];
  return cssLength(first);
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
    measureFn: (node: StyledNode, availableWidth?: number) => IntrinsicSize,
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
    measureFn: (node: StyledNode, availableWidth?: number) => IntrinsicSize,
    myIndex: number = metaArray.length,
  ): any {
    const yn = Yoga.Node.create();
    const idx = metaArray.length;
    metaArray.push({ style: node.style });

    const s = node.style;
    if (isDisplayNone(node)) {
      yn.setDisplay?.(Yoga.DISPLAY_NONE);
    }

    // Flex container
    // flex-direction: row | row-reverse | column | column-reverse.
    // Each value maps to a distinct Yoga enum (reverse was previously
    // dropped — any non-"row" value collapsed to column).
    const fd = s.display === "flex" ? s.flexDirection : "column";
    if (fd === "row") yn.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    else if (fd === "row-reverse") yn.setFlexDirection(Yoga.FLEX_DIRECTION_ROW_REVERSE);
    else if (fd === "column-reverse") yn.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN_REVERSE);
    else yn.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);

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

    // Gap: row-gap / column-gap are applied per-axis. Uniform `gap`
    // (both equal) uses GUTTER_ALL for efficiency; mismatched values
    // set GUTTER_ROW and GUTTER_COLUMN separately.
    const rowGap = cssNum(s.rowGap);
    const colGap = cssNum(s.columnGap);
    if (rowGap && colGap && rowGap === colGap) {
      yn.setGap(Yoga.GUTTER_ALL, rowGap);
    } else {
      if (rowGap) yn.setGap(Yoga.GUTTER_ROW, rowGap);
      if (colGap) yn.setGap(Yoga.GUTTER_COLUMN, colGap);
    }

    // Border
    const borderW = cssBorderWidth(s.border);
    if (borderW) {
      yn.setBorder(Yoga.EDGE_ALL, borderW);
    }

    // Align-self
    if (s.alignSelf === "flex-start") yn.setAlignSelf(Yoga.ALIGN_FLEX_START);
    else if (s.alignSelf === "center") yn.setAlignSelf(Yoga.ALIGN_CENTER);
    else if (s.alignSelf === "stretch") yn.setAlignSelf(Yoga.ALIGN_STRETCH);
    else if (s.alignSelf === "flex-end") yn.setAlignSelf(Yoga.ALIGN_FLEX_END);
    else if (s.alignSelf === "baseline") yn.setAlignSelf(Yoga.ALIGN_BASELINE);

    // Align-items / justify-content (container properties)
    if (s.alignItems) {
      if (s.alignItems === "flex-start") yn.setAlignItems(Yoga.ALIGN_FLEX_START);
      else if (s.alignItems === "center") yn.setAlignItems(Yoga.ALIGN_CENTER);
      else if (s.alignItems === "stretch") yn.setAlignItems(Yoga.ALIGN_STRETCH);
      else if (s.alignItems === "flex-end") yn.setAlignItems(Yoga.ALIGN_FLEX_END);
    }
    // Align-content (multi-line flex-wrap cross-axis alignment)
    if (s.alignContent) {
      if (s.alignContent === "flex-start") yn.setAlignContent(Yoga.ALIGN_FLEX_START);
      else if (s.alignContent === "center") yn.setAlignContent(Yoga.ALIGN_CENTER);
      else if (s.alignContent === "flex-end") yn.setAlignContent(Yoga.ALIGN_FLEX_END);
      else if (s.alignContent === "stretch") yn.setAlignContent(Yoga.ALIGN_STRETCH);
      else if (s.alignContent === "space-between") yn.setAlignContent(Yoga.ALIGN_SPACE_BETWEEN);
      else if (s.alignContent === "space-around") yn.setAlignContent(Yoga.ALIGN_SPACE_AROUND);
      else if (s.alignContent === "space-evenly") yn.setAlignContent(Yoga.ALIGN_SPACE_EVENLY);
    }
    if (s.justifyContent) {
      if (s.justifyContent === "flex-start") yn.setJustifyContent(Yoga.JUSTIFY_FLEX_START);
      else if (s.justifyContent === "center") yn.setJustifyContent(Yoga.JUSTIFY_CENTER);
      else if (s.justifyContent === "flex-end") yn.setJustifyContent(Yoga.JUSTIFY_FLEX_END);
      else if (s.justifyContent === "space-between") yn.setJustifyContent(Yoga.JUSTIFY_SPACE_BETWEEN);
      else if (s.justifyContent === "space-around") yn.setJustifyContent(Yoga.JUSTIFY_SPACE_AROUND);
      else if (s.justifyContent === "space-evenly") yn.setJustifyContent(Yoga.JUSTIFY_SPACE_EVENLY);
    }

    // Flex wrap
    if (s.flexWrap === "wrap") yn.setFlexWrap(Yoga.WRAP_WRAP);
    else if (s.flexWrap === "wrap-reverse") yn.setFlexWrap(Yoga.WRAP_WRAP_REVERSE);
    else if (s.flexWrap === "nowrap") yn.setFlexWrap(Yoga.WRAP_NO_WRAP);

    // Flex grow/shrink/basis
    if (s.flexGrow) yn.setFlexGrow(cssNum(s.flexGrow));
    if (s.flexShrink) yn.setFlexShrink(cssNum(s.flexShrink));
    if (s.flexBasis) {
      const basis = cssNum(s.flexBasis);
      if (s.flexBasis === "auto") yn.setFlexBasisAuto();
      else yn.setFlexBasis(basis);
    }

    // Order (Yoga may not expose setOrder in its types, but the runtime has it)
    if (s.order) (yn as any).setOrder?.(cssNum(s.order));

    // Min/max dimensions
    if (s.minWidth) yn.setMinWidth(cssNum(s.minWidth));
    if (s.maxWidth) yn.setMaxWidth(cssNum(s.maxWidth));
    if (s.minHeight) yn.setMinHeight(cssNum(s.minHeight));
    if (s.maxHeight) yn.setMaxHeight(cssNum(s.maxHeight));

    // Box sizing
    if (s.boxSizing === "border-box") yn.setBoxSizing?.(Yoga.BOX_SIZING_BORDER_BOX);

    // Overflow
    if (s.overflow === "hidden") yn.setOverflow?.(Yoga.OVERFLOW_HIDDEN);
    else if (s.overflow === "scroll") yn.setOverflow?.(Yoga.OVERFLOW_SCROLL);

    // Position
    if (s.position === "relative") yn.setPositionType(Yoga.POSITION_TYPE_RELATIVE);
    else if (s.position === "absolute") yn.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
    else yn.setPositionType(Yoga.POSITION_TYPE_STATIC);
    if (s.top) yn.setPosition(Yoga.EDGE_TOP, cssNum(s.top));
    if (s.right) yn.setPosition(Yoga.EDGE_RIGHT, cssNum(s.right));
    if (s.bottom) yn.setPosition(Yoga.EDGE_BOTTOM, cssNum(s.bottom));
    if (s.left) yn.setPosition(Yoga.EDGE_LEFT, cssNum(s.left));

    // Width/height (explicit)
    if (s.width) yn.setWidth(cssNum(s.width));
    if (s.height) yn.setHeight(cssNum(s.height));
    const aspectRatio = parseAspectRatio(s.aspectRatio);
    if (aspectRatio !== undefined) yn.setAspectRatio(aspectRatio);

    // Children
    for (const child of node.children) {
      const childNode = this.buildTree(child, metaArray, measureFn);
      yn.insertChild(childNode, yn.getChildCount());
    }

    // Leaf nodes with text: let Yoga pass available width into measurement so
    // wrapped text can expand height under constraints.
    if (node.children.length === 0) {
      const textLike = node.tag === "text" || node.tag === "button" || node.tag === "check" || node.tag === "radio";
      if (textLike) {
        yn.setMeasureFunc((width: number, widthMode: number) => {
          const hasWidth = widthMode !== Yoga.MEASURE_MODE_UNDEFINED && Number.isFinite(width) && width > 0;
          const intrinsic = measureFn(node, hasWidth ? width : undefined);
          return {
            width: Math.ceil(intrinsic.w),
            height: Math.ceil(intrinsic.h),
          };
        });
      } else {
        const intrinsic = measureFn(node);
        const childPadV = cssPadV(s.padding);
        const childPadH = cssPadH(s.padding);
        const childBorder = cssBorderWidth(s.border);
        if (!s.width && intrinsic.w > 0) {
          yn.setWidth(Math.ceil(intrinsic.w + childPadH * 2 + childBorder * 2));
        }
        if (!s.height && intrinsic.h > 0) {
          yn.setHeight(intrinsic.h + childPadV * 2 + childBorder * 2);
        }
      }
    }

    return yn;
  }

  /** Walk the Yoga tree in pre-order DFS, extracting absolute {x,y,w,h} per node.
   * Yoga returns positions relative to the parent — we accumulate parentX/Y
   * to produce absolute coordinates. Must match the StyledNode tree's DFS. */
  private extractBoxes(
    node: any,
    out: Box[],
    nextMeta: () => NodeMeta | undefined,
    parentX: number = 0,
    parentY: number = 0,
  ): void {
    const x = parentX + Math.round(node.getComputedLeft());
    const y = parentY + Math.round(node.getComputedTop());
    const w = Math.round(node.getComputedWidth());
    const h = Math.round(node.getComputedHeight());
    out.push({ x, y, w, h });

    nextMeta();

    for (let i = 0; i < node.getChildCount(); i++) {
      this.extractBoxes(node.getChild(i), out, nextMeta, x, y);
    }
  }
}
