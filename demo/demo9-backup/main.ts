// ---------------------------------------------------------------------------
// main.ts — Conduit message-pipeline driver.
//
// SUPPORT_MATRIX tour for Demo #9 (untested slice):
//   §3.4  returning a function, class method called directly
//   §1.8  T | null / T | undefined
//   §1.6  discriminated union of object literals → std::variant
//   §5.3  parseInt / parseFloat
//   §1.5  2D arrays T[][]
//   §2.5  labeled continue, empty statement, standalone block
//   §2.3  switch without default
//   §2.2  do...while
//   §6.1  top-level statements → main()
//   §6.2  multi-file local imports
// ---------------------------------------------------------------------------

import {
  makeScaler,
  makeThreshold,
  parseLen,
  parseVal,
  safeHead,
  orDefault,
  Stage,
  messageValue,
  Message,
} from './models/Pipeline';
import { buildGrid, sumPositive, countdown } from './models/Grid';

// §3.4 — returning a function.
const scaler = makeScaler(3);
console.log(`scale_5=${scaler(5)}`);

// §3.4 — predicate factory.
const above10 = makeThreshold(10);
console.log(`above10_15=${above10(15)}`);

// §3.4 — class method called directly.
const stage = new Stage(100);
console.log(`stage_apply=${stage.process(5)}`);

// §5.3 — parseInt / parseFloat.
console.log(`parse_len=${parseLen('42')}`);
console.log(`parse_val=${parseVal('3.14')}`);

// §1.8 — T | null / T | undefined.
const xs: int32_t[] = [7, 8, 9];
console.log(`safe_head=${safeHead(xs)}`);
console.log(`or_default=${orDefault(undefined)}`);

// §1.6 — message struct dispatch.
const msg: Message = { kind: 'text', text: 'hello', num: 0 };
console.log(`msg_value=${messageValue(msg)}`);

// §1.5 — 2D arrays + labeled continue.
const grid = buildGrid(3, 4, 1.5);
console.log(`grid_sum=${sumPositive(grid)}`);

// §2.2 — do...while.
console.log(`countdown=${countdown(5)}`);

console.log(`done: scale=${scaler(5)} grid=${grid.length}`);
