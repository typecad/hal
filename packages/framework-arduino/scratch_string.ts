import { Board } from "@typecad/board-arduino-uno";

let s1 = "Hello";
let s2 = "World";
const s3 = s1 + " " + s2;
console.log(s3);
console.log("Length: " + s3.length);
console.log("Index of W: " + s3.indexOf("W"));

const largeNum: long = 123456;
console.log("Large: " + largeNum);

const floatNum = 3.14159;
console.log("Float: " + floatNum);
