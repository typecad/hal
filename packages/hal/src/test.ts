import { rawCpp } from './emit.js';
import { include } from './include.js';

export class Test{

    static start() {
        let _t = "test";
        include("<test.h>");
        rawCpp(`test(${_t}, LOW);`);
    }
}
