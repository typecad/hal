import { rawCpp } from './emit';
import { include } from './include';

export class Test{

    static start() {
        let _t = "test";
        include("<test.h>");
        rawCpp(`test(${_t}, LOW);`);
    }
}
