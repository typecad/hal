// ---------------------------------------------------------------------------
// BlockLayoutEngine — v1 fallback layout. Stacks children vertically inside the
// parent's content box (parent box minus padding). Each child's width fills
// the content box; height comes from measure() for text/button leaves, or a
// synthesized height for containers.
//
// This is the fallback when no `display: flex` is present. YogaLayoutEngine
// handles flexbox layouts.
// ---------------------------------------------------------------------------

import { Box, IntrinsicSize, isDisplayNone, LayoutEngine } from "./layout-engine.js";
import { StyledNode } from "./style-resolver.js";

/** Parse a CSS value string ("8px", "8") to a number. */
function cssNum(val: string | number | undefined): number {
  if (val === undefined) return 0;
  if (typeof val === "number") return val;
  const m = val.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

export class BlockLayoutEngine implements LayoutEngine {
  readonly id = "block" as const;

  arrange(root: StyledNode, viewport: Box, measureFn: (n: StyledNode, availableWidth?: number) => IntrinsicSize): Box[] {
    const boxes: Box[] = [];
    this.layoutNode(root, viewport, boxes, measureFn);
    return boxes;
  }

  private layoutNode(
    node: StyledNode,
    box: Box,
    out: Box[],
    measureFn: (n: StyledNode, availableWidth?: number) => IntrinsicSize,
  ): void {
    if (isDisplayNone(node)) {
      this.layoutHiddenSubtree(node, out);
      return;
    }

    out.push(box);
    if (node.children.length === 0) return;

    const pad = cssNum(node.style.padding);
    const content: Box = {
      x: box.x + pad,
      y: box.y + pad,
      w: box.w - pad * 2,
      h: box.h - pad * 2,
    };
    let cursorY = content.y;

    for (const child of node.children) {
      if (isDisplayNone(child)) {
        this.layoutHiddenSubtree(child, out);
        continue;
      }

      // Buttons size to their content (text + padding), not the full
      // container width. Other elements fill the content width (block flow).
      const childPad = cssNum(child.style.padding);
      const isButton = child.tag === "button";
      const measureWidth = isButton ? undefined : Math.max(0, content.w - childPad * 2);
      const intrinsic = measureFn(child, measureWidth);
      const childW = isButton && intrinsic.w > 0
        ? intrinsic.w + childPad * 2
        : content.w;
      const childH = intrinsic.h > 0 ? intrinsic.h + (isButton ? childPad * 2 : 0) : 16;
      const childBox: Box = {
        x: content.x,
        y: cursorY,
        w: childW,
        h: childH,
      };
      this.layoutNode(child, childBox, out, measureFn);
      cursorY += childBox.h;
    }
  }

  private layoutHiddenSubtree(node: StyledNode, out: Box[]): void {
    out.push({ x: 0, y: 0, w: 0, h: 0 });
    for (const child of node.children) this.layoutHiddenSubtree(child, out);
  }
}
