// ---------------------------------------------------------------------------
// @typehal/core — Fixed-size buffer types
//
// These are TypeScript-level abstractions that the transpiler maps to
// stack-allocated C++ containers (no heap).
// ---------------------------------------------------------------------------

/**
 * Fixed-capacity contiguous buffer.
 * Transpiles to a stack-allocated array with a length counter.
 */
export interface FixedBuffer<T> {
  readonly capacity: number;
  readonly length: number;

  push(item: T): boolean;
  pop(): T | undefined;
  get(index: number): T;
  set(index: number, value: T): void;
  clear(): void;
  isFull(): boolean;
  isEmpty(): boolean;
  toArray(): T[];
}

/**
 * Fixed-capacity circular (ring) buffer.
 * Ideal for streaming data (UART RX, sensor windows, etc.).
 */
export interface CircularBuffer<T = number> {
  readonly capacity: number;
  readonly length: number;

  write(item: T): boolean;
  read(): T | undefined;
  peek(): T | undefined;
  clear(): void;
  isFull(): boolean;
  isEmpty(): boolean;
  availableForRead(): number;
  availableForWrite(): number;
}

/**
 * Pre-allocated object pool with O(1) alloc / free.
 * Prevents heap fragmentation on long-running embedded systems.
 */
export interface ObjectPool<T> {
  readonly capacity: number;
  readonly available: number;

  acquire(): T | undefined;
  release(item: T): void;
  isFull(): boolean;
  isEmpty(): boolean;
  clear(): void;
}
