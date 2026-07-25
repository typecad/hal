// ---------------------------------------------------------------------------
// Contract module barrel — entry point for contract-based board generation.
//
// Exports the parser, the board generator, and the `generateContractBoard`
// orchestrator that the CLI calls when `config.contract` is set. The env.d.ts
// emitted by config-loader.ts points `@typecad/board` at `./board.js`, and this
// module is what writes that file.
// ---------------------------------------------------------------------------

import path from 'node:path';
import type { ResolvedCuttlefishConfig } from '../config-loader.js';
import { parseContractFile, matchConnectedPins, selectPeripherals } from './contract-parser.js';
import { generateBoardFile } from './board-generator.js';

export type {
  HwContract,
  ContractPin,
  ContractComponent,
  AvailablePeripherals,
} from './contract-parser.js';
export { parseContractFile, matchConnectedPins, selectPeripherals } from './contract-parser.js';
export { generateBoardFile, CUTTLEFISH_DIR } from './board-generator.js';
export type { GenerateBoardOptions } from './board-generator.js';

/** The manifest shape every @typecad/mcu-* package exports. */
interface TypeCADManifest {
  pinNames: readonly string[];
  peripheralNames: readonly string[];
}

/**
 * Orchestrates contract-based board generation for a resolved config:
 *   1. Reads the contract file at `config.contract` (resolved relative to the
 *      project root, i.e. the dir containing cuttlefish.config.ts).
 *   2. Dynamically imports the MCU package's `TypeCADManifest` to discover the
 *      canonical pin and peripheral names.
 *   3. Matches contract pins → MCU pin names and selects peripherals.
 *   4. Writes the narrowed `.cuttlefish/board.ts`.
 *
 * This is the step that re-opens the typecad.net → cuttlefish interop. After it
 * runs, the existing `export * from './board.js'` in cuttlefish-env.d.ts
 * resolves to a board exposing only the pins the actual PCB has wired.
 *
 * @throws on a missing/unreadable/unparseable contract, an unsupported version,
 *   or if the MCU package can't be loaded for its manifest.
 */
export async function generateContractBoard(config: ResolvedCuttlefishConfig): Promise<string> {
  if (!config.contract) {
    throw new Error('generateContractBoard called without config.contract');
  }
  if (!config.mcu) {
    throw new Error(
      `A 'contract' config requires an 'mcu' package to narrow against. ` +
        `Add e.g. mcu: '@typecad/mcu-atmega328p' to cuttlefish.config.ts.`,
    );
  }

  const projectDir = path.dirname(config.configPath);
  const contractPath = path.isAbsolute(config.contract)
    ? config.contract
    : path.resolve(projectDir, config.contract);

  // (1) Parse the contract.
  const contract = parseContractFile(contractPath);

  // (2) Load the MCU manifest. The MCU package is a peer at runtime — import
  // it dynamically so cuttlefish doesn't hard-depend on any single MCU.
  let manifest: TypeCADManifest;
  try {
    const mod = (await import(config.mcu)) as { TypeCADManifest?: TypeCADManifest };
    if (!mod.TypeCADManifest) {
      throw new Error(`'${config.mcu}' does not export a TypeCADManifest.`);
    }
    manifest = mod.TypeCADManifest;
  } catch (err) {
    throw new Error(
      `Could not load TypeCADManifest from MCU package '${config.mcu}' for contract-based ` +
        `board generation: ${(err as Error).message}`,
    );
  }

  // (3) Match + select.
  const connectedPins = matchConnectedPins(contract, manifest.pinNames);
  const peripherals = selectPeripherals(contract, manifest.peripheralNames);

  // (4) Emit the narrowed board.
  return generateBoardFile({
    projectDir,
    mcuPackage: config.mcu,
    connectedPins,
    peripherals,
  });
}
