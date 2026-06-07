import { buildProgramIR } from '../packages/cli/src/ir/build-ir';
import * as fs from 'fs';

const code = `import { I2C0 } from '@typecad/framework-arduino/arduino';\nI2C0.begin();\nconst values = [10,20,30];\nconst len = values.length;\n`;
const ir = buildProgramIR('debug.ts', code);
const debug = ir.program.topLevelStatements
  .filter(stmt => stmt.kind === 'var_decl')
  .map(stmt => ({ name: stmt.name, cppType: stmt.cppType, initializerKind: stmt.initializer?.kind, initializer: stmt.initializer }));
fs.writeFileSync('.build/debug-array-type.json', JSON.stringify(debug, null, 2));
