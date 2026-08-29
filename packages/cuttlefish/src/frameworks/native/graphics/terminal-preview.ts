// ---------------------------------------------------------------------------
// Terminal preview — renders display ops as ANSI-colored cells to stdout
//
// Lets authors preview a UI on the host with no hardware. Colors map rgb565
// back to the nearest ANSI 16-color for display only.
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from '../../../api/shared/index.js';

/** Map an rgb565 value to an ANSI color code (approximate). */
function rgb565ToAnsi(c: number): number {
  const r5 = (c >> 11) & 0x1f;
  const g6 = (c >> 5) & 0x3f;
  const b5 = c & 0x1f;
  const r = r5 >> 3, g = g6 >> 4, b = b5 >> 3;   // 0/1 per channel
  // ANSI 16-color: foreground 30+bit pattern
  return 30 + (r ? 1 : 0) + (g ? 2 : 0) + (b ? 4 : 0);
}

export function resolveTerminalPreviewOp(
  op: DisplayHALOp,
): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "display.init":
      return { code: `/* native preview: ${op.driver} ${op.width}x${op.height} initialized */` };
    case "display.fill_rect":
      return {
        code: `/* preview fill_rect ${op.x},${op.y} ${op.w}x${op.h} color=0x${op.color.toString(16)} ansi=${rgb565ToAnsi(op.color)} */`,
      };
    case "display.draw_rect":
      return { code: `/* preview draw_rect ${op.x},${op.y} ${op.w}x${op.h} */` };
    case "display.draw_text":
      return { code: `/* preview draw_text ${op.x},${op.y} "${op.text}" */` };
    case "display.flush":
      return { code: `/* preview flush ${op.rects.length} rect(s) */` };
    default:
      return undefined;
  }
}
