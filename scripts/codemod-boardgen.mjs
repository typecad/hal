// One-shot codemod: split generateBoard into buildModule + thin wrapper and
// append parsePinName + generateBoardModuleFromContract. Deleted after use.
import fs from 'node:fs';

const file = 'packages/framework-zephyr/src/boardgen.ts';
let s = fs.readFileSync(file, 'utf8');

const headOld = `export function generateBoard(target: string): GeneratedBoard {
  const entry = findBoardData(target);
  if (!entry) {
    const hint = loadBoardCatalogOverlay()
      ? \`'\${target}' is not a board target in the current catalog. \` +
        \`It may be new in your Zephyr tree — run 'typecad-hal board sync' and retry.\`
      : \`No board catalog on this machine. Run 'typecad-hal board sync' first.\`;
    throw new Error(hint);
  }
`;
const headNew = `function buildModule(entry: BoardDataEntry): GeneratedBoard {
`;
if (!s.includes(headOld)) { console.error('HEAD ANCHOR MISS'); process.exit(1); }
s = s.replace(headOld, headNew);

const tail = `  return {
    boardTs: ts.join('\\n'),
    boardJson: JSON.stringify(manifest, null, 1),
    board: entry,
  };
}`;
const j = s.indexOf(tail);
if (j === -1) { console.error('TAIL ANCHOR MISS'); process.exit(1); }

const addition = tail + `

/**
 * Generate the board module contents for a qualified Zephyr board target
 * ('esp32s3_devkitc/esp32s3/procpu'). Bare SoC names are not targets —
 * every board resolves through the catalog like any other.
 */
export function generateBoard(target: string): GeneratedBoard {
  const entry = findBoardData(target);
  if (!entry) {
    const hint = loadBoardCatalogOverlay()
      ? \`'\${target}' is not a board target in the current catalog. \` +
        \`It may be new in your Zephyr tree — run 'typecad-hal board sync' and retry.\`
      : \`No board catalog on this machine. Run 'typecad-hal board sync' first.\`;
    throw new Error(hint);
  }
  return buildModule(entry);
}

/**
 * Parse a datasheet pin name into (controller nodelabel, controller-relative
 * bit) per the soc's naming family — the inverse of the sweep naming:
 *   nRF      P0.28 / P0_28 → gpio0.28
 *   RP2040   GP25          → gpio0.25
 *   ESP32    GPIO9         → gpio0.9 (GPIO32+ → gpio1.x)
 *   letters  PA5 / PB6     → gpioa.5 / gpiob.6
 *   flat     GPIO9 (non-esp32 socs, single flat controller) → gpio.9
 */
export function parsePinName(soc: string, name: string): { controller: string; pin: number } | undefined {
  const conv = namingConvFor(soc);
  const n = name.trim().toUpperCase();
  let m = n.match(/^P(\\d)\\.(\\d{1,2})$/);
  if (conv === 'nrf-port' && m) return { controller: \`gpio\${m[1]}\`, pin: Number(m[2]) };
  m = n.match(/^GP(\\d{1,2})$/);
  if (conv === 'rp-gpio' && m) return { controller: 'gpio0', pin: Number(m[1]) };
  m = n.match(/^GPIO(\\d{1,2})$/);
  if (m) {
    const num = Number(m[1]);
    if (conv === 'esp32-gpio') return { controller: num < 32 ? 'gpio0' : 'gpio1', pin: num < 32 ? num : num - 32 };
    return { controller: 'gpio', pin: num };
  }
  m = n.match(/^P([A-Pa-p])(\\d{1,2})$/);
  if (m) return { controller: \`gpio\${m[1].toLowerCase()}\`, pin: Number(m[2]) };
  return undefined;
}

/**
 * Generate the board module for a CONTRACT board — a custom PCB with no
 * Zephyr board record. The contract (exported from a TypeCAD project)
 * supplies the wired pads by datasheet name and which bus families the PCB
 * routes; the SoC's bus controller nodelabels come from the INSTALLED
 * Zephyr tree's soc dtsi (the SDK is the source of truth — a contract build
 * compiles against that tree).
 *
 * Returns a full board module (the transpiler's pin map + chip resolution
 * read board.json). The caller layers the narrowed board.ts on top, so the
 * firmware can only touch pads the PCB actually wired.
 */
export function generateBoardModuleFromContract(opts: {
  soc: string;
  zephyrBase: string;
  /** Wired pad names in the soc's datasheet form (PA5, P0.28, GP25...). */
  pinNames: readonly string[];
  /** Which bus families the PCB routes. */
  peripherals: { i2c: boolean; spi: boolean; uart: boolean };
}): { boardTs: string; boardJson: string } {
  const pads: { name: string; controller: string; pin: number }[] = [];
  for (const name of opts.pinNames) {
    const parsed = parsePinName(opts.soc, name);
    if (!parsed) {
      console.error(\`contract: pad '\${name}' does not match \${opts.soc} naming conventions — skipped\`);
      continue;
    }
    pads.push({ name, controller: parsed.controller, pin: parsed.pin });
  }
  if (pads.length === 0) {
    throw new Error(
      \`None of the contract's pads (\${opts.pinNames.join(', ')}) match \${opts.soc} naming \` +
      \`conventions — name them by their datasheet form (PA5, P0.28, GP25, GPIO9).\`,
    );
  }

  // SoC bus labels from the installed tree, gated to the wired families.
  const treeBuses = socBusLabelsFromTree(opts.zephyrBase, opts.soc);
  const buses = {
    i2c: opts.peripherals.i2c ? treeBuses.i2c : [],
    spi: opts.peripherals.spi ? treeBuses.spi : [],
    uart: opts.peripherals.uart ? treeBuses.uart : [],
  };

  // Synthetic catalog record shaped like a walker record, routed through the
  // SAME module builder as every board: the wired pads ride in as a
  // 'contract' connector (labels = datasheet names), and deriveControllers
  // builds the controller table from them like it does for any board.
  const entry = {
    identifier: \`contract/\${opts.soc}\`,
    name: \`\${opts.soc} custom board (contract)\`,
    vendor: 'typecad',
    dts: '',
    buses: Object.values(buses).some((b) => b.length > 0) ? buses : undefined,
    connectors: pads.length > 0
      ? [{
          nodelabel: 'contract',
          compatible: 'typecad,contract',
          pins: Object.fromEntries(
            pads.map((p) => [p.name, { controller: p.controller, pin: p.pin, flags: [] as string[] }]),
          ),
        }]
      : undefined,
  };

  return buildModule(entry as BoardDataEntry);
}`;

s = s.slice(0, j) + addition + s.slice(j + tail.length);

// imports: socBusLabelsFromTree comes from the cuttlefish module now
s = s.replace(
  "import {\n  loadBoardCatalogOverlay,\n  GENERATOR_REV,\n  overlayPathFor,\n  boardRecordFingerprint,\n  findBoardInCatalog,\n} from '@typecad/cuttlefish/board-catalog';",
  "import {\n  loadBoardCatalogOverlay,\n  GENERATOR_REV,\n  overlayPathFor,\n  boardRecordFingerprint,\n  findBoardInCatalog,\n  socBusLabelsFromTree,\n} from '@typecad/cuttlefish/board-catalog';",
);
// if that import block doesn't exist yet (older import shape), handle single-line form
if (!s.includes('socBusLabelsFromTree') || !s.includes("from '@typecad/cuttlefish/board-catalog';")) {
  s = s.replace(
    "import { loadBoardCatalogOverlay, GENERATOR_REV, overlayPathFor, boardRecordFingerprint, findBoardInCatalog } from './sdk/board-catalog-sync.js';",
    "import {\n  loadBoardCatalogOverlay,\n  GENERATOR_REV,\n  overlayPathFor,\n  boardRecordFingerprint,\n  findBoardInCatalog,\n  socBusLabelsFromTree,\n} from '@typecad/cuttlefish/board-catalog';",
  );
}

// stamp: overlay-optional (contract boards have no overlay)
s = s.replace(
  "fingerprint: boardRecordFingerprint(entry, loadBoardCatalogOverlay()!),",
  "fingerprint: boardRecordFingerprint(entry, loadBoardCatalogOverlay()),",
);

fs.writeFileSync(file, s);
console.log('codemod applied');
