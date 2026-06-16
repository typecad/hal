// ---------------------------------------------------------------------------
// main.ts — Cipher codec driver.
//
// SUPPORT_MATRIX tour for Demo #12 (untested slice):
//   §3.5  forEach as a statement
//   §5.3  Math-method comparator via .sort
//   §4.7  enum inside class (static constants)
//   §2.2  while(true) with break
//   §2.5  standalone block
//   §2.4  variable in case expression
//   §1.3  int return promoted to double
//   §1.7  NonNullable<T>
//   §1.5  new Float32Array(n) zero-init
//   §3.1  export default function
//   §6.1  top-level statements → main()
// ---------------------------------------------------------------------------

import { Codec, sortAscending, fillBuffer, encodeChar, SafeNum } from './models/Codec';

// §4.7 — class with static constants.
const codec = new Codec('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
console.log(`ascii_a=${Codec.ASCII_A} ascii_z=${Codec.ASCII_Z}`);

// §3.5 — forEach as a statement.
const sum = codec.checksum([10, 20, 30]);
console.log(`checksum=${sum}`);

// §5.3 — sort with a comparator. NOTE: the sort produces wrong order (the
// comparator isn't invoked correctly — Finding E). Documented.
const sorted = sortAscending([5, 3, 8, 1, 9]);
console.log(`sorted_0=${sorted[0]}`);

// §2.2 — while(true) with break.
const found = codec.findAbove([1, 3, 5, 7, 9], 4);
console.log(`found=${found}`);

// §2.5 — standalone block.
console.log(`scoped=${codec.scopedCompute(7)}`);

// §2.4 — variable in case expression.
console.log(`classify_short=${codec.classifyByLen('hi')}`);
console.log(`classify_long=${codec.classifyByLen('abcdefghijklmnopqrstuvwxyz')}`);

// §1.3 — int return promoted to double.
console.log(`avg=${codec.averageRounded(3, 8)}`);

// §1.5 — new Float32Array(n) zero-init. NOTE: a top-level typed-array local
// gets an `extern float*` in the header but a `float[]` definition (pointer-
// vs-array mismatch). Wrap in a function to keep it local.
function testBuffer(): void {
  let buf: Float32Array = new Float32Array(8);
  fillBuffer(buf, 8, 1.5);
  console.log(`buffer_0=${buf[0]}`);
}
testBuffer();

// §3.1 — named export. NOTE: `export default function name()` + `import name from`
// — the default export's FunctionExpression isn't processed by the function
// builder (only standalone FunctionDeclarations are). Use a named export.
const idx = encodeChar('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'D');
console.log(`encode_D=${idx}`);

// §1.7 — NonNullable<T> (type-only; used as an annotation).
const safe: SafeNum = 42;
console.log(`safe=${safe}`);

console.log(`done: checksum=${sum} found=${found} sorted_0=${sorted[0]}`);
