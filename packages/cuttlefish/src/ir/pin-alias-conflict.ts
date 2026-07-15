import type { Diagnostic } from '../types.js';
import type { BoardConstants } from './board-resolver.js';
import type { PeripheralUsage } from './peripheral-usage.js';
import { findBoardPinByName } from './board-pin-utils.js';

export function validatePinAliasConflicts(
  usage: PeripheralUsage,
  boardConstants: BoardConstants | undefined,
  filePath: string,
): Diagnostic[] {
  if (!boardConstants || usage.pinsUsed.size === 0) {
    return [];
  }

  const usedNamesByCanonicalPin = new Map<string, Set<string>>();

  for (const usedPinName of usage.pinsUsed) {
    const boardPin = findBoardPinByName(usedPinName, boardConstants);
    if (!boardPin) {
      continue;
    }

    const names = usedNamesByCanonicalPin.get(boardPin.name) ?? new Set<string>();
    names.add(usedPinName);
    usedNamesByCanonicalPin.set(boardPin.name, names);
  }

  const boardName = boardConstants.get('name');
  const boardLabel = typeof boardName === 'string' && boardName.length > 0
    ? ` on ${boardName}`
    : '';
  const diagnostics: Diagnostic[] = [];

  for (const [canonicalPinName, usedNames] of usedNamesByCanonicalPin) {
    if (usedNames.size < 2) {
      continue;
    }

    const orderedNames = [canonicalPinName, ...Array.from(usedNames).filter(name => name !== canonicalPinName).sort()];
    diagnostics.push({
      severity: 'warning',
      code: 'pin-alias-conflict',
      filePath,
      source: 'pin-alias-conflict',
      message: `Pin '${canonicalPinName}' is referenced through multiple names${boardLabel}: ${orderedNames.join(', ')}. These names refer to the same physical pin. Pick one name to keep pin usage and diagnostics unambiguous.`,
    });
  }

  return diagnostics;
}