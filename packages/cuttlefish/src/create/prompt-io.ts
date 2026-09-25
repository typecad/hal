// ---------------------------------------------------------------------------
// prompt-io.ts — EOF-safe stdin plumbing for the create wizard's prompts.
//
// `typecad-hal create` is not always run directly in a terminal — a parent
// tool (e.g. the pcb CLI's `typecad-pcb create`) spawns it as a child. When
// the parent hands the child a stdin pipe it never writes to, or an ignored
// stdin, a plain rl.question() waits forever and the wizard dead-ends at the
// board picker with no error. Every wizard prompt goes through ask() here,
// which rejects the moment stdin reaches EOF/close (or has already reached
// it), so the wizard can cancel with an actionable message instead of
// hanging. The board picker additionally falls back to a line-based search
// (see board-search.ts) so a parent that DOES forward stdin stays usable
// without raw-mode keypresses.
// ---------------------------------------------------------------------------

import * as readline from "node:readline/promises";
import { stdin } from "node:process";
import chalk from "chalk";

export type ReadlineInterface = ReturnType<typeof readline.createInterface>;

/** Raised when stdin dies under a pending (or yet-unasked) question. */
export class StdinClosedError extends Error {
  constructor() {
    super("stdin closed before an answer arrived");
    this.name = "StdinClosedError";
  }
}

// EOF latches: once stdin has ended, every later readline created over it is
// dead on arrival, but a fresh interface never re-fires 'close' for it — so
// the flag is what lets ask() reject immediately for those.
let stdinEnded = false;
const latchEnded = (): void => {
  stdinEnded = true;
};
stdin.once("end", latchEnded);
stdin.once("close", latchEnded);

export function stdinIsClosed(): boolean {
  return stdinEnded;
}

/** rl.question that rejects instead of hanging forever when stdin closes. */
export function ask(rl: ReadlineInterface, prompt: string): Promise<string> {
  if (stdinEnded) {
    return Promise.reject(new StdinClosedError());
  }
  return new Promise((resolve, reject) => {
    const onRlClose = (): void => reject(new StdinClosedError());
    rl.once("close", onRlClose);
    rl.question(prompt).then(
      (answer) => {
        rl.off("close", onRlClose);
        resolve(answer);
      },
      (err) => {
        rl.off("close", onRlClose);
        reject(err);
      },
    );
  });
}

/** The cancel message when there is no interactive stdin at all. */
export function printNonInteractiveCancel(): void {
  console.log(`  ${chalk.yellow("!")} No interactive input on stdin — this wizard was launched`);
  console.log(`    by another tool that did not hand over your terminal.`);
  console.log(`    Run 'typecad-hal create' directly in a terminal, or skip the prompts`);
  console.log(`    with flags: --board <catalog identifier> (e.g. --board`);
  console.log(`    esp32s3_devkit1/esp32s3), --framework, --probe, --port, --baud.`);
}
