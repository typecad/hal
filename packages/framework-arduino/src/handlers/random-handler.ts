// ---------------------------------------------------------------------------
// Random namespace handler — maps TypeHAL Random.* calls to Arduino C++
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typehal/core/shared';

/**
 * Render Random namespace calls to Arduino C++.
 *
 * - Random.seed(value)        → randomSeed(value)
 * - Random.seedWith(value)    → randomSeed(value)
 * - Random.next(max)          → random(max)
 * - Random.next(min, max)     → random(min, max)
 * - Random.between(min, max)  → random(min, max)
 * - Random.upTo(max)          → random(max)
 * - Random.int()              → random()
 */
export function renderRandomCall(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  if (parts.length !== 2) return undefined;
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  switch (parts[1]) {
    case 'seed':
    case 'seedWith':
      return `randomSeed(${a(0)})`;
    case 'next':
      return args.length > 1 ? `random(${a(0)}, ${a(1)})` : `random(${a(0)})`;
    case 'between':
      return `random(${a(0)}, ${a(1)})`;
    case 'upTo':
      return `random(${a(0)})`;
    case 'int':
      return `random()`;
  }

  return undefined;
}
