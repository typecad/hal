import { buildProgramIR } from '../packages/cli/src/ir/build-ir';
import { expressionToIR } from '../packages/cli/src/ir/expression-to-ir';
import { buildProgramIRState } from '../packages/cli/src/ir/build-ir';
import * as ts from 'typescript';
import * as fs from 'fs';

const code = `import { I2C0 } from '@typehal/framework-arduino/arduino';\nI2C0.begin();\nconst values = [10,20,30];\nconst len = values.length;\n`;
const programIR = buildProgramIR('test.ts', code);
fs.writeFileSync('.build/inspect-array-type.json', JSON.stringify(programIR, null, 2));
console.log('wrote .build/inspect-array-type.json');
