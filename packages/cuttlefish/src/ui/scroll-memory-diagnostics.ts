// Compile-time scroll viewport memory analysis. Overflow scroll containers
// need a viewport-sized RGB565 canvas (~w×h×2 bytes) for smooth Mode B
// scrolling; when that exceeds the device budget, runtime falls back to
// Mode C strip scroll or freezes until memory is available.

import type { Diagnostic } from "../types.js";
import type { UINodeModel } from "./model.js";
import { DEFAULT_SCROLL_CANVAS_BUDGET_BYTES } from "../api/shared/display-profile.js";

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
    `Reduce the scroll viewport in CSS (e.g. height ≤ ${maxHAtWidth}px at ${issue.width}px width, or width ≤ ${maxWAtHeight}px at ${issue.height}px height).`,
    "Trim fonts, images, or inactive screens to free heap for canvas allocation.",
    "Use PSRAM or a board with more SRAM if you need a larger scroll viewport.",
    "Adjust display.scroll.scrollCanvasBudgetBytes in cuttlefish.config.ts only if your target has more headroom (runtime allocation may still fail).",
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
        `(${formatKb(issue.canvasBytes)}) for accurate smooth scrolling, exceeding the ` +
        `${issue.budgetBytes}-byte budget (~${formatKb(issue.budgetBytes)}). ` +
        "Rendering will fall back to Mode C strip scroll or freeze updates until memory is available — " +
        "scrolling may tear, stutter, or skip frames.",
      hint: minimizationHint(issue),
    };
  });
}
