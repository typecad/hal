// Compile-time scroll viewport memory analysis. Overflow scroll containers
// need a viewport-sized RGB565 canvas (~w×h×2 bytes) for the smooth Mode B
// shift-and-repair path. When that exceeds the device budget the runtime
// degrades to the band renderer, which composes the subtree into a short
// horizontal band canvas (~vw × UI_STRIP_BAND_HEIGHT ≈ 10KB) and pushes one
// band at a time — tear-free and bounded regardless of program size. Direct
// per-node draws (which can tear on SPI TFTs) happen only if the band canvas
// itself fails to allocate.

import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import type { UINodeModel } from "./model.js";
import { DEFAULT_SCROLL_CANVAS_BUDGET_BYTES } from "@typecad/cuttlefish/api/shared";

export { DEFAULT_SCROLL_CANVAS_BUDGET_BYTES };

export interface ScrollMemoryIssue {
  nodeIndex: number;
  id?: string;
  width: number;
  height: number;
  canvasBytes: number;
  budgetBytes: number;
}

/** Collect overflow scroll nodes whose viewport canvas exceeds the budget. */
export function collectScrollMemoryIssues(
  nodes: UINodeModel[],
  budgetBytes: number = DEFAULT_SCROLL_CANVAS_BUDGET_BYTES,
): ScrollMemoryIssue[] {
  const issues: ScrollMemoryIssue[] = [];
  for (const node of nodes) {
    if (!node.scrollable) continue;
    if (node.contentHeight <= node.box.h) continue;
    const canvasBytes = node.box.w * node.box.h * 2;
    if (canvasBytes <= budgetBytes) continue;
    issues.push({
      nodeIndex: node.index,
      id: node.id,
      width: node.box.w,
      height: node.box.h,
      canvasBytes,
      budgetBytes,
    });
  }
  return issues;
}

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function minimizationHint(issue: ScrollMemoryIssue): string {
  const maxArea = Math.floor(issue.budgetBytes / 2);
  const maxHAtWidth = issue.width > 0 ? Math.floor(maxArea / issue.width) : 0;
  const maxWAtHeight = issue.height > 0 ? Math.floor(maxArea / issue.height) : 0;
  return [
    "This is advisory only: the band renderer keeps scrolling tear-free on a ~10KB band canvas, so no action is required to ship.",
    "To restore the cheaper Mode B shift-and-repair path: reduce the scroll viewport in CSS " +
      `(e.g. height ≤ ${maxHAtWidth}px at ${issue.width}px width, or width ≤ ${maxWAtHeight}px at ${issue.height}px height), ` +
      "trim fonts/images/inactive screens, use PSRAM, or raise display.scroll.scrollCanvasBudgetBytes if the target has the headroom (runtime allocation may still fail).",
  ].join("\n");
}

/** Emit transpile warnings for scroll viewports that cannot fit a Mode B canvas. */
export function analyzeScrollMemory(
  nodes: UINodeModel[],
  budgetBytes: number = DEFAULT_SCROLL_CANVAS_BUDGET_BYTES,
): Diagnostic[] {
  return collectScrollMemoryIssues(nodes, budgetBytes).map((issue) => {
    const label = issue.id ? `#${issue.id}` : `node ${issue.nodeIndex}`;
    return {
      severity: "warning" as const,
      code: "scroll-canvas-memory",
      message:
        `Scroll viewport ${label} (${issue.width}×${issue.height}px) needs ${issue.canvasBytes} bytes ` +
        `(${formatKb(issue.canvasBytes)}) for the smooth Mode B shift-and-repair path, exceeding the ` +
        `${issue.budgetBytes}-byte budget (~${formatKb(issue.budgetBytes)}). ` +
        "Rendering falls back to the band renderer (composes the subtree into a ~10KB band canvas, " +
        "one push per band — tear-free); only if the band canvas itself cannot allocate does it " +
        "degrade to per-node direct draws, which can tear on SPI TFTs.",
      hint: minimizationHint(issue),
    };
  });
}
