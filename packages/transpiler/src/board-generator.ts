import fs from 'node:fs';
import path from 'node:path';

/**
 * Generates a local board package file that either forwards to a board package
 * or re-exports specific pins from an MCU package based on a contract.
 */
export function generateBoardFile(
  outDir: string,
  mcuOrBoardPackage: string,
  connectedPins?: string[],
  peripherals: string[] = []
): string {
  const boardDir = path.join(outDir, '.typehal');
  if (!fs.existsSync(boardDir)) {
    fs.mkdirSync(boardDir, { recursive: true });
  }

  const outPath = path.join(boardDir, 'board.ts');
  let content = "";

  if (connectedPins) {
    // Narrowed board from contract
    const peripheralExports = peripherals.length > 0
      ? `\n// Re-export peripherals from MCU package\nexport {\n  ${peripherals.join(',\n  ')}\n} from '${mcuOrBoardPackage}';\n`
      : "";

    content = [
      "// ---------------------------------------------------------------------------",
      "// .typehal/board.ts — Dynamically generated narrowed board package",
      "// ---------------------------------------------------------------------------",
      "",
      "export {",
      "  HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP,",
      "  delay, millis, micros, delayMicroseconds,",
      "  map, constrain,",
      "  abs, min, max, Num,",
      "  pulseIn, pulseInLong, Pulse,",
      "  shiftIn, shiftOut, Shift,",
      "  randomSeed, random, Random,",
      "  noInterrupts, interrupts, attachInterrupt, detachInterrupt,",
      "  ADC, AsyncClass, Async",
      "} from '@typehal/hal';",
      "",
      "// Re-export ONLY connected pins from MCU package",
      "export {",
      `  ${connectedPins.join(',\n  ')}`,
      `} from '${mcuOrBoardPackage}';`,
      peripheralExports,
      "",
    ].join("\n");
  } else {
    // Forwarding to a full board package (or MCU package)
    content = [
      "// ---------------------------------------------------------------------------",
      "// .typehal/board.ts — Dynamically generated forwarding board package",
      "// ---------------------------------------------------------------------------",
      "",
      `export * from '${mcuOrBoardPackage}';`,
      "",
    ].join("\n");
  }

  fs.writeFileSync(outPath, content, 'utf-8');
  return outPath;
}
