import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateBoardFile } from '../../../packages/transpiler/src/board-generator';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

describe('board-generator', () => {
  it('should generate a forwarding board file when no connected pins are provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typehal-bg-'));
    tempDirs.push(dir);

    const outPath = generateBoardFile(dir, '@typecad/board-arduino-uno');
    
    expect(outPath).toBe(path.join(dir, '.cuttlefish', 'board.ts'));
    expect(fs.existsSync(outPath)).toBe(true);

    const content = fs.readFileSync(outPath, 'utf-8');
    expect(content).toContain("export * from '@typecad/board-arduino-uno';");
    expect(content).toContain("Dynamically generated forwarding board package");
  });

  it('should generate a narrowed board file when connected pins are provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typehal-bg-'));
    tempDirs.push(dir);

    const connectedPins = ['PB5', 'PC4'];
    const outPath = generateBoardFile(dir, '@typecad/mcu-atmega328p', connectedPins);
    
    expect(outPath).toBe(path.join(dir, '.cuttlefish', 'board.ts'));
    expect(fs.existsSync(outPath)).toBe(true);

    const content = fs.readFileSync(outPath, 'utf-8');
    expect(content).toContain("Dynamically generated narrowed board package");
    
    // Should re-export core HAL functions
    expect(content).toContain("export {");
    expect(content).toContain("HIGH, LOW, INPUT");
    expect(content).toContain("} from '@typecad/hal';");

    // Should only export the narrowed pins from the MCU package
    expect(content).toContain("export {");
    expect(content).toContain("PB5,");
    expect(content).toContain("PC4");
    expect(content).toContain("} from '@typecad/mcu-atmega328p';");
  });
});
