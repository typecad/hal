// ---------------------------------------------------------------------------
// Shared string-method lowering registry
//
// Single source of truth for rewriting JS string method calls
// (`s.toUpperCase()`, `s.substring(0, 2)`, …) into the `__tc_*` C++ helper
// calls that both the native and Arduino/AVR strategies emit.
//
// Both platform strategies previously maintained their own (drifting) regex
// tables inside normalizeRawExpression(). The native table additionally had a
// latent bug: its receiver-capture group `R` used nested capturing groups,
// which shifted the backreferences and caused methods like substring/slice/
// charCodeAt to emit the receiver twice and drop an argument
// (e.g. `frame.substring(0, 2)` → `__tc_substring2(frame, frame, 0)`).
//
// This module centralises the lowering with a receiver pattern that captures
// the receiver as a single group, fixing that bug for every target.
// ---------------------------------------------------------------------------

/**
 * Argument shape for a string method, determining how the call is rewritten.
 * - `receiverOnly`: no args, e.g. `s.toUpperCase()`
 * - `unary`:        one arg,   e.g. `s.charAt(2)`
 * - `binary`:       two args,  e.g. `s.substring(0, 2)`
 * - `unaryDefault`: one-arg form that has a default (e.g. padStart),
 *                    emitted via a `_default` helper variant
 */
export type StringMethodArgForm = "receiverOnly" | "unary" | "binary" | "unaryDefault";

export interface StringMethodSpec {
  /** The exact `__tc_*` helper name emitted for this form (e.g. `__tc_substring2`). */
  helper: string;
  argForm: StringMethodArgForm;
  /**
   * The JS method name this spec lowers. Defaults to the helper name with the
   * `__tc_` prefix and any trailing arity suffix (`1`/`2`) stripped.
   */
  methodName?: string;
}

/**
 * Derive the JS method name from a helper name: strip `__tc_`, then strip a
 * trailing `_default` or arity digit (so `__tc_substring2` → `substring`,
 * `__tc_padStart_default` → `padStart`).
 */
function methodNameFromHelper(helper: string): string {
  return helper.replace(/^__tc_/, "").replace(/_default$/, "").replace(/\d+$/, "");
}

/**
 * Ordered table of JS string methods → `__tc_*` lowering specs.
 * Order matters: 2-arg (binary) forms MUST precede their 1-arg (unary)
 * counterparts so that `substring(0, 2)` isn't partially matched by the
 * 1-arg rule first. Each spec names the EXACT helper for its arity.
 */
export const STRING_METHODS: StringMethodSpec[] = [
  // ── No-arg methods (receiver only) ───────────────────────────────────────
  { helper: "__tc_toUpperCase", argForm: "receiverOnly" },
  { helper: "__tc_toLowerCase", argForm: "receiverOnly" },
  { helper: "__tc_trim",        argForm: "receiverOnly" },
  // ── Two-arg methods (must precede 1-arg forms) ───────────────────────────
  { helper: "__tc_substring2", argForm: "binary" },
  { helper: "__tc_slice2",     argForm: "binary" },
  { helper: "__tc_padStart",   argForm: "binary" },
  { helper: "__tc_padEnd",     argForm: "binary" },
  { helper: "__tc_replace",    argForm: "binary" },
  // ── One-arg methods ──────────────────────────────────────────────────────
  { helper: "__tc_substring1", argForm: "unary" },
  { helper: "__tc_slice1",     argForm: "unary" },
  { helper: "__tc_padStart_default", argForm: "unaryDefault" },
  { helper: "__tc_padEnd_default",   argForm: "unaryDefault" },
  { helper: "__tc_charAt",     argForm: "unary" },
  { helper: "__tc_charCodeAt", argForm: "unary" },
  { helper: "__tc_endsWith",   argForm: "unary" },
  { helper: "__tc_startsWith", argForm: "unary" },
  { helper: "__tc_includes",   argForm: "unary" },
  { helper: "__tc_indexOf",    argForm: "unary" },
  { helper: "__tc_lastIndexOf",argForm: "unary" },
  { helper: "__tc_repeat",     argForm: "unary" },
  { helper: "__tc_split",      argForm: "unary" },
  // NOTE: `__tc_join` is intentionally NOT in this table. `.join(sep)` is a
  // std::VECTOR method (it returns a std::string built from the vector's
  // elements), NOT a std::string method. Listing it here previously caused
  // `parts.join(' ')` on a `mutableArrayVars` receiver (a string[] built via
  // .push) to fall through BOTH lowering paths: `shouldLowerAsStringMethod`
  // returns false for a known array (correct), and the vector-method table
  // `VECTOR_VALUE_METHOD_LOWERINGS` had no `join` entry, so the call was
  // emitted verbatim (`parts.join(" ")`) and g++ rejected it ("no member
  // named 'join'"). `join` is now lowered in the VECTOR path
  // (ir/transformers/array-methods.ts), and the polyfill helper is still
  // registered via POLYFILL_HELPER_MAP['.join(']. Demo #31 Finding B.
];

/** JS method name → spec (for the names set). */
const STRING_METHOD_BY_NAME = new Map<string, StringMethodSpec>();
for (const spec of STRING_METHODS) {
  const name = spec.methodName ?? methodNameFromHelper(spec.helper);
  STRING_METHOD_BY_NAME.set(name, spec);
}

/**
 * The set of JS string-method names this registry knows how to lower.
 * Used by program analysis to detect which polyfill helpers are needed.
 */
export const STRING_METHOD_NAMES: ReadonlySet<string> = new Set(STRING_METHOD_BY_NAME.keys());

/**
 * Receiver-capture pattern shared across targets. Captures the receiver as
 * group 1 (the ONLY group before the method arguments), so backreferences for
 * arguments always start at $2.
 *
 * The outer group is CAPTURING (so it is $1); the inner alternation between
 * `std::string(...)` and identifier-chains is NON-capturing so it does not
 * shift the group numbering. (The old native `R` pattern used a nested
 * capturing alternation, which shifted backreferences and caused the
 * receiver to be emitted twice — the substring/slice/charCodeAt bug.)
 *
 * Matches:
 *  - `std::string(...)` constructor calls, or
 *  - an identifier optionally followed by `.member` chains.
 */
const RECEIVER_PATTERN =
  "((?:std::string\\([^)]*\\)|(?:[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)))";

/**
 * Apply all string-method rewrites to a raw C++ expression string.
 *
 * This is the shared lowering that both the native and Arduino strategies
 * call from their `normalizeRawExpression()`. Each strategy may perform
 * additional platform-specific rewrites (pin modes, HAL, etc.) before/after.
 *
 * The `options.receiverWrapper` lets a strategy wrap the receiver when it
 * becomes a helper argument — e.g. Arduino wraps `indexOf` receivers in
 * `__tc_str_ptr(...)`. Methods listed in `options.special` are replaced
 * entirely (Arduino uses `strstr`/`strncmp` for `includes`/`startsWith`).
 */
export function applyStringMethodRewrites(
  value: string,
  options: {
    /** Methods whose helper the receiver should be wrapped in (e.g. indexOf → __tc_str_ptr). */
    wrapReceiverFor?: ReadonlySet<string>;
    /**
     * Per-method custom rewrites that bypass the standard helper form.
     * Keyed by JS method name → function(receiver, args[]) returning the
     * replacement string, or undefined to fall back to the standard form.
     */
    special?: Record<string, (receiver: string, args: string[]) => string | undefined>;
  } = {},
): string {
  const wrapReceiverFor = options.wrapReceiverFor ?? new Set<string>();
  const special = options.special ?? {};
  let v = value;
  let prev = "";
  // Loop because one rewrite can expose another (e.g. chained calls). Bound
  // to avoid infinite loops: each pass either changes the string or stops.
  let guard = 0;
  while (prev !== v && guard < 8) {
    prev = v;
    guard++;
    for (const spec of STRING_METHODS) {
      const name = spec.methodName ?? methodNameFromHelper(spec.helper);
      v = rewriteMethod(v, name, spec, wrapReceiverFor, special);
    }
  }
  return v;
}

/** Rewrite a single method name according to its spec. */
function rewriteMethod(
  v: string,
  name: string,
  spec: StringMethodSpec,
  wrapReceiverFor: ReadonlySet<string>,
  special: Record<string, (receiver: string, args: string[]) => string | undefined>,
): string {
  const R = RECEIVER_PATTERN;
  const wrap = (recv: string) =>
    wrapReceiverFor.has(name) ? `__tc_str_ptr(${recv})` : recv;

  if (spec.argForm === "receiverOnly") {
    // s.name() → __tc_name(s)
    const re = new RegExp(`${R}\\.${escapeRegex(name)}\\(\\)`, "g");
    v = v.replace(re, (_m, receiver: string) => {
      const custom = special[name]?.(receiver, []);
      return custom ?? `${spec.helper}(${wrap(receiver)})`;
    });
    return v;
  }

  if (spec.argForm === "unary") {
    // s.name(arg) → __tc_name(s, arg)
    const re = new RegExp(`${R}\\.${escapeRegex(name)}\\(([^)]+)\\)`, "g");
    v = v.replace(re, (_m, receiver: string, arg: string) => {
      const custom = special[name]?.(receiver, [arg]);
      return custom ?? `${spec.helper}(${wrap(receiver)}, ${arg})`;
    });
    return v;
  }

  if (spec.argForm === "binary") {
    // s.name(a, b) → __tc_nameN(s, a, b). The helper name carries the arity
    // suffix already (e.g. __tc_substring2, __tc_slice2).
    const re = new RegExp(`${R}\\.${escapeRegex(name)}\\(([^,]+),\\s*([^)]+)\\)`, "g");
    v = v.replace(re, (_m, receiver: string, a: string, b: string) => {
      const custom = special[name]?.(receiver, [a, b]);
      return custom ?? `${spec.helper}(${wrap(receiver)}, ${a}, ${b})`;
    });
    return v;
  }

  // unaryDefault: s.name(arg) → __tc_name_default(s, arg)
  const re = new RegExp(`${R}\\.${escapeRegex(name)}\\(([^)]+)\\)`, "g");
  v = v.replace(re, (_m, receiver: string, arg: string) => {
    const custom = special[name]?.(receiver, [arg]);
    return custom ?? `${spec.helper}(${wrap(receiver)}, ${arg})`;
  });
  return v;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
