// ---------------------------------------------------------------------------
// @typehal/core — Synchronisation primitives
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capability discovery
// ---------------------------------------------------------------------------

export interface LockCapabilities {
  mutex: boolean;
  semaphore: boolean;
  spinlock: boolean;
  criticalSection: boolean;
}

// ---------------------------------------------------------------------------
// Mutex
// ---------------------------------------------------------------------------

export interface IMutex {
  readonly name: string;
  readonly isLocked: boolean;

  lock(): Promise<void>;
  tryLock(): boolean;
  tryLockWithTimeout(timeout: number): Promise<boolean>;
  unlock(): void;
  withLock<T>(fn: () => T | Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------

export interface ISemaphore {
  readonly name: string;
  readonly maxCount: number;
  readonly count: number;

  wait(): Promise<void>;
  tryWait(): boolean;
  waitWithTimeout(timeout: number): Promise<boolean>;
  signal(): void;
  getCount(): number;
}

export interface IBinarySemaphore extends ISemaphore {
  signalFromISR(): void;
}

// ---------------------------------------------------------------------------
// Spinlock
// ---------------------------------------------------------------------------

export interface ISpinlock {
  readonly name: string;
  acquire(): void;
  release(): void;
  tryAcquire(): boolean;
}

// ---------------------------------------------------------------------------
// Critical section
// ---------------------------------------------------------------------------

export interface ICriticalSection {
  enter(): void;
  exit(): void;
}

// ---------------------------------------------------------------------------
// Lock factory
// ---------------------------------------------------------------------------

export interface ILockFactory {
  getCapabilities(): LockCapabilities;
  createMutex(name?: string): IMutex;
  createSemaphore(maxCount: number, initialCount?: number, name?: string): ISemaphore;
  createBinarySemaphore(name?: string): IBinarySemaphore;
  createSpinlock(name?: string): ISpinlock;
  createCriticalSection(): ICriticalSection;
  inCriticalSection<T>(fn: () => T): T;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface IQueue<T = unknown> {
  readonly name: string;
  readonly maxSize: number;
  readonly size: number;
  readonly isEmpty: boolean;
  readonly isFull: boolean;

  send(item: T): Promise<void>;
  trySend(item: T): boolean;
  sendWithTimeout(item: T, timeout: number): Promise<boolean>;
  receive(): Promise<T>;
  tryReceive(): T | undefined;
  receiveWithTimeout(timeout: number): Promise<T | undefined>;
  peek(): T | undefined;
  clear(): void;
}

export interface IQueueFactory {
  create<T>(maxSize: number, name?: string): IQueue<T>;
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export interface IEvent {
  readonly name: string;
  readonly isSignaled: boolean;

  wait(): Promise<void>;
  waitWithTimeout(timeout: number): Promise<boolean>;
  signal(): void;
  signalFromISR(): void;
  reset(): void;
}

export interface IEventFactory {
  createAutoReset(name?: string): IEvent;
  createManualReset(name?: string): IEvent;
}
