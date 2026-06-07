// ============================================================
// TEST: Comprehensive feature coverage for cuttlefish
// ============================================================

// ============================================================
// SECTION A: Array methods (beyond push/pop/sort)
// ============================================================

// A1: map
let arr1: number[] = [1, 2, 3];
let doubled = arr1.map(x => x * 2);
console.log(doubled[0]);

// A2: filter
let evens = arr1.filter(x => x % 2 === 0);
console.log(evens[0]);

// A3: reduce
let total = arr1.reduce((acc, x) => acc + x, 0);
console.log(total);

// A5: includes on array
let hasTwo = arr1.includes(2);
console.log(hasTwo);

// A6: indexOf
let idx = arr1.indexOf(3);
console.log(idx);

// A7: join
let joined = arr1.join(", ");
console.log(joined);

// A8: slice
let sliced = arr1.slice(1, 2);
console.log(sliced[0]);

// A9: concat
let combined = arr1.concat([4, 5]);
console.log(combined[3]);

// A10: every
let allPositive = arr1.every(x => x > 0);
console.log(allPositive);

// A11: some
let anyBig = arr1.some(x => x > 2);
console.log(anyBig);

// A12: find
let found = arr1.find(x => x > 1);
console.log(found);

// A13: findIndex
let foundIdx = arr1.findIndex(x => x > 1);
console.log(foundIdx);

// ============================================================
// SECTION B: String methods (on string literals)
// ============================================================

// B1: split
let parts = "hello world".split(" ");
console.log(parts[0]);

// B2: trim
let trimmed = "  hello  ".trim();
console.log(trimmed);

// B3: substring
let sub = "hello".substring(1, 3);
console.log(sub);

// B4: toUpperCase
let upper = "hello".toUpperCase();
console.log(upper);

// B5: toLowerCase
let lower = "HELLO".toLowerCase();
console.log(lower);

// B6: string includes
let hasWorld = "hello world".includes("world");
console.log(hasWorld);

// B7: string indexOf
let wi = "hello world".indexOf("world");
console.log(wi);

// B8: replace
let replaced = "hello world".replace("world", "there");
console.log(replaced);

// B9: startsWith
let starts = "hello".startsWith("he");
console.log(starts);

// B10: endsWith
let ends = "hello".endsWith("lo");
console.log(ends);

// B11: charAt
let ch = "hello".charAt(1);
console.log(ch);

// B12: padStart
let padded = "5".padStart(3, "0");
console.log(padded);

// B13: padEnd
let paddedEnd = "5".padEnd(3, "0");
console.log(paddedEnd);

// B14: repeat
let repeated = "ab".repeat(3);
console.log(repeated);

// B15: slice on string
let s1 = "hello".slice(1, 3);
console.log(s1);

// B16: String methods on variables
let greeting: string = "Hello World";
console.log(greeting.toUpperCase());
console.log(greeting.toLowerCase());
console.log(greeting.trim());
console.log(greeting.split(" ")[0]);
console.log(greeting.replace("World", "Cuttlefish"));

// ============================================================
// SECTION C: Operators
// ============================================================

// C5: ??= (nullish coalescing assignment)
let maybeVal: number | undefined = undefined;
maybeVal ??= 99;
console.log(maybeVal);

// C6: Bitwise operators
let bAnd = 0xFF & 0x0F;
let bOr = 0xF0 | 0x0F;
let bXor = 0xFF ^ 0x0F;
let bShiftL = 1 << 4;
let bShiftR = 256 >> 4;
console.log(bAnd);
console.log(bOr);
console.log(bXor);
console.log(bShiftL);
console.log(bShiftR);

// C7: Exponentiation
let expResult = 2 ** 10;
console.log(expResult);

// ============================================================
// SECTION D: Control flow
// ============================================================

// D1: for...of
for (let n of [10, 20, 30]) {
    console.log(n);
}

// D3: do...while
let dw = 0;
do {
    dw++;
} while (dw < 3);
console.log(dw);

// D4: switch
let sw = 2;
switch (sw) {
    case 1:
        console.log("one");
        break;
    case 2:
        console.log("two");
        break;
    default:
        console.log("other");
        break;
}

// D5: continue in for loop
for (let i = 0; i < 5; i++) {
    if (i === 2) continue;
    if (i === 4) break;
    console.log(i);
}

// D6: ternary chain
let tc = sw === 1 ? "one" : sw === 2 ? "two" : "other";
console.log(tc);

// ============================================================
// SECTION E: Destructuring
// ============================================================

// E2: Array destructuring
let [first, , third] = [10, 20, 30];
console.log(first);
console.log(third);

// ============================================================
// SECTION F: Classes
// ============================================================

class Dog {
    name: string;
    private _age: number;

    constructor(name: string, age: number) {
        this.name = name;
        this._age = age;
    }

    bark(): string {
        return this.name + " says woof!";
    }

    get age(): number {
        return this._age;
    }

    set age(val: number) {
        this._age = val;
    }

    static species(): string {
        return "Canis familiaris";
    }
}

let d = new Dog("Rex", 5);
console.log(d.bark());
console.log(d.age);
d.age = 6;
console.log(d.age);

// ============================================================
// SECTION G: Enums
// ============================================================

enum Color {
    Red,
    Green,
    Blue
}

let c: Color = Color.Green;
console.log(c);

// ============================================================
// SECTION I: Type system
// ============================================================

// I1: typeof narrowing
let xx: number = 42;
console.log(typeof xx);

// ============================================================
// SECTION J: Template literals
// ============================================================

let tmpl = `result: ${1 + 2} items`;
console.log(tmpl);

let tmpl2 = `hello ${"world".toUpperCase()}`;
console.log(tmpl2);

// ============================================================
// SECTION K: Spread
// ============================================================

let spread1: number[] = [1, 2];
let spread2: number[] = [...spread1, 3, 4];
console.log(spread2[2]);

// ============================================================
// SECTION L: Default parameters
// ============================================================

function greet(name: string, greeting: string = "Hello"): string {
    return greeting + " " + name;
}

console.log(greet("World"));
console.log(greet("World", "Hi"));

// ============================================================
// SECTION M: try/catch/finally
// ============================================================

try {
    throw Error("boom");
} catch (err) {
    console.log("caught error");
} finally {
    console.log("finally");
}

// ============================================================
// SECTION N: ??= operator
// ============================================================

let nv1: number | undefined = undefined;
nv1 ??= 42;
console.log(nv1);

let nv2: number | undefined = 10;
nv2 ??= 42;
console.log(nv2);

// ============================================================
// SECTION O: Tuple types
// ============================================================

type Point = [number, number];
let pt: Point = [1, 2];
console.log(pt[0]);
console.log(pt[1]);
