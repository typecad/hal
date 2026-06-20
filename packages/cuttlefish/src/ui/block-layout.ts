// ---------------------------------------------------------------------------
// BlockLayoutEngine — v1 layout. Stacks children vertically inside the
// parent's content box (parent box minus padding). Each child's width fills
// the content box; height comes from measure() for text/button leaves, or a
// synthesized height for containers.
// ---------------------------------------------------------------------------

import { Box, IntrinsicSize, LayoutEngine } from "./layout-engine";
import { StyledNode } from "./style-resolver";

export class BlockLayoutEngine implements LayoutEngine {
  readonly id = "block" as const;

  arrange(root: StyledNode, viewport: Box, measureFn: (n: StyledNode) => IntrinsicSize): Box[] {
    const boxes: Box[] = [];
    this.layoutNode(root, viewport, boxes, measureFn);
    return boxes;
  }

  private layoutNode(
    node: StyledNode,
    box: Box,
    out: Box[],
    measureFn: (n: StyledNode) => IntrinsicSize,
  ): void {
    out.push(box);
    if (node.children.length === 0) return;

    const pad = node.style.padding ?? 0;
    const content: Box = {
      x: box.x + pad,
      y: box.y + pad,
      w: box.w - pad * 2,
      h: box.h - pad * 2,
    };
    let cursorY = content.y;

    for (const child of node.children) {
      const intrinsic = measureFn(child);
      const childBox: Box = {
        x: content.x,
        y: cursorY,
        w: content.w,
        h: intrinsic.h > 0 ? intrinsic.h : 16,
      };
      this.layoutNode(child, childBox, out, measureFn);
      cursorY += childBox.h;
    }
  }
}
