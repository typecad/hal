// ---------------------------------------------------------------------------
// Contract module barrel — entry point for contract-based board generation.
//
// Exports the parser, the board generator, and the `generateContractBoard`
// orchestrator that the CLI calls when `config.contract` is set. The env.d.ts
// emitted by config-loader.ts points `@typecad/hal` at `./board.js`, and this
// module is what writes that file.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { ResolvedTypecadConfig } from '../config-loader.js';
import { locateZephyrBaseCheap } from '../board-catalog/index.js';
import { parseContractFile, matchConnectedPins, selectPeripherals, contractPinNames, contractPads } from './contract-parser.js';
import { generateBoardFile } from './board-generator.js';

export type {
  HwContract,
  ContractPin,
  ContractComponent,
  AvailablePeripherals,
} from './contract-parser.js';
export { parseContractFile, matchConnectedPins, selectPeripherals, contractPinNames, contractPads } from './contract-parser.js';
export { generateBoardFile, CUTTLEFISH_DIR } from './board-generator.js';
export type { GenerateBoardOptions } from './board-generator.js';

/** The framework surface contract generation needs. */
interface BoardGenStrategy {
  generateBoardModule?(target: string): { boardTs: string; boardJson: string } | undefined;
  generateContractBoardModule?(opts: {
    soc: string;
    zephyrBase: string;
    pinNames: readonly string[];
    padAliases?: readonly { exportName: string; padName: string }[];
    peripherals: { i2c: boolean; spi: boolean; uart: boolean };
  }): { boardTs: string; boardJson: string };
}

interface TypeCADManifest {
  pinNames: readonly string[];
  peripheralNames: readonly string[];
}

/**
 * Orchestrates contract-based board generation for a resolved config:
 *   1. Reads the contract file at `config.contract` (resolved relative to the
 *      project root, i.e. the dir containing typecad-hal.config.ts).
 *   2. Dynamically imports the MCU package's `TypeCADManifest` to discover the
 *      canonical pin and peripheral names.
 *   3. Matches contract pins → MCU pin names and selects peripherals.
 *   4. Writes the narrowed `.typecad-hal/board.ts`.
 *
 * This is the step that re-opens the typecad.net → cuttlefish interop. After it
 * runs, the existing `export * from './board.js'` in typecad-hal-env.d.ts
 * resolves to a board exposing only the pins the actual PCB has wired.
 *
 * @throws on a missing/unreadable/unparseable contract, an unsupported version,
 *   or if the MCU package can't be loaded for its manifest.
 */
export async function generateContractBoard(config: ResolvedTypecadConfig): Promise<string> {
  if (!config.contract) {
    throw new Error('generateContractBoard called without config.contract');
  }
  if (!config.soc && !config.buildTarget) {
    throw new Error(
      `A 'contract' config requires a 'soc' (Zephyr SoC name) to narrow against. ` +
        `Add e.g. soc: 'stm32f411xe' to typecad-hal.config.ts.`,
    );
  }

  const projectDir = path.dirname(config.configPath);
  const contractPath = path.isAbsolute(config.contract)
    ? config.contract
    : path.resolve(projectDir, config.contract);

  // (1) Parse the contract.
  const contract = parseContractFile(contractPath);

  // (2) SDK-as-truth: the SoC's bus controller labels come from the
  // INSTALLED Zephyr tree's soc dtsi (located via the same fs-only
  // discovery the catalog uses), and the wired pads come from the contract
  // itself. The framework runs them through the same board-module builder
  // every catalog board uses.
  const soc = config.soc ?? path.basename(config.buildTarget ?? '').split('/')[0];
  if (!soc) {
    throw new Error(
      "Contract-based projects need a `soc:` (Zephyr SoC name, e.g. 'stm32f411xe') " +
      "in typecad-hal.config.ts to select the silicon the contract narrows.",
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
  if (!strategy?.generateContractBoardModule) {
    throw new Error(
      `Framework '${config.framework}' provides no contract board generation. ` +
      `Zephyr contract projects require '@typecad/framework-zephyr' (which derives the ` +
      `soc's bus controllers from the installed Zephyr tree).`,
    );
  }
  const zephyrBase = locateZephyrBaseCheap();
  if (!zephyrBase) {
    throw new Error(
      `No Zephyr tree found for the contract build. The SoC's bus controllers are derived ` +
      `from the installed Zephyr tree — install one via '@typecad/framework-zephyr' ` +
      `(zephyr-installer) or set ZEPHYR_BASE.`,
    );
  }
  const generated = strategy.generateContractBoardModule!({
    soc,
    zephyrBase,
    // The contract's own canonical pad names (boardName when typecad.net
    // carried a mapping, else the KiCAD pin-name segment that matches the
    // soc's datasheet form).
    pinNames: contractPads(contract).map((p) => p.mcuName),
    padAliases: contractPads(contract)
      .filter((p) => p.alias)
      .map((p) => ({ exportName: p.alias as string, padName: p.mcuName })),
    peripherals: contract.availablePeripherals,
  });
  // (3) The narrowed pad set: the contract's own canonical names — the
  // board module the framework generated exposes the soc's datasheet sweep
  // for the wired controllers; board.ts narrows the user surface to the
  // pads the PCB actually wired (an unwired pin is a compile error).
  const connectedPins = contractPinNames(contract);
  const peripherals = [
    contract.availablePeripherals.i2c ? 'I2C0' : '',
    contract.availablePeripherals.spi ? 'SPI0' : '',
    contract.availablePeripherals.uart ? 'UART0' : '',
  ].filter(Boolean);

  // (4) Emit the soc's full board.json — the transpiler's pin map and chip
  // resolution read it (same artifact a board-target project carries).
  const cuttlefishDir = path.join(projectDir, '.typecad-hal');
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
