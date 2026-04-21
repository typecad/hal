import { buildProgramIR } from '../packages/cli/src/ir/build-ir';
import { emitCpp } from '../packages/cli/src/emit/cpp-emitter';
import { createPolyfillRegistry } from '../packages/cli/src/polyfill';
import * as fs from 'fs';

const tsCode = `function test(): int { const arr = [1,2,3,4,5]; return arr.length; }`;
const programIR = buildProgramIR('test.ts', tsCode);
const libdefs = new Map();
const registry = createPolyfillRegistry();
const polyfills = registry.detectAndGenerate(programIR, { target: 'generic', architecture: undefined, usedIdentifiers: new Set() });
const result = emitCpp(programIR, {
  outDir: '.build',
  emitMode: 'cpp',
  target: 'generic',
  libdefs,
  emitMaps: false,
  platformContext: undefined,
  polyfills,
});
fs.writeFileSync('.build/inspect-array.json', JSON.stringify({ statements: programIR.program.statements, result }, null, 2));
