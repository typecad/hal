// Verify a hardware-suite test file the way `typecad-hal test` does:
// preprocess (DSL → protocol + test-pins substitution) → derived config →
// `typecad-hal build --skip-type-check --force`. No flash, no port — the
// transpile gate for suite files when no board is attached.
//
//   node scripts/verify-hw-test.mjs <test.ts> <boards/blackpill> [boards/esp32s3 ...]
import { preprocess } from '../packages/cuttlefish/dist/test-runner/preprocessor.js';
import { boardTestPins, buildTestPinsSubstitutions } from '../packages/cuttlefish/dist/test-runner/test-pins.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [, , testFile, ...boardDirs] = process.argv;
if (!testFile || boardDirs.length === 0) {
  console.error('usage: node scripts/verify-hw-test.mjs <test.ts> <boardDir> [boardDir...]');
  process.exit(2);
}
const src = fs.readFileSync(path.resolve(testFile), 'utf8');
const cli = path.join(root, 'packages/cuttlefish/dist/cli.js');
let failed = 0;
for (const bd of boardDirs) {
  const absBoard = path.resolve(root, 'packages/hal/boards', path.basename(bd.replace(/\/$/, '')));
  const cfg = fs.readFileSync(path.join(absBoard, 'typecad-hal.config.ts'), 'utf8');
  const board = cfg.match(/board:\s*'([^']+)'/)[1];
  const fw = cfg.match(/framework:\s*'([^']+)'/)[1];
  const pinsData = boardTestPins(board, absBoard, path.join(absBoard, 'typecad-hal.config.ts'));
  const pins = buildTestPinsSubstitutions(pinsData);
  const pre = preprocess(src, path.basename(testFile), { testPins: pins });
  const base = path.basename(testFile, '.ts');
  const dir = path.join(root, 'packages/hal/.build/verify', `${base}-${path.basename(absBoard)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${base}.ts`), pre);
  // Forward the board config's own zephyr section (buses remux etc.) into
  // the derived config — a bracket scan between 'zephyr: {' and its
  // closing brace (the suite configs are machine-shaped).
  let zephyrSection = '';
  const zStart = cfg.indexOf('zephyr: {');
  if (zStart >= 0) {
    let depth = 0;
    const open = cfg.indexOf('{', zStart);
    let i = open;
    for (; i < cfg.length; i++) {
      if (cfg[i] === '{') depth += 1;
      else if (cfg[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    zephyrSection = cfg.slice(open, i + 1);
  }
  fs.writeFileSync(path.join(dir, 'typecad-hal.config.ts'),
    `import type { TypecadConfig } from '@typecad/cuttlefish/api';\n` +
    `const config: TypecadConfig = {\n  entry: './${base}.ts',\n  board: '${board}',\n  framework: '${fw}',\n  output: { outDir: './out' },` +
    (zephyrSection ? `\n  zephyr: ${zephyrSection},\n` : '') +
    `};\nexport default config;\n`);
  try {
    execSync(`node "${cli}" build --skip-type-check --force`, { cwd: dir, stdio: 'pipe', timeout: 120000 });
    console.log(`PASS ${base} [${path.basename(absBoard)}]`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${base} [${path.basename(absBoard)}]:\n${String(e.stdout || '')}${String(e.stderr || '')}`.trim());
  }
}
process.exit(failed ? 1 : 0);
