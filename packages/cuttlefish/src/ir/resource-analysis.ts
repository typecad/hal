
import { ProgramIR, PlatformStrategy, Diagnostic } from "../api/index.js";
import { BoardConstants } from "./board-resolver.js";
import { PeripheralUsage } from "./peripheral-usage.js";
import { findBoardPinByName, formatPinReference, getBoardPins } from './board-pin-utils.js';
import type { PeripheralFunction } from '../api/schema/index.js';

export interface ResourceUsage {
  pins: Map<string, { source: string; peripheral?: string }>;
  peripherals: Map<string, { source: string; instance: number }>;
}

/**
 * Unified hardware resource conflict analysis.
 * Detects:
 * 1. Pin Multiplexing Conflicts: Same pin used for GPIO and a Peripheral (I2C, SPI, UART).
 * 2. Peripheral Instance Conflicts: Multiple peripherals sharing the same pins.
 * 3. Board-Specific Hardware Warnings: Logic for specific pins (e.g. "Pin 13 has a built-in LED").
 */
export function analyzeResources(program: ProgramIR, strategy: PlatformStrategy): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const usage = (program.peripheralUsage as PeripheralUsage);
  const board = program.boardConstants;

  if (!usage || !board) return diagnostics;

  // 1. Build Peripheral Pin Map from board definitions
  const pinMap = buildPeripheralPinMap(board);

  // 2. Track reported conflicts to avoid noise
  const reported = new Set<string>();

  // 3. Check for GPIO vs Peripheral conflicts
  for (const [pinName, functions] of pinMap) {
    const boardPin = findBoardPinByName(pinName, board);
    const pinNumber = boardPin?.number;
    
    // Check if pin is used as GPIO
    const isGpio = isPinUsedAsGpio(pinName, pinNumber, usage);

    for (const func of functions) {
      const isActive = isPeripheralActive(func.type as any, func.instance, usage);
      if (isActive && isGpio && func.role !== 'cs') {
        const peripheralName = getPeripheralName(func.type as any, func.instance);
        const conflictKey = `gpio:${pinName}:${peripheralName}`;
        
        if (!reported.has(conflictKey)) {
          reported.add(conflictKey);
          const pinRef = formatPinReference(pinName, boardPin);
          const suggestion = generateActionableSuggestion(pinName, peripheralName, func.role, board);
          
          diagnostics.push({
            severity: 'warning',
            message: `${pinRef} is configured as ${peripheralName} ${func.role.toUpperCase()}. Using it as GPIO may interfere with communication.\n   → ${suggestion}`,
            filePath: program.fileName,
            code: 'peripheral-pin-conflict',
            source: 'resource-analysis',
          });
        }
      }
    }
  }

  // 4. Check for Peripheral vs Peripheral conflicts (e.g. I2C0 and SPI0 sharing pins - rare but possible on some boards)
  // This is partially covered by the board-definition logic, but we can detect it here if two active
  // peripherals use the same canonical pin name.
  const activePinsToPeripheral = new Map<string, string>();
  for (const [pinName, functions] of pinMap) {
    for (const func of functions) {
      if (isPeripheralActive(func.type as any, func.instance, usage)) {
        const peripheralName = getPeripheralName(func.type as any, func.instance);
        if (activePinsToPeripheral.has(pinName) && activePinsToPeripheral.get(pinName) !== peripheralName) {
          const other = activePinsToPeripheral.get(pinName)!;
          const conflictKey = `ppp:${pinName}:${peripheralName}:${other}`;
          if (!reported.has(conflictKey)) {
            reported.add(conflictKey);
            diagnostics.push({
              severity: 'error',
              message: `Hardware Conflict: Pin '${pinName}' is required by both ${peripheralName} and ${other}.`,
              hint: `Move one of the peripherals to different pins if your board supports remapping, or avoid using both simultaneously.`,
              filePath: program.fileName,
              code: 'peripheral-peripheral-conflict',
              source: 'resource-analysis',
            });
          }
        }
        activePinsToPeripheral.set(pinName, peripheralName);
      }
    }
  }

  return diagnostics;
}

/**
 * Build a peripheral pin map from board constants.
 */
function buildPeripheralPinMap(boardConstants: BoardConstants): Map<string, PeripheralFunction[]> {
  const map = new Map<string, PeripheralFunction[]>();
  const boardPins = getBoardPins(boardConstants);
  const pinsByCanonicalName = new Map(boardPins.map(pin => [pin.name, pin]));

  function addPin(pinName: string, func: PeripheralFunction) {
    const boardPin = pinsByCanonicalName.get(pinName);
    const pinNames = boardPin ? [boardPin.name, ...boardPin.aliases] : [pinName];

    for (const resolvedPinName of pinNames) {
      const existing = map.get(resolvedPinName) ?? [];
      existing.push(func);
      map.set(resolvedPinName, existing);
    }
  }

  // Helper to parse "0:sda=A4,scl=A5;1:sda=...,scl=..."
  const parseBusData = (data: any, type: any) => {
    if (typeof data !== 'string' || data.length === 0) return;
    for (const busStr of data.split(';')) {
      const colonIdx = busStr.indexOf(':');
      if (colonIdx === -1) continue;
      const instance = parseInt(busStr.slice(0, colonIdx), 10);
      const pinsStr = busStr.slice(colonIdx + 1);
      for (const pair of pinsStr.split(',')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const role = pair.slice(0, eqIdx).trim();
        const pinName = pair.slice(eqIdx + 1).trim();
        if (pinName) addPin(pinName, { type, instance, role });
      }
    }
  };

  parseBusData(boardConstants.get('pins.i2c'), 'i2c');
  parseBusData(boardConstants.get('pins.spi'), 'spi');
  parseBusData(boardConstants.get('pins.uart'), 'uart');

  return map;
}

function isPinUsedAsGpio(pinName: string, pinNumber: number | undefined, usage: PeripheralUsage): boolean {
  if (usage.pinsUsed.has(pinName)) return true;
  if (pinNumber !== undefined) {
    if (usage.outputPins.has(pinNumber) || usage.inputPins.has(pinNumber) ||
        usage.inputPullupPins.has(pinNumber) || usage.inputPulldownPins.has(pinNumber)) {
      return true;
    }
  }
  return false;
}

function isPeripheralActive(type: 'i2c' | 'spi' | 'uart', instance: number, usage: PeripheralUsage): boolean {
  // When the program's ops identify WHICH controller instances are used, only
  // those instances claim pins. The old `usage.i2c || ...` disjunct claimed
  // every instance's pins whenever the bus type appeared at all — on boards
  // whose alternate-bus pin sets overlap another bus's (the blackpill's
  // i2c-alt on PB3/PB4 shares pins with spi2), that manufactured phantom
  // peripheral-peripheral conflicts. The bare-type fallback only applies when
  // NO instance information was recorded (degenerate programs whose ops carry
  // no instance), preserving the conservative claim where it's the only
  // signal available.
  switch (type) {
    case 'i2c':
      return usage.i2cInstancesUsed.size > 0 ? usage.i2cInstancesUsed.has(instance) : usage.i2c;
    case 'spi':
      return usage.spiInstancesUsed.size > 0 ? usage.spiInstancesUsed.has(instance) : usage.spi;
    case 'uart':
      return usage.uartInstancesUsed.size > 0 ? usage.uartInstancesUsed.has(instance) : usage.uart;
    default: return false;
  }
}

function getPeripheralName(type: 'i2c' | 'spi' | 'uart', instance: number): string {
  switch (type) {
    case 'i2c': return `I2C${instance}`;
    case 'spi': return `SPI${instance}`;
    case 'uart': return instance === 0 ? 'Serial' : `Serial${instance}`;
    default: return 'Peripheral';
  }
}

function generateActionableSuggestion(pinName: string, peripheralName: string, role: string, board: BoardConstants): string {
  const roleUpper = role.toUpperCase();
  if (peripheralName.startsWith('Serial')) {
    return `Consider using a different pin for GPIO, or avoid calling ${peripheralName}.begin() if you need ${pinName} as GPIO.`;
  }
  if (roleUpper === 'SDA' || roleUpper === 'SCL') {
    return `I2C requires ${roleUpper} on ${pinName}. Avoid using this pin for GPIO while I2C is active.`;
  }
  if (roleUpper === 'MOSI' || roleUpper === 'MISO' || roleUpper === 'SCK') {
    return `SPI requires ${roleUpper} on ${pinName}. Use a different pin for GPIO, or avoid calling SPI.begin().`;
  }
  return `Avoid initializing ${peripheralName} if you need ${pinName} as GPIO.`;
}
