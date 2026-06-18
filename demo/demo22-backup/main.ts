// ---------------------------------------------------------------------------
// main.ts — infix → RPN expression evaluator (cuttlefish demo #22).
//
// A mid-complexity, idiomatic TypeScript program implementing Dijkstra's
// shunting-yard algorithm: it tokenizes an infix arithmetic expression,
// converts it to Reverse Polish Notation, prints the RPN, then evaluates
// the RPN and prints the result.
//
// This is the *twenty-second* demo iteration. Like #15–#21 it is deliberately
// readable — real, everyday TypeScript — and is *not* a feature-exhaustion
// test. It deliberately picks a *different* data shape from #18–#21 (which
// were CRUD-over-struct-array, container-valued maps, and a byte-array sieve):
//
//   • a **discriminated `interface Token`** (struct with a `const enum` kind
//     field) — value-typed structs flowing through arrays,
//   • a **precedence `Map<string, int32_t>`** keyed by operator characters,
//   • a **token-stream `Token[]`** and a **string operator stack / output
//     queue** (`string[]` with `.push` / `.pop` / indexed read),
//   • an **`Evaluator` class** whose methods call module-scope free functions
//     (`tokenize`, `precedenceOf`, `isRightAssoc`, `applyOp`), and
//   • a numeric `switch` over a `const enum`, a `while` loop with `break`,
//     nested conditionals, and early `return`.
//
// The previous iteration (#21, number-theory explorer) is preserved in
// `demo21-backup/`.
//
// Idiomatic constraints honored up front (per SUPPORT_MATRIX / eslint rules):
// only `const enum`; no `any`; no typed-array fields/returns; no object
// spread; no `instanceof`; no `keyof`/conditional/mapped types; no mutating
// array *parameters*; no comparing a `Map.get()` result to `undefined`
// (guarded with `.has()`). See README for the build verdict.
// ---------------------------------------------------------------------------

// The fixed expression this program evaluates. Whitespace-separated tokens
// are tolerated by the tokenizer.
const SOURCE: string = '( 3 + 4 ) * 5 - 6 / 2';

// Kinds of token the tokenizer can emit. `const enum` so members are inlined
// (a plain `enum` is lint-gated in scaffolded projects — by design).
const enum TokenKind {
  Number = 0,
  Operator = 1,
  LParen = 2,
  RParen = 3,
}

// A single lexical token. An interface → a value-typed C++ struct. Carries a
// discriminator (`kind`) plus the matched text. (Per SUPPORT_MATRIX §1.6,
// interface fields flatten to value types; we never compare `text` to
// null/undefined, so no `TS2CPP_OPTIONAL_FIELD_NULLISH` risk.)
interface Token {
  kind: TokenKind;
  text: string;
}

// ---------------------------------------------------------------------------
// Tokenizer.
//
// Splits `src` into tokens on whitespace, then classifies each chunk: a chunk
// is a Number if it parses as one, an LParen/RParen if it is a single bracket,
// otherwise an Operator. Returns a fresh `Token[]` (we do NOT mutate a
// caller-provided array — see SUPPORT_MATRIX §3.2: array parameters are
// by-value std::vector copies).
// ---------------------------------------------------------------------------
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  // Manual whitespace split (avoids depending on String.split edge behavior
  // and keeps the loop a clean C-style for over fixed-width bounds).
  let current: string = '';
  const n: int32_t = src.length;
  for (let i: int32_t = 0; i < n; i = i + 1) {
    const ch: string = src.charAt(i);
    if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(classifyChunk(current));
        current = '';
      }
      continue;
    }
    current = current + ch;
  }
  if (current.length > 0) {
    tokens.push(classifyChunk(current));
  }
  return tokens;
}

// Classify a single non-whitespace chunk into a Token. A small helper free
// function called from `tokenize` (a free function calling a free function —
// SUPPORT_MATRIX §3.1).
function classifyChunk(chunk: string): Token {
  if (chunk === '(') {
    return { kind: TokenKind.LParen, text: chunk };
  }
  if (chunk === ')') {
    return { kind: TokenKind.RParen, text: chunk };
  }
  // A chunk is a Number iff its first character is a digit. (Keeps the check
  // local; we are not building a full numeric parser.)
  const first: string = chunk.charAt(0);
  if (first >= '0' && first <= '9') {
    return { kind: TokenKind.Number, text: chunk };
  }
  return { kind: TokenKind.Operator, text: chunk };
}

// ---------------------------------------------------------------------------
// Operator metadata: precedence and associativity.
//
// Stored in a module-scope `Map<string, int32_t>` keyed by operator text.
// Higher precedence binds tighter. We use `.has()` before `.get()` — the
// SUPPORT_MATRIX §1.5 caveat: a primitive-valued Map.get + === undefined is
// technically fine, but `.has` is clearer and matches the idiomatic pattern.
// ---------------------------------------------------------------------------
// Declared with `let` (not `const`) because we populate it with `.set()`
// immediately below. The transpiler would otherwise auto-demote a `const`
// Map to non-const (SUPPORT_MATRIX §1.5 — `const` binds the reference, not
// the contents, but the emitted `const std::map` rejects `.set()`). Using
// `let` here expresses the mutation intent and silences the
// `cuttlefish/no-mutating-method-on-const-collection` lint warning.
let PRECEDENCE: Map<string, int32_t> = new Map();
PRECEDENCE.set('+', 10);
PRECEDENCE.set('-', 10);
PRECEDENCE.set('*', 20);
PRECEDENCE.set('/', 20);

// Precedence of an operator, or 0 if it is not in the table. Guards the
// lookup with `.has()` so we never read a missing key.
function precedenceOf(op: string): int32_t {
  if (!PRECEDENCE.has(op)) {
    return 0;
  }
  return PRECEDENCE.get(op)!;
}

// Whether an operator is right-associative. Only `^` would be in a fuller
// calculator; for +, -, *, / all are left-associative, so this is always
// false here — but the function exists so the shunting-yard loop reads
// naturally. (A `bool`-returning free function called from a class method —
// the demo #22 README initially suspected this was a forward-declaration gap,
// but it was a cascade of Finding A. It lowers correctly.)
function isRightAssoc(op: string): boolean {
  return op === '^';
}

// Apply a binary operator to two int32_t operands. A small free function.
function applyOp(op: string, b: int32_t, a: int32_t): int32_t {
  if (op === '+') {
    return a + b;
  }
  if (op === '-') {
    return a - b;
  }
  if (op === '*') {
    return a * b;
  }
  if (op === '/') {
    return a / b;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Evaluator: holds the operator stack and the output (RPN) queue, and exposes
// `toRpn(tokens)` and `evalRpn(rpn)`. A class → C++ class; `new Evaluator()`
// returns a pointer (SUPPORT_MATRIX §4.5).
// ---------------------------------------------------------------------------
class Evaluator {
  // The operator stack (shunting-yard working memory). A plain string[] → a
  // std::vector<std::string> owned by the instance.
  private ops: string[] = [];

  // The output queue: the produced RPN token strings in order.
  private output: string[] = [];

  // Convert an infix token stream to RPN (a fresh string[]). The instance's
  // `ops`/`output` are reset up front so the Evaluator is reusable. The
  // shunting-yard pops directly off `this.ops` — array mutators (`.pop`/
  // `.push`) on instance-field receivers lower correctly to the `__tc_pop`/
  // `push_back` helpers with the full `this->ops` receiver (cuttlefish fix
  // for demo #22 Finding A; previously the receiver was truncated).
  toRpn(tokens: Token[]): string[] {
    this.ops = [];
    this.output = [];
    for (const t of tokens) {
      if (t.kind === TokenKind.Number) {
        this.output.push(t.text);
        continue;
      }
      if (t.kind === TokenKind.LParen) {
        this.ops.push('(');
        continue;
      }
      if (t.kind === TokenKind.RParen) {
        // Pop until the matching LParen.
        while (this.ops.length > 0) {
          const top: string = this.ops.pop()!;
          if (top === '(') {
            break;
          }
          this.output.push(top);
        }
        continue;
      }
      // Operator: pop any stacked operator of higher-or-equal precedence
      // (for left-assoc) before pushing this one.
      const op: string = t.text;
      while (this.ops.length > 0) {
        const top: string = this.ops[this.ops.length - 1]!;
        if (top === '(') {
          break;
        }
        const topPrec: int32_t = precedenceOf(top);
        const curPrec: int32_t = precedenceOf(op);
        if (topPrec > curPrec || (topPrec === curPrec && !isRightAssoc(op))) {
          this.output.push(this.ops.pop()!);
        } else {
          break;
        }
      }
      this.ops.push(op);
    }
    // Drain any remaining operators onto the output.
    while (this.ops.length > 0) {
      this.output.push(this.ops.pop()!);
    }
    return this.output;
  }

  // Evaluate an RPN token stream (a string[]) to an int32_t result. Uses a
  // fresh local stack (does not touch `this.ops`).
  evalRpn(rpn: string[]): int32_t {
    const stack: int32_t[] = [];
    const count: int32_t = rpn.length;
    for (let i: int32_t = 0; i < count; i = i + 1) {
      const tok: string = rpn[i]!;
      // An operator pops two operands and pushes the result; a number pushes
      // its parsed value.
      if (tok === '+' || tok === '-' || tok === '*' || tok === '/') {
        // Guard against a malformed expression: need at least two operands.
        if (stack.length < 2) {
          return 0;
        }
        const b: int32_t = stack.pop()!;
        const a: int32_t = stack.pop()!;
        stack.push(applyOp(tok, b, a));
      } else {
        stack.push(parseIntSafe(tok));
      }
    }
    if (stack.length === 0) {
      return 0;
    }
    return stack[0]!;
  }

  // Render an RPN token stream as a single space-joined string. A class
  // method that interpolates a struct-field-free path (plain string elements)
  // into a template literal — re-confirms the snprintf-based concat path.
  renderRpn(rpn: string[]): string {
    let out: string = '';
    const count: int32_t = rpn.length;
    for (let i: int32_t = 0; i < count; i = i + 1) {
      if (i > 0) {
        out = out + ' ';
      }
      out = out + rpn[i]!;
    }
    return out;
  }
}

// Parse a decimal integer string to an int32_t. Wraps `parseInt` so the call
// site stays tidy. (SUPPORT_MATRIX §5.3: parseInt is supported.) We only ever
// feed it numeric chunks produced by the tokenizer, so no NaN-guard is needed.
function parseIntSafe(s: string): int32_t {
  return parseInt(s);
}

// Entry point.
function main(): void {
  const ev: Evaluator = new Evaluator();

  console.log(`source: ${SOURCE}`);

  const tokens: Token[] = tokenize(SOURCE);
  const rpn: string[] = ev.toRpn(tokens);

  console.log(`rpn:    ${ev.renderRpn(rpn)}`);

  const result: int32_t = ev.evalRpn(rpn);
  console.log(`result: ${result}`);

  console.log('done');
}

main();
