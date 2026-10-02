// ---------------------------------------------------------------------------
// report.ts — the gallery's one print seam.
//
// Every pattern module reports its computed values through report(line),
// which lowers to __tc_println over the board's UART0 console. Keeping a
// single seam means the same sources run unchanged in the differential
// harness (this file is the only target-specific module in the gallery).
// ---------------------------------------------------------------------------

import { UART0 } from '@typecad/hal';

export function report(line: string): void {
  UART0.writeLine(line);
}
