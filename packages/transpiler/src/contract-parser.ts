import fs from 'node:fs';
import path from 'node:path';

export interface ContractPin {
  pinName: string;
  pinType: string;
  net: string;
}

export interface ContractData {
  mcu: {
    symbol: string;
  };
  connectedPins: Record<string, ContractPin>;
}

/**
 * Parses a TypeCAD contract file and extracts connected pins.
 */
export function parseContractFile(contractPath: string): ContractData {
  const content = fs.readFileSync(contractPath, 'utf-8');
  return JSON.parse(content) as ContractData;
}

/**
 * Matches contract pin names to canonical MCU pin names.
 * Returns a list of matched MCU pin names (e.g., ['PB5', 'PC4']).
 */
export function matchConnectedPins(contract: ContractData, mcuPinNames: string[]): string[] {
  const connectedMcuPins: string[] = [];
  
  for (const pinInfo of Object.values(contract.connectedPins)) {
    const contractPinName = pinInfo.pinName;
    
    // Try to find a match in the MCU's pin list.
    // We look for the MCU pin name as a substring in the contract pin name.
    // For example, "XTAL1/PB6" contains "PB6".
    for (const mcuPin of mcuPinNames) {
      // Use word boundaries or simple inclusion check? 
      // Compound names usually use / or - or are prefixed.
      // We'll check if the mcuPin name is present in the contract pin name.
      if (contractPinName.includes(mcuPin)) {
        connectedMcuPins.push(mcuPin);
        break; // Found the match for this contract pin
      }
    }
  }
  
  return Array.from(new Set(connectedMcuPins)); // Unique pins
}
