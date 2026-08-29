// ---------------------------------------------------------------------------
// Contract module barrel — entry point for contract-based board generation.
//
// Exports the parser, the board generator, and the `generateContractBoard`
// orchestrator that the CLI calls when `config.contract` is set. The env.d.ts
// emitted by config-loader.ts points `@typecad/board` at `./board.js`, and this
// module is what writes that file.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
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

/** The manifest shape the framework's generated board module exports. */
interface BoardGenStrategy {
  generateBoardModule?(target: string): { boardTs: string; boardJson: string } | undefined;
}

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
  if (!config.soc && !config.buildTarget) {
    throw new Error(
      `A 'contract' config requires a 'soc' (Zephyr SoC name) to narrow against. ` +
        `Add e.g. soc: 'stm32f411xe' to cuttlefish.config.ts.`,
    );
  }

  const projectDir = path.dirname(config.configPath);
  const contractPath = path.isAbsolute(config.contract)
    ? config.contract
    : path.resolve(projectDir, config.contract);

  // (1) Parse the contract.
  const contract = parseContractFile(contractPath);

  // (2) Generate the soc's full board data through the framework's board
  // generator — the pinNames + peripheral instance names come from the
  // curated soc descriptor (joined with the board data pack), never from a
  // package.
  const soc = config.soc ?? path.basename(config.buildTarget ?? '').split('/')[0];
  if (!soc) {
    throw new Error(
      "Contract-based projects need a `soc:` (Zephyr SoC name, e.g. 'stm32f411xe') " +
      "in cuttlefish.config.ts to select the silicon the contract narrows.",
    );
  }
  if (!config.framework) {
    throw new Error("Contract-based projects need a `framework:` package to generate the board data.");
  }
  // ESM-safe: the framework packages are "type": "module" — resolve through
  // createRequire anchored at the project's package.json.
  let strategy: BoardGenStrategy | undefined;
  try {
    const projectRequire = createRequire(path.join(projectDir, 'package.json'));
    const mod = projectRequire(projectRequire.resolve(config.framework)) as {
      ZephyrStrategy?: new () => BoardGenStrategy;
      default?: unknown;
    };
    const Ctor = mod.ZephyrStrategy ?? (mod.default as (new () => BoardGenStrategy) | undefined);
    strategy = typeof Ctor === 'function' ? new Ctor() : undefined;
  } catch {
    strategy = undefined;
  }
  const generated = strategy?.generateBoardModule?.(soc);
  if (!generated) {
    throw new Error(
      `Framework '${config.framework}' cannot generate board data for soc '${soc}'. ` +
      `The soc name must match a curated descriptor (see the framework's soc registry).`,
    );
  }
  const manifest = JSON.parse(generated.boardJson) as TypeCADManifest & {
    peripherals?: { i2c?: { count?: number }; spi?: { count?: number }; uart?: { count?: number } };
  };
  const peripheralNames: string[] = [];
  for (let i = 0; i < (manifest.peripherals?.i2c?.count ?? 0); i++) peripheralNames.push(`I2C${i}`);
  for (let i = 0; i < (manifest.peripherals?.spi?.count ?? 0); i++) peripheralNames.push(`SPI${i}`);
  for (let i = 0; i < (manifest.peripherals?.uart?.count ?? 0); i++) peripheralNames.push(`UART${i}`);

  // (3) Match + select.
  const connectedPins = matchConnectedPins(contract, manifest.pinNames);
  const peripherals = selectPeripherals(contract, peripheralNames);

  // (4) Emit the soc's full board.json — the transpiler's pin map and chip
  // resolution read it (same artifact a board-target project carries).
  const cuttlefishDir = path.join(projectDir, '.cuttlefish');
  fs.mkdirSync(cuttlefishDir, { recursive: true });
  fs.writeFileSync(path.join(cuttlefishDir, 'board.json'), generated.boardJson, 'utf-8');

  // (5) Emit the narrowed board.
  return generateBoardFile({
    projectDir,
    soc,
    connectedPins,
    peripherals,
  });
}
