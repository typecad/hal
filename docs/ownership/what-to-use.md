# When and How to use Ownership

This guide helps you decide which ownership type to use for your variables based on their data size, lifecycle, and how they are used in your program.

---

## 1. Simple Primitives (`number`, `boolean`)
For simple types like integers, floats, and booleans, you **do not need** to use the ownership system.

### Why?
In C++, these types are "scalars." They are extremely small (usually 1–4 bytes) and are passed by **value**. Copying them is just as fast as passing a reference.

```typescript
let temp: number = 25.5; // No annotation needed
let isActive: boolean = true; 

function log(val: number) { // Plain number is fine
  console.log(val);
}
```
**Pitfall Avoided**: Overcomplicating code. Using `Shared<number>` would actually make the code slightly slower and more verbose for no safety gain.

---

## 2. Small Local Buffers (e.g., Sensor Data)
**Scenario**: You create a small array to hold the last 5 temperature readings, fill it, and pass it to a routine to calculate the average.

### Best Pattern: `Owned` source + `Shared` borrow
```typescript
function getAverage(readings: Shared<number[]>): number {
  let sum = 0;
  for (const r of readings) sum += r;
  return sum / readings.length;
}

function loop() {
  // 1. Create the data as Owned
  const temps: Owned<number[]> = [22, 23, 21, 24, 22]; 

  // 2. Borrow it for the calculation
  const avg = getAverage(temps); 
  console.log(avg);

  // 3. 'temps' is still valid here because we only borrowed it!
}
```
**Benefit**: **Zero-Copy Performance**. Even for small arrays, passing by `Shared` ensures the C++ doesn't create a temporary array on the stack for the function call.

---

## 3. Large Data Processing (e.g., Image/Log Buffers)
**Scenario**: You have a large 1KB buffer for an image. Once you've captured it, you want to hand it off to a "Send" function and never touch it again to prevent accidental corruption.

### Best Pattern: `Owned` Transfer
```typescript
function sendToCloud(buffer: Owned<Uint8Array>) {
  // Once the data is sent, this function might clear or free it
}

function processImage() {
  const image: Owned<Uint8Array> = captureFrame(); 

  // Hand off ownership completely
  sendToCloud(image); 

  // ERROR: 'image' was moved and cannot be used again. [ownership-use-after-move]
  // console.log(image[0]); 
}
```
**Benefit**: **Memory Safety**. You are mathematically certain that `processImage` cannot accidentally modify the buffer while `sendToCloud` is in the middle of a network transmission.

---

## 4. Shared Configuration (e.g., Device Settings)
**Scenario**: You have a central configuration object that many different parts of your code (Display, Network, Sensors) need to read, but none should be allowed to change.

### Best Pattern: Central `Owned` + Multiple `Shared`
```typescript
const config: Owned<Config> = loadSettings();

// The Display only needs to read the config
function updateDisplay(c: Shared<Config>) {
  console.log(c.brightness);
}

// The Network only needs to read the config
function checkWifi(c: Shared<Config>) {
  console.log(c.ssid);
}

updateDisplay(config);
checkWifi(config);
```
**Benefit**: **Deep Immutability**. You avoid "Spooky Action at a Distance" where one module accidentally changes a setting that another module relies on.

---

## 5. In-Place Modification (e.g., Data Filtering)
**Scenario**: You have a raw buffer from a sensor and you need to pass it through a "Noise Filter" that cleans up the data within the same memory space.

### Best Pattern: `Mutable` Borrow
```typescript
function applyFilter(data: Mutable<Uint8Array>) {
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 100) data[i] = 100; // Modify in-place
  }
}

function readSensors() {
  const raw: Owned<Uint8Array> = getRawData();
  
  applyFilter(raw); // Explicitly borrowed for mutation
  
  // 'raw' is now filtered and ready to use
}
```
**Benefit**: **RAM Efficiency**. You modify the data in-place without needing a second "result" buffer, which is critical on devices with very little RAM.

---

## Summary Cheat Sheet

| Data Type | Usage | Recommended Type |
| :--- | :--- | :--- |
| `number`, `boolean` | Anything | None (Plain JS) |
| `Array`, `Object`, `string` | Read-only access | `Shared<T>` |
| `Array`, `Object` | Modify in-place | `Mutable<T>` |
| `Array`, `Object` | Transfer/Final Handoff | `Owned<T>` |
| Large Buffers | Storing in a class | `Owned<T>` |
