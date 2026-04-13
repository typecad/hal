import type { BoardConstants } from './board-resolver';

export interface BoardPinInfo {
  number?: number;
  name: string;
  aliases: string[];
  warnings: string[];
  note?: string;
  alternateFunctions: string[];
}

function parseCsvField(value: string | number | boolean | undefined): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }

  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function getBoardPins(boardConstants: BoardConstants | undefined): BoardPinInfo[] {
  if (!boardConstants) {
    return [];
  }

  const pins: BoardPinInfo[] = [];

  for (const [key, value] of boardConstants) {
    if (!key.startsWith('pins.all.') || !key.endsWith('.name') || typeof value !== 'string') {
      continue;
    }

    const prefix = key.slice(0, -'.name'.length);
    const numberValue = boardConstants.get(`${prefix}.number`);
    const aliases = parseCsvField(boardConstants.get(`${prefix}.aliases`));
    const warnings = parseCsvField(boardConstants.get(`${prefix}.warnings`));
    const alternateFunctions = parseCsvField(boardConstants.get(`${prefix}.alternateFunctions`));
    const noteValue = boardConstants.get(`${prefix}.notes`);

    pins.push({
      number: typeof numberValue === 'number' ? numberValue : undefined,
      name: value,
      aliases,
      warnings,
      note: typeof noteValue === 'string' && noteValue.length > 0 ? noteValue : undefined,
      alternateFunctions,
    });
  }

  return pins.sort((left, right) => {
    const leftNumber = left.number ?? Number.MAX_SAFE_INTEGER;
    const rightNumber = right.number ?? Number.MAX_SAFE_INTEGER;
    return leftNumber - rightNumber || left.name.localeCompare(right.name);
  });
}

export function findBoardPinByName(
  pinName: string,
  boardConstants: BoardConstants | undefined,
): BoardPinInfo | undefined {
  return getBoardPins(boardConstants).find(pin => pin.name === pinName || pin.aliases.includes(pinName));
}

export function formatPinReference(usedPinName: string, boardPin: BoardPinInfo | undefined): string {
  if (!boardPin || usedPinName === boardPin.name) {
    return `Pin '${usedPinName}'`;
  }

  return `Pin '${usedPinName}' (alias of ${boardPin.name})`;
}