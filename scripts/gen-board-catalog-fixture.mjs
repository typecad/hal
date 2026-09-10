// ---------------------------------------------------------------------------
// gen-board-catalog-fixture.mjs — regenerate the checked-in test fixture
// overlay (tests/fixtures/board-catalog.overlay.json) from the machine's
// Zephyr tree, filtered to the board ids the test suites reference.
//
//   node scripts/gen-board-catalog-fixture.mjs [zephyr-base]
//
// The id list lives in REFERENCED_IDS below — extend it when a suite starts
// using a new board. The fixture is committed: tests must not depend on the
// machine's tree.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const { walkBoardCatalog } = require('../packages/cuttlefish/dist/board-catalog/walker.js');

// Every board id the suites/demos reference, directly or via bare id.
// (Negative-test ids like 'a/b/c', 'not_a_board/at/all', 'nope/nope/nope'
// are deliberately absent — they must never resolve.)
const REFERENCED_IDS = [
  'adafruit_feather_adalogger_rp2040',
  'adafruit_feather_esp32s2_tft_reverse',
  'adafruit_feather_m4_express',
  'adafruit_itsybitsy_m4_express',
  'apollo4p_blue_kxr_evb',
  'arduino_nano_33_iot',
  'blackpill_f401cc',
  'blackpill_f401ce',
  'blackpill_f411ce',
  'cy8ckit_062_wifi_bt',
  'ek_ra8d1',
  'esp32_devkitc',
  'esp32c3_devkitm',
  'esp32s3_devkitc',
  'frdm_imx93',
  'frdm_mcxe31b',
  'imx8mm_evk',
  'imx8mp_var_dart',
  'lp_mspm0g3519',
  'mimxrt1060_evk@A',
  'mm_swiftio',
  'mps2',
  'nucleo_h753zi',
  'nucleo_l053r8',
  'nucleo_n657x0_q',
  'nucleo_u3c5zi_q',
  'pico_plus2',
  'pt2',
  'quick_feather',
  'rpi_pico',
  'rpi_pico2',
  'stm32c0116_dk',
  'stm32l152c_disco',
  'v2m_musca_b1',
  'weact_esp32s3_b',
  'weact_stm32h562_core',
  'xiao_ble',
];

const workspace = process.argv[2] ?? path.join(os.homedir(), 'zephyrproject');
const zephyrBase = path.join(workspace, 'zephyr');
if (!fs.existsSync(path.join(zephyrBase, 'boards'))) {
  console.error(`no boards/ at ${path.join(zephyrBase, 'boards')} — pass the zephyr base: node scripts/gen-board-catalog-fixture.mjs <zephyr-base>`);
  process.exit(1);
}

const walk = walkBoardCatalog(zephyrBase);
const keep = {};
for (const [k, v] of Object.entries(walk.boards)) {
  const bare = k.split('/')[0];
  if (REFERENCED_IDS.includes(k) || REFERENCED_IDS.includes(bare)) keep[k] = v;
}

const out = path.join(root, 'tests', 'fixtures', 'board-catalog.overlay.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  schema: 1,
  generatorRev: 9,
  provenance: walk.provenance,
  boards: keep,
}, null, 1));
console.log(`wrote ${out} — ${Object.keys(keep).length} boards of ${Object.keys(walk.boards).length} in the tree`);
const missing = REFERENCED_IDS.filter((id) => !Object.keys(keep).some((k) => k === id || k.startsWith(id + '/')));
if (missing.length > 0) console.error(`WARNING — referenced ids not found in the tree: ${missing.join(', ')}`);
