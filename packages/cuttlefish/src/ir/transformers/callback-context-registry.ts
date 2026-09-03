// ---------------------------------------------------------------------------
// Declarative capability registry for UI callback contexts.
//
// UI callback bodies (ui.bind/onClick/onToggle/watchPin, ui.drawCanvas)
// each lower through lowerCallbackStatements → lowerStatementList. This
// registry is the single declarative source of truth for diagnostics: each
// context lists what it lowers, and unsupportedStatementHint() renders that
// list into the hint text shown next to fatal "ui-callback-unsupported-
// statement" diagnostics.
// ---------------------------------------------------------------------------

export type CallbackContextId = "ui-event-callback" | "ui-draw-canvas";

export interface CallbackContextCapabilities {
  id: CallbackContextId;
  /** Human label used in diagnostic messages, e.g. "UI event callback". */
  label: string;
  /** Statement-level control-flow constructs this context lowers. */
  statements: readonly string[];
  /** Expression-level / side-effecting forms this context recognizes. */
  expressions: readonly string[];
  /** Actionable next step when a statement/expression isn't supported here. */
  escapeHatch: string;
}

export const CALLBACK_CONTEXTS: Readonly<Record<CallbackContextId, CallbackContextCapabilities>> = {
  "ui-event-callback": {
    id: "ui-event-callback",
    label: "UI event callback",
    statements: ["const/let", "if/else", "for", "while", "do/while", "break/continue"],
    expressions: [
      "signal.set(value)",
      "signal() reads",
      "console.* calls",
      "any other expression via the standard expression pipeline (arithmetic, comparisons, ternaries, color literals, ...)",
    ],
    escapeHatch: "move the logic to a Thread or a plain function",
  },
  "ui-draw-canvas": {
    id: "ui-draw-canvas",
    label: "ui.drawCanvas callback",
    statements: ["const/let", "if/else", "for", "while", "do/while", "break/continue"],
    expressions: [
      "ctx.*() draw calls (drawPixel, fillRect, rect, fillRoundRect, roundRect, line, hline, vline, fillCircle, circle, rgbBitmap, text, fillScreen)",
    ],
    escapeHatch: "move non-drawing side effects (calls not on ctx, e.g. signal writes or console output) to a Thread",
  },
};

/** Human-readable name for a context, used in diagnostic messages. */
export function callbackContextLabel(id: CallbackContextId): string {
  return CALLBACK_CONTEXTS[id].label;
}

/** Render a context's declared capabilities into the hint text shown
 *  alongside a "statement not lowerable here" diagnostic, so the message
 *  always matches what lowerCallbackStatements for that context actually
 *  implements. */
export function unsupportedStatementHint(id: CallbackContextId): string {
  const ctx = CALLBACK_CONTEXTS[id];
  return (
    `${ctx.label}s support ${ctx.statements.join(", ")} for control flow, ` +
    `plus ${ctx.expressions.join("; ")}. If you hit this, the statement kind used ` +
    `isn't lowerable here — ${ctx.escapeHatch}.`
  );
}
