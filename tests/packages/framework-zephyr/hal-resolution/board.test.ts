import { describe, it, expect } from 'vitest';
import type { BoardConstants } from '@typecad/cuttlefish/api/shared';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { lowerHalOp } from '../../../../packages/framework-zephyr/src/lowering/index';
import { lowerBoard } from '../../../../packages/framework-zephyr/src/lowering/board';
import { setActiveChip } from '../../../../packages/framework-zephyr/src/chips/index';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

setActiveChip(XIAO_BLE);

// Board constant resolution on Zephyr mirrors framework-arduino: the lone HAL
// op (board.resolve) is constant-folded at IR-build time, and the real
// user-facing feature is Board.definition.<path> / Pins.definition.<path>
// property-access folding via ZephyrStrategy.renderBoardDefinitionAccess. These
// tests lock in both the folding contract and the lowerHalOp dead-letter.

/** A small board-constants map with one string + one numeric value. */
function sampleBoardConstants(): BoardConstants {
  return new Map<string, string | number | boolean>([
    ['peripherals.aliases.UART0', 'Serial'],
    ['pins.analogOffset', 14],
  ]);
}

describe('ZephyrStrategy.renderBoardDefinitionAccess (Board.definition.* folding)', () => {
  const strategy = new ZephyrStrategy();

  it('folds Board.definition.<known-string-key> to the literal value', () => {
    const bc = sampleBoardConstants();
    expect(
      strategy.renderBoardDefinitionAccess(['Board', 'definition', 'peripherals', 'aliases', 'UART0'], bc),
    ).toBe('Serial');
  });

  it('folds Pins.definition.<known-numeric-key> to the literal value', () => {
    const bc = sampleBoardConstants();
    expect(
      strategy.renderBoardDefinitionAccess(['Pins', 'definition', 'pins', 'analogOffset'], bc),
    ).toBe('14');
  });

  it('returns undefined for a path not in the board constants', () => {
    const bc = sampleBoardConstants();
    expect(
      strategy.renderBoardDefinitionAccess(['Board', 'definition', 'nope'], bc),
    ).toBeUndefined();
  });

  it('returns undefined when chain[0] is not Board/Pins', () => {
    const bc = sampleBoardConstants();
    expect(
      strategy.renderBoardDefinitionAccess(['Foo', 'definition', 'peripherals', 'aliases', 'UART0'], bc),
    ).toBeUndefined();
  });

  it('returns undefined when chain[1] is not "definition"', () => {
    const bc = sampleBoardConstants();
    expect(
      strategy.renderBoardDefinitionAccess(['Board', 'config', 'peripherals', 'aliases', 'UART0'], bc),
    ).toBeUndefined();
  });

  it('returns undefined for chains shorter than 3 segments', () => {
    const bc = sampleBoardConstants();
    expect(strategy.renderBoardDefinitionAccess(['Board'], bc)).toBeUndefined();
    expect(strategy.renderBoardDefinitionAccess(['Board', 'definition'], bc)).toBeUndefined();
  });

  it('returns undefined when no board constants are supplied', () => {
    // Mirrors the manifest validator's probe path (no program/board constants).
    expect(
      strategy.renderBoardDefinitionAccess(['Board', 'definition', 'peripherals', 'aliases', 'UART0']),
    ).toBeUndefined();
  });
});

describe('lowerHalOp dispatch — board.* is a registered known prefix', () => {
  it('routes board.resolve through lowerBoard (returns undefined dead-letter)', () => {
    // board.resolve is constant-folded upstream; the lowering is reached only
    // as a dead-letter. The dispatcher must recognize the prefix (so the op
    // is in the known-category list) and route it to lowerBoard.
    expect(
      lowerHalOp({ operation: 'board.resolve', path: 'peripherals.pwm.resolution' } as any),
    ).toBeUndefined();
  });
});

describe('lowerBoard — dead-letter for any board.* op', () => {
  it('returns undefined for board.resolve', () => {
    expect(
      lowerBoard({ operation: 'board.resolve', path: 'x' } as any),
    ).toBeUndefined();
  });
});
