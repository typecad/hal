import { emit } from './emit';
import { include } from './include';

export class Test{

    static start() {
        let _t = "test";
        include("<test.h>");
        emit(`test(${_t}, LOW);`);
    }
}