// ---------------------------------------------------------------------------
// Native demo — compiles to a portable C++ executable via g++ / clang++
// ---------------------------------------------------------------------------

function greet(name: string): string {
  return `Hello, ${name}!`;
}

function fibonacci(n: number): number {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

function add(a: number, b: number): number {
  return a + b;
}

// Profile start
const startTime = Date.now();

console.log(greet('TypeCode Native'));
console.log('=== Fibonacci ===');

for (let i = 0; i < 10; i++) {
  console.log(`fib(${i}) = ${fibonacci(i)}`);
}

// Stress test: 10 million fibonacci calls
let stressSum = 0;
for (let i = 0; i < 10000000; i++) {
  stressSum += fibonacci(i % 40);
}
console.log(`Stress test sum: ${stressSum}`);

console.log('');
console.log('=== Math ===');
console.log(`5 + 3 = ${add(5, 3)}`);

console.log('');
console.log('=== String Operations ===');
const msg = 'hello world';
console.log(`Original: ${msg}`);
console.log(`Upper: ${msg.toUpperCase()}`);
console.log(`Lower: ${msg.toLowerCase()}`);

const spaced = '  spaced  ';
console.log(`Trimmed: ${spaced.trim()}`);

// String replace — inline to avoid type inference issues
const greeting = 'hello world';
console.log(`Replace: ${greeting.replace('world', 'TypeCode')}`);

// startsWith — regex transforms to rfind comparison
const h = 'hello';
console.log(`Starts with 'hello': ${h.startsWith('hello')}`);

console.log('');
console.log('=== Array Operations ===');

// Array join
const nums = [1, 2, 3, 4, 5];
console.log(`Join: ${nums.join('-')}`);

console.log('');
console.log('=== Timer Polyfill ===');
console.log('setTimeout/setInterval polyfills compiled successfully');

// Profile end
const elapsed = Date.now() - startTime;
console.log('');
console.log(`=== Profile ===`);
console.log(`Total time: ${elapsed}ms`);
