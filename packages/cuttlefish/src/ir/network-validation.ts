// ---------------------------------------------------------------------------
// Network (WiFi / HTTP) Validation
//
// Board-aware, compile-time checks for the WiFi/HTTP HAL:
//
//   wifi-no-radio             (error)   wifi.*/http.* used on a board whose
//                                       architecture has no WiFi radio (avr).
//   http-without-wifi         (warning) http.* used but the program never
//                                       brings a WiFi link up (connect /
//                                       connectSaved / connectAsync / AP).
//   wifi-blocking-in-loop     (warning) blocking WiFi.connect()/scan() or
//                                       Http send inside loop() — stalls every
//                                       iteration; use async/await instead.
//   wifi-ap-password-short    (error)   WiFiAP with a literal WPA2
//                                       password shorter than 8 characters —
//                                       esp_wifi rejects it at runtime.
//   http-max-body-large       (warning) Http maxBody() above 64 KB — the
//                                       response buffer is heap-allocated.
//
// Follows the ADC-validation convention: checks that need board data return
// nothing when the data is missing (no MCU-name fallbacks).
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR } from "../api/index.js";
import type { HALOpIR } from "../api/shared/index.js";
import type { Diagnostic } from "../types.js";
import type { BoardConstants } from "./board-resolver.js";
import { walkProgramIR, walkNestedStatements } from "./utils/walk-ir.js";

/** Architectures with no WiFi radio. Driven by the `architecture` board
 *  constant (from the MCU package); absent data emits nothing. */
const NO_RADIO_ARCHITECTURES = new Set<string>();

/** Ops that bring the WiFi link (STA or AP) up. */
const LINK_UP_OPS = new Set<string>([
  "wifi.join",
  "wifi.connect_start",
  "wifi.ap_start",
]);

/** Blocking waits that stall loop() for their full duration. */
const BLOCKING_LOOP_OPS = new Set<string>([
  "wifi.join",
  "wifi.scan",
  "http.send",
]);

interface CollectedOp {
  op: HALOpIR;
  stmt: StatementIR;
}

/** Strip surrounding quotes from a resolved HAL string field; returns null
 *  when the field is not a literal (identifier/expression — unknowable). */
function literalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
  return match ? match[1] : null;
}

function diagAt(stmt: StatementIR, partial: Omit<Diagnostic, "line" | "column" | "filePath" | "source">): Diagnostic {
  const s = stmt as any;
  return {
    ...partial,
    line: s.sourceSpan?.startLine,
    column: s.sourceSpan?.startColumn,
    filePath: s.sourceSpan?.filePath,
    source: "network-validation",
  };
}

/** Pull every wifi./http. op out of a statement: hal-op statements, awaited
 *  __WIFI_WAIT__/__HTTP_WAIT__ marker calls (hal-expr arg), and hal-expr
 *  expressions in call args / initializers / conditions. */
function collectNetworkOps(stmt: StatementIR, out: CollectedOp[]): void {
  const s = stmt as any;
  const record = (op: unknown) => {
    const operation = (op as HALOpIR | undefined)?.operation;
    if (typeof operation === "string" && (operation.startsWith("wifi.") || operation.startsWith("http."))) {
      out.push({ op: op as HALOpIR, stmt });
    }
  };
  if (stmt.kind === "hal-op") record(s.operation);
  const visitExpr = (expr: unknown): void => {
    if (!expr || typeof expr !== "object") return;
    const e = expr as any;
    if (e.kind === "hal-expr") record(e.operation);
    for (const key of ["args", "elements", "parts"]) {
      if (Array.isArray(e[key])) for (const child of e[key]) visitExpr(child);
    }
    for (const key of ["left", "right", "operand", "condition", "whenTrue", "whenFalse", "inner", "value", "expression"]) {
      if (e[key] && typeof e[key] === "object") visitExpr(e[key]);
    }
  };
  for (const key of ["args", "value", "condition", "initializer", "expression"]) {
    if (s[key]) {
      if (Array.isArray(s[key])) for (const child of s[key]) visitExpr(child);
      else visitExpr(s[key]);
    }
  }
}

export function validateNetworkUsage(program: ProgramIR, boardConstants?: BoardConstants): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const constants = boardConstants ?? (program.boardConstants as BoardConstants | undefined);

  // Collect every wifi./http. op in the program.
  const allOps: CollectedOp[] = [];
  walkProgramIR(program, (stmt) => collectNetworkOps(stmt, allOps));
  if (allOps.length === 0) return diagnostics;

  const wifiOps = allOps.filter(({ op }) => op.operation.startsWith("wifi."));
  const httpOps = allOps.filter(({ op }) => op.operation.startsWith("http."));

  // ── wifi-no-radio ────────────────────────────────────────────────────────
  const architecture = constants?.get("architecture");
  const archName = typeof architecture === "string" ? architecture.replace(/^["']|["']$/g, "").toLowerCase() : null;
  if (archName && NO_RADIO_ARCHITECTURES.has(archName)) {
    const first = allOps[0];
    diagnostics.push(diagAt(first.stmt, {
      severity: "error",
      code: "wifi-no-radio",
      message: `WiFi/HTTP APIs are used but the target board's architecture ('${archName}') has no WiFi radio.`,
      hint: "Target a WiFi-capable board (e.g. esp32_devkitc/esp32/procpu) or remove the WiFi/HTTP calls.",
    }));
    // No point piling on the remaining checks for a board that can't radio.
    return diagnostics;
  }

  // ── http-without-wifi ────────────────────────────────────────────────────
  if (httpOps.length > 0 && !wifiOps.some(({ op }) => LINK_UP_OPS.has(op.operation))) {
    diagnostics.push(diagAt(httpOps[0].stmt, {
      severity: "warning",
      code: "http-without-wifi",
      message: "HTTP requests are made but the program never brings the WiFi link up — every request will fail at runtime.",
      hint: "Join a network first — new WiFi(ssid, { psk}).join() (or a WiFiAP) — before sending HTTP requests.",
    }));
  }

  // ── wifi-blocking-in-loop ────────────────────────────────────────────────
  // Blocking hal-op statements inside loop()'s body stall every iteration.
  // Awaited forms are rewritten to __WIFI_WAIT__/__HTTP_WAIT__ marker calls
  // (kind "call"), so only genuine blocking hal-ops are flagged here.
  const loopFn = program.functions.find((fn) => fn.originalName === "loop");
  if (loopFn?.statements) {
    const visit = (stmt: StatementIR): void => {
      if (stmt.kind === "hal-op" && BLOCKING_LOOP_OPS.has((stmt as any).operation?.operation)) {
        const opName = (stmt as any).operation.operation as string;
        diagnostics.push(diagAt(stmt, {
          severity: "warning",
          code: "wifi-blocking-in-loop",
          message: `Blocking network operation '${opName}' inside loop() stalls every iteration until it completes (seconds for a connect/scan/request).`,
          hint: "Move the call into an async function and `await` it — the transpiler lowers awaited WiFi/HTTP calls to non-blocking start + poll states.",
        }));
      }
      walkNestedStatements(stmt, visit);
    };
    for (const stmt of loopFn.statements) visit(stmt);
  }

  // ── wifi-ap-password-short ───────────────────────────────────────────────
  for (const { op, stmt } of wifiOps) {
    if (op.operation !== "wifi.ap_start") continue;
    const password = literalString((op as any).password);
    if (password !== null && password.length > 0 && password.length < 8) {
      diagnostics.push(diagAt(stmt, {
        severity: "error",
        code: "wifi-ap-password-short",
        message: `WiFiAP password is ${password.length} characters — WPA2 requires at least 8, and the driver rejects shorter ones at runtime.`,
        hint: "Use a password of 8+ characters, or omit the password entirely for an open access point.",
      }));
    }
  }

  // ── http-max-body-large ──────────────────────────────────────────────────
  for (const { op, stmt } of httpOps) {
    if (op.operation !== "http.set_max_body") continue;
    const bytes = Number(String((op as any).bytes).trim());
    if (Number.isFinite(bytes) && bytes > 65536) {
      diagnostics.push(diagAt(stmt, {
        severity: "warning",
        code: "http-max-body-large",
        message: `Http maxBody(${bytes}) heap-allocates a ${Math.round(bytes / 1024)} KB response buffer — large buffers risk allocation failure under fragmentation.`,
        hint: "Keep the response cap at or below 64 KB, or process large payloads in chunks server-side.",
      }));
    }
  }

  return diagnostics;
}
