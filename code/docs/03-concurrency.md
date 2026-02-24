# Concurrency Model

## Overview

The typeCode concurrency model provides abstractions for task management, scheduling, and synchronization. These abstractions map to architecture-specific implementations: bare-metal cooperative scheduling on AVR, FreeRTOS on ESP32, and the Pico SDK scheduler on RP2040.

---

## Design Philosophy

1. **Graceful Degradation** - Code using concurrency primitives compiles on all architectures, even if the target doesn't support true parallelism
2. **Explicit Parallelism** - Parallel execution is opt-in; single-threaded boards fall back to cooperative multitasking
3. **Type-Safe Synchronization** - Lock primitives are only available on architectures that support them
4. **Unified API** - Same TypeScript API across all platforms with architecture-specific transpilation

---

## Architecture Concurrency Support

| Feature | AVR (Arduino Uno) | ESP32 | RP2040 |
|---------|------------------|-------|--------|
| Task Scheduler | Cooperative (polling) | FreeRTOS Preemptive | Cooperative + Core 1 |
| Parallel Execution | No | Yes (2 cores) | Yes (2 cores) |
| Mutex/Lock | No | Yes | Yes (spinlock) |
| Semaphore | No | Yes | Limited |
| Queue | Software only | Yes | Yes |
| Event Groups | No | Yes | No |

---

## Source: concurrency/task.ts

```typescript
// src/@typecode/core/concurrency/task.ts

/**
 * Task state enumeration
 */
enum TaskState {
  /** Task is ready to run */
  READY = 'READY',
  /** Task is currently executing */
  RUNNING = 'RUNNING',
  /** Task is waiting for an event/resource */
  BLOCKED = 'BLOCKED',
  /** Task is suspended (paused) */
  SUSPENDED = 'SUSPENDED',
  /** Task has completed or been terminated */
  TERMINATED = 'TERMINATED'
}

/**
 * Task priority levels
 */
enum TaskPriority {
  /** Lowest priority - background tasks */
  IDLE = 0,
  /** Low priority - non-critical operations */
  LOW = 1,
  /** Normal priority - default */
  NORMAL = 2,
  /** High priority - time-sensitive operations */
  HIGH = 3,
  /** Real-time priority - critical operations */
  REALTIME = 4
}

/**
 * Task configuration
 */
interface TaskConfig {
  /** Task name (for debugging) */
  name?: string;
  
  /** Task priority */
  priority?: TaskPriority;
  
  /** Stack size in bytes (ESP32/RP2040 only) */
  stackSize?: number;
  
  /** Core affinity (0 or 1 for dual-core) */
  core?: number;
  
  /** Task function to execute */
  run: () => Promise<void> | void;
  
  /** Initial delay before first run (milliseconds) */
  delay?: number;
  
  /** Period between runs for periodic tasks (milliseconds) */
  period?: number;
}

/**
 * Task statistics (for monitoring)
 */
interface TaskStats {
  /** Task name */
  name: string;
  
  /** Current state */
  state: TaskState;
  
  /** Priority */
  priority: TaskPriority;
  
  /** Number of times task has run */
  runCount: number;
  
  /** Total execution time in microseconds */
  totalRunTime: number;
  
  /** Stack high water mark (bytes remaining) */
  stackHighWaterMark?: number;
  
  /** Core assignment (dual-core systems) */
  core?: number;
}

/**
 * Task handle for controlling tasks
 */
interface ITaskHandle {
  /** Unique task ID */
  readonly id: number;
  
  /** Task name */
  readonly name: string;
  
  /** Current state */
  readonly state: TaskState;
  
  /** Task priority */
  readonly priority: TaskPriority;
  
  /**
   * Resume a suspended task
   */
  resume(): void;
  
  /**
   * Suspend a running task
   */
  suspend(): void;
  
  /**
   * Terminate the task
   */
  terminate(): void;
  
  /**
   * Change task priority
   */
  setPriority(priority: TaskPriority): void;
  
  /**
   * Get task statistics
   */
  getStats(): TaskStats;
  
  /**
   * Wait for task to complete
   */
  join(): Promise<void>;
}

/**
 * Task creation options
 */
interface TaskCreateOptions {
  /** Run task immediately (default: true) */
  autoStart?: boolean;
  
  /** Core affinity for dual-core systems */
  core?: 0 | 1;
}

/**
 * Create and manage tasks
 */
interface ITaskManager {
  /**
   * Create a new task
   * @param config Task configuration
   * @param options Creation options
   * @returns Task handle
   */
  create(config: TaskConfig, options?: TaskCreateOptions): ITaskHandle;
  
  /**
   * Create a periodic task
   * @param name Task name
   * @param callback Function to execute
   * @param period Period in milliseconds
   */
  createPeriodic(
    name: string,
    callback: () => void,
    period: number
  ): ITaskHandle;
  
  /**
   * Get current task handle
   */
  getCurrentTask(): ITaskHandle;
  
  /**
   * Get all active tasks
   */
  getAllTasks(): ITaskHandle[];
  
  /**
   * Yield CPU to other tasks
   */
  yield(): void;
  
  /**
   * Sleep for specified duration
   * @param milliseconds Duration to sleep
   */
  sleep(milliseconds: number): Promise<void>;
  
  /**
   * Sleep until a specific time
   * @param timestamp Target time in milliseconds since boot
   */
  sleepUntil(timestamp: number): Promise<void>;
  
  /**
   * Check if current context is interrupt
   */
  inInterrupt(): boolean;
}

/**
 * Global task manager instance
 */
declare const Task: ITaskManager;
```

---

## Source: concurrency/scheduler.ts

```typescript
// src/@typecode/core/concurrency/scheduler.ts

import { ITaskHandle, TaskPriority, TaskState } from './task';

/**
 * Scheduler configuration
 */
interface SchedulerConfig {
  /** Tick interval in milliseconds (default: 1) */
  tickInterval?: number;
  
  /** Enable task statistics collection */
  enableStats?: boolean;
  
  /** Maximum number of tasks */
  maxTasks?: number;
  
  /** Idle task callback (runs when no other tasks ready) */
  idleCallback?: () => void;
}

/**
 * Scheduler statistics
 */
interface SchedulerStats {
  /** Total ticks since start */
  totalTicks: number;
  
  /** Number of context switches */
  contextSwitches: number;
  
  /** CPU idle time percentage */
  idleTimePercent: number;
  
  /** Number of active tasks */
  activeTaskCount: number;
  
  /** Current tick rate */
  tickRate: number;
}

/**
 * Scheduler interface
 */
interface IScheduler {
  /**
   * Initialize the scheduler
   */
  initialize(config?: SchedulerConfig): void;
  
  /**
   * Start the scheduler
   * On bare-metal, this enters the main loop
   * On RTOS, this starts the scheduler
   */
  start(): void;
  
  /**
   * Stop the scheduler
   */
  stop(): void;
  
  /**
   * Check if scheduler is running
   */
  isRunning(): boolean;
  
  /**
   * Get current tick count
   */
  getTickCount(): number;
  
  /**
   * Get milliseconds since boot
   */
  getMillis(): number;
  
  /**
   * Get microseconds since boot
   */
  getMicros(): number;
  
  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats;
  
  /**
   * Register a callback for scheduler events
   */
  onTaskComplete(callback: (task: ITaskHandle) => void): void;
  
  /**
   * Register a callback for task errors
   */
  onTaskError(callback: (task: ITaskHandle, error: Error) => void): void;
}

/**
 * Timer-based scheduling
 */
interface ITimer {
  /** Timer ID */
  readonly id: number;
  
  /** Whether timer is active */
  readonly isActive: boolean;
  
  /**
   * Start or restart the timer
   */
  start(): void;
  
  /**
   * Stop the timer
   */
  stop(): void;
  
  /**
   * Reset the timer (restart from 0)
   */
  reset(): void;
  
  /**
   * Change the period
   */
  setPeriod(milliseconds: number): void;
  
  /**
   * Get remaining time
   */
  getRemaining(): number;
}

/**
 * Timer configuration
 */
interface TimerConfig {
  /** Timer period in milliseconds */
  period: number;
  
  /** Timer callback */
  callback: () => void;
  
  /** Auto-start timer (default: true) */
  autoStart?: boolean;
  
  /** Repeat timer (default: true) */
  repeat?: boolean;
}

/**
 * Timer manager interface
 */
interface ITimerManager {
  /**
   * Create a new timer
   */
  create(config: TimerConfig): ITimer;
  
  /**
   * Create a one-shot timer
   */
  createOneShot(delay: number, callback: () => void): ITimer;
  
  /**
   * Create a periodic timer
   */
  createPeriodic(period: number, callback: () => void): ITimer;
  
  /**
   * Get all active timers
   */
  getActiveTimers(): ITimer[];
  
  /**
   * Destroy a timer
   */
  destroy(timer: ITimer): void;
}

/**
 * Global scheduler instance
 */
declare const Scheduler: IScheduler;
declare const Timer: ITimerManager;
```

---

## Source: concurrency/lock.ts

```typescript
// src/@typecode/core/concurrency/lock.ts

/**
 * Lock types available on the platform
 */
interface LockCapabilities {
  /** Platform supports mutex */
  mutex: boolean;
  
  /** Platform supports semaphore */
  semaphore: boolean;
  
  /** Platform supports spinlock */
  spinlock: boolean;
  
  /** Platform supports critical sections */
  criticalSection: boolean;
}

/**
 * Get lock capabilities for current architecture
 */
function getLockCapabilities(): LockCapabilities {
  // Overridden by architecture shim
  return {
    mutex: false,
    semaphore: false,
    spinlock: false,
    criticalSection: true
  };
}

/**
 * Mutex interface
 * Mutual exclusion for protecting shared resources
 */
interface IMutex {
  /** Mutex name (for debugging) */
  readonly name: string;
  
  /** Whether mutex is currently locked */
  readonly isLocked: boolean;
  
  /**
   * Acquire the mutex
   * Blocks until mutex is available
   */
  lock(): Promise<void>;
  
  /**
   * Try to acquire the mutex without blocking
   * @returns true if acquired, false if already locked
   */
  tryLock(): boolean;
  
  /**
   * Try to acquire with timeout
   * @param timeout Maximum time to wait in milliseconds
   */
  tryLockWithTimeout(timeout: number): Promise<boolean>;
  
  /**
   * Release the mutex
   * Must be called by the same task that acquired it
   */
  unlock(): void;
  
  /**
   * Execute a function while holding the lock
   * Automatically releases lock when done
   */
  withLock<T>(fn: () => T | Promise<T>): Promise<T>;
}

/**
 * Semaphore interface
 * Counting semaphore for resource pools
 */
interface ISemaphore {
  /** Semaphore name */
  readonly name: string;
  
  /** Maximum count */
  readonly maxCount: number;
  
  /** Current count */
  readonly count: number;
  
  /**
   * Wait (decrement) the semaphore
   * Blocks if count is 0
   */
  wait(): Promise<void>;
  
  /**
   * Try to wait without blocking
   * @returns true if successful, false if count is 0
   */
  tryWait(): boolean;
  
  /**
   * Wait with timeout
   */
  waitWithTimeout(timeout: number): Promise<boolean>;
  
  /**
   * Signal (increment) the semaphore
   */
  signal(): void;
  
  /**
   * Get current count
   */
  getCount(): number;
}

/**
 * Binary semaphore (simpler than mutex for signaling)
 */
interface IBinarySemaphore extends ISemaphore {
  /**
   * Signal from interrupt context
   * Safe to call from ISR
   */
  signalFromISR(): void;
}

/**
 * Spinlock interface
 * Busy-wait lock for very short critical sections
 */
interface ISpinlock {
  /** Spinlock name */
  readonly name: string;
  
  /**
   * Acquire the spinlock
   * Busy-waits until available
   */
  acquire(): void;
  
  /**
   * Release the spinlock
   */
  release(): void;
  
  /**
   * Try to acquire without blocking
   */
  tryAcquire(): boolean;
}

/**
 * Critical section guard
 * Automatic lock/unlock using RAII pattern
 */
interface ICriticalSection {
  /**
   * Enter critical section
   * Disables interrupts
   */
  enter(): void;
  
  /**
   * Exit critical section
   * Restores interrupt state
   */
  exit(): void;
}

/**
 * Lock factory interface
 */
interface ILockFactory {
  /**
   * Check lock capabilities
   */
  getCapabilities(): LockCapabilities;
  
  /**
   * Create a mutex
   */
  createMutex(name?: string): IMutex;
  
  /**
   * Create a counting semaphore
   */
  createSemaphore(maxCount: number, initialCount?: number, name?: string): ISemaphore;
  
  /**
   * Create a binary semaphore
   */
  createBinarySemaphore(name?: string): IBinarySemaphore;
  
  /**
   * Create a spinlock
   */
  createSpinlock(name?: string): ISpinlock;
  
  /**
   * Create a critical section
   */
  createCriticalSection(): ICriticalSection;
  
  /**
   * Execute code in critical section
   * @param fn Function to execute with interrupts disabled
   */
  inCriticalSection<T>(fn: () => T): T;
}

/**
 * Global lock factory
 * Architecture shim provides implementation
 */
declare const Lock: ILockFactory;

/**
 * Queue for inter-task communication
 */
interface IQueue {
  /** Queue name */
  readonly name: string;
  
  /** Maximum items in queue */
  readonly maxSize: number;
  
  /** Current number of items */
  readonly size: number;
  
  /** Whether queue is empty */
  readonly isEmpty: boolean;
  
  /** Whether queue is full */
  readonly isFull: boolean;
  
  /**
   * Send item to queue
   * Blocks if queue is full
   */
  send<T>(item: T): Promise<void>;
  
  /**
   * Send item without blocking
   * @returns true if sent, false if queue full
   */
  trySend<T>(item: T): boolean;
  
  /**
   * Send with timeout
   */
  sendWithTimeout<T>(item: T, timeout: number): Promise<boolean>;
  
  /**
   * Receive item from queue
   * Blocks if queue is empty
   */
  receive<T>(): Promise<T>;
  
  /**
   * Receive without blocking
   * @returns item or undefined if queue empty
   */
  tryReceive<T>(): T | undefined;
  
  /**
   * Receive with timeout
   */
  receiveWithTimeout<T>(timeout: number): Promise<T | undefined>;
  
  /**
   * Peek at front item without removing
   */
  peek<T>(): T | undefined;
  
  /**
   * Clear all items
   */
  clear(): void;
}

/**
 * Queue factory
 */
interface IQueueFactory {
  /**
   * Create a queue
   */
  create<T>(maxSize: number, name?: string): IQueue;
}

declare const Queue: IQueueFactory;

/**
 * Event for task synchronization
 */
interface IEvent {
  /** Event name */
  readonly name: string;
  
  /** Whether event is signaled */
  readonly isSignaled: boolean;
  
  /**
   * Wait for event
   */
  wait(): Promise<void>;
  
  /**
   * Wait with timeout
   */
  waitWithTimeout(timeout: number): Promise<boolean>;
  
  /**
   * Signal the event
   */
  signal(): void;
  
  /**
   * Signal from ISR
   */
  signalFromISR(): void;
  
  /**
   * Reset (unsignal) the event
   */
  reset(): void;
}

/**
 * Event factory
 */
interface IEventFactory {
  /**
   * Create an auto-reset event
   * Automatically resets after one waiter is released
   */
  createAutoReset(name?: string): IEvent;
  
  /**
   * Create a manual-reset event
   * Stays signaled until manually reset
   */
  createManualReset(name?: string): IEvent;
}

declare const Event: IEventFactory;
```

---

## Architecture-Specific Implementations

### Arduino AVR (Bare-Metal Cooperative)

```typescript
// src/@typecode/arch-avr/concurrency.ts

import { IScheduler, ITaskManager, ITaskHandle, TaskState, TaskPriority } from '@typecode/core';

/**
 * AVR Task (cooperative scheduling)
 * No RTOS - uses a simple run queue polled in main loop
 */
class AVRTaskHandle implements ITaskHandle {
  readonly id: number;
  readonly name: string;
  readonly priority: TaskPriority;
  
  private _state: TaskState;
  private _runCount: number;
  private _callback: () => void;
  private _period: number;
  private _lastRun: number;
  
  constructor(
    id: number,
    name: string,
    callback: () => void,
    priority: TaskPriority,
    period: number
  ) {
    this.id = id;
    this.name = name;
    this._callback = callback;
    this.priority = priority;
    this._period = period;
    this._lastRun = 0;
    this._state = TaskState.READY;
    this._runCount = 0;
  }
  
  get state(): TaskState {
    return this._state;
  }
  
  resume(): void {
    this._state = TaskState.READY;
  }
  
  suspend(): void {
    this._state = TaskState.SUSPENDED;
  }
  
  terminate(): void {
    this._state = TaskState.TERMINATED;
  }
  
  setPriority(priority: TaskPriority): void {
    // Priority is read-only on AVR (no preemption)
  }
  
  getStats(): TaskStats {
    return {
      name: this.name,
      state: this._state,
      priority: this.priority,
      runCount: this._runCount,
      totalRunTime: 0,  // Not tracked on AVR
      stackHighWaterMark: undefined,
      core: undefined
    };
  }
  
  async join(): Promise<void> {
    // Wait for task termination (polling)
    while (this._state !== TaskState.TERMINATED) {
      await Task.sleep(10);
    }
  }
  
  // Internal method for scheduler
  _shouldRun(currentTime: number): boolean {
    if (this._state !== TaskState.READY) return false;
    if (this._period === 0) return true;
    return (currentTime - this._lastRun) >= this._period;
  }
  
  _execute(): void {
    this._state = TaskState.RUNNING;
    this._callback();
    this._runCount++;
    this._lastRun = AVRTaskManager.getInstance().getMillis();
    this._state = TaskState.READY;
  }
}

/**
 * AVR Task Manager
 * Simple cooperative scheduler
 */
class AVRTaskManager implements ITaskManager {
  private static _instance: AVRTaskManager;
  private _tasks: AVRTaskHandle[] = [];
  private _nextId: number = 1;
  private _currentTask: AVRTaskHandle | null = null;
  
  static getInstance(): AVRTaskManager {
    if (!AVRTaskManager._instance) {
      AVRTaskManager._instance = new AVRTaskManager();
    }
    return AVRTaskManager._instance;
  }
  
  create(config: TaskConfig, options?: TaskCreateOptions): ITaskHandle {
    const task = new AVRTaskHandle(
      this._nextId++,
      config.name || `task_${this._nextId}`,
      config.run as () => void,
      config.priority || TaskPriority.NORMAL,
      config.period || 0
    );
    this._tasks.push(task);
    return task;
  }
  
  createPeriodic(name: string, callback: () => void, period: number): ITaskHandle {
    return this.create({
      name: name,
      run: callback,
      period: period
    });
  }
  
  getCurrentTask(): ITaskHandle {
    return this._currentTask!;
  }
  
  getAllTasks(): ITaskHandle[] {
    return this._tasks;
  }
  
  yield(): void {
    // Transpiles to: yield() or return from function
    // Cooperative: does nothing until function returns
  }
  
  async sleep(milliseconds: number): Promise<void> {
    // Transpiles to: delay(milliseconds)
    // Or: vTaskDelay(pdMS_TO_TICKS(milliseconds)) on RTOS
  }
  
  async sleepUntil(timestamp: number): Promise<void> {
    const now = this.getMillis();
    const delay = timestamp - now;
    if (delay > 0) {
      await this.sleep(delay);
    }
  }
  
  inInterrupt(): boolean {
    return false;  // AVR doesn't track this easily
  }
  
  getMillis(): number {
    // Transpiles to: millis()
    return 0;
  }
  
  getMicros(): number {
    // Transpiles to: micros()
    return 0;
  }
  
  // Called from main loop
  _runNext(): void {
    const currentTime = this.getMillis();
    
    // Find highest priority ready task
    let highestPriority = -1;
    let taskToRun: AVRTaskHandle | null = null;
    
    for (const task of this._tasks) {
      if (task._shouldRun(currentTime)) {
        if (task.priority > highestPriority) {
          highestPriority = task.priority;
          taskToRun = task;
        }
      }
    }
    
    if (taskToRun) {
      this._currentTask = taskToRun;
      taskToRun._execute();
      this._currentTask = null;
    }
  }
}

/**
 * AVR Scheduler
 * Main loop executor
 */
class AVRScheduler implements IScheduler {
  private _running: boolean = false;
  private _tickCount: number = 0;
  private _onTaskComplete: ((task: ITaskHandle) => void) | null = null;
  private _onTaskError: ((task: ITaskHandle, error: Error) => void) | null = null;
  
  initialize(config?: SchedulerConfig): void {
    // No special initialization on AVR
  }
  
  start(): void {
    this._running = true;
    
    // Transpiles to main loop:
    // void loop() {
    //   AVRTaskManager.getInstance()._runNext();
    // }
  }
  
  stop(): void {
    this._running = false;
  }
  
  isRunning(): boolean {
    return this._running;
  }
  
  getTickCount(): number {
    // Transpiles to: millis()
    return 0;
  }
  
  getMillis(): number {
    return this.getTickCount();
  }
  
  getMicros(): number {
    // Transpiles to: micros()
    return 0;
  }
  
  getStats(): SchedulerStats {
    return {
      totalTicks: this._tickCount,
      contextSwitches: 0,
      idleTimePercent: 0,
      activeTaskCount: AVRTaskManager.getInstance().getAllTasks().length,
      tickRate: 1000
    };
  }
  
  onTaskComplete(callback: (task: ITaskHandle) => void): void {
    this._onTaskComplete = callback;
  }
  
  onTaskError(callback: (task: ITaskHandle, error: Error) => void): void {
    this._onTaskError = callback;
  }
}

// Export singleton instances
const Task = AVRTaskManager.getInstance();
const Scheduler = new AVRScheduler();

// AVR does not support parallel execution
const Parallel = {
  available: false,
  
  run(callback: () => void): void {
    throw new Error('Parallel execution not supported on AVR');
  },
  
  runOnCore(core: number, callback: () => void): void {
    throw new Error('Multi-core not supported on AVR');
  }
};

// AVR Lock capabilities
const Lock: ILockFactory = {
  getCapabilities(): LockCapabilities {
    return {
      mutex: false,
      semaphore: false,
      spinlock: false,
      criticalSection: true
    };
  },
  
  createMutex(name?: string): IMutex {
    throw new Error('Mutex not supported on AVR');
  },
  
  createSemaphore(maxCount: number, initialCount?: number, name?: string): ISemaphore {
    throw new Error('Semaphore not supported on AVR');
  },
  
  createBinarySemaphore(name?: string): IBinarySemaphore {
    throw new Error('Semaphore not supported on AVR');
  },
  
  createSpinlock(name?: string): ISpinlock {
    throw new Error('Spinlock not supported on AVR');
  },
  
  createCriticalSection(): ICriticalSection {
    return {
      enter(): void {
        // Transpiles to: cli() (disable interrupts)
      },
      
      exit(): void {
        // Transpiles to: sei() (enable interrupts)
      }
    };
  },
  
  inCriticalSection<T>(fn: () => T): T {
    // Transpiles to:
    // uint8_t _sreg = SREG;
    // cli();
    // T result = fn();
    // SREG = _sreg;
    // return result;
    return fn();
  }
};
```

### ESP32 (FreeRTOS)

```typescript
// src/@typecode/arch-esp32/concurrency.ts

import { IScheduler, ITaskManager, ITaskHandle, TaskState, TaskPriority, IMutex, ISemaphore } from '@typecode/core';

/**
 * ESP32 Task Handle (FreeRTOS wrapper)
 */
class ESP32TaskHandle implements ITaskHandle {
  readonly id: number;
  readonly name: string;
  readonly priority: TaskPriority;
  
  private _taskHandle: number;  // TaskHandle_t
  private _state: TaskState;
  
  constructor(id: number, name: string, taskHandle: number, priority: TaskPriority) {
    this.id = id;
    this.name = name;
    this._taskHandle = taskHandle;
    this.priority = priority;
    this._state = TaskState.READY;
  }
  
  get state(): TaskState {
    // Transpiles to: eTaskState state = eTaskGetState(this._taskHandle);
    return this._state;
  }
  
  resume(): void {
    // Transpiles to: vTaskResume(this._taskHandle);
  }
  
  suspend(): void {
    // Transpiles to: vTaskSuspend(this._taskHandle);
  }
  
  terminate(): void {
    // Transpiles to: vTaskDelete(this._taskHandle);
    this._state = TaskState.TERMINATED;
  }
  
  setPriority(priority: TaskPriority): void {
    // Transpiles to: vTaskPrioritySet(this._taskHandle, priority);
  }
  
  getStats(): TaskStats {
    // Transpiles to: vTaskGetInfo()
    return {
      name: this.name,
      state: this._state,
      priority: this.priority,
      runCount: 0,
      totalRunTime: 0,
      stackHighWaterMark: 0,
      core: 0
    };
  }
  
  async join(): Promise<void> {
    // Wait for task to terminate
    while (this.state !== TaskState.TERMINATED) {
      await Task.sleep(10);
    }
  }
}

/**
 * ESP32 Task Manager (FreeRTOS)
 */
class ESP32TaskManager implements ITaskManager {
  private _tasks: ESP32TaskHandle[] = [];
  private _nextId: number = 1;
  
  create(config: TaskConfig, options?: TaskCreateOptions): ITaskHandle {
    const core = options?.core ?? 1;  // Default to app core
    const stackSize = config.stackSize ?? 4096;
    const priority = config.priority ?? TaskPriority.NORMAL;
    const name = config.name ?? `task_${this._nextId}`;
    
    // Transpiles to:
    // TaskHandle_t handle;
    // xTaskCreatePinnedToCore(
    //   taskFunction,      // pvTaskCode
    //   name,              // pcName
    //   stackSize / 4,     // usStackDepth (words)
    //   NULL,              // pvParameters
    //   priority + 1,      // uxPriority (1-5)
    //   &handle,           // pxCreatedTask
    //   core               // xCoreID
    // );
    
    const task = new ESP32TaskHandle(this._nextId++, name, 0, priority);
    this._tasks.push(task);
    return task;
  }
  
  createPeriodic(name: string, callback: () => void, period: number): ITaskHandle {
    return this.create({
      name: name,
      run: function periodicWrapper() {
        while (true) {
          callback();
          Task.sleep(period);
        }
      },
      stackSize: 2048
    });
  }
  
  getCurrentTask(): ITaskHandle {
    // Transpiles to: xTaskGetCurrentTaskHandle()
    return this._tasks[0];
  }
  
  getAllTasks(): ITaskHandle[] {
    return this._tasks;
  }
  
  yield(): void {
    // Transpiles to: taskYIELD()
  }
  
  async sleep(milliseconds: number): Promise<void> {
    // Transpiles to: vTaskDelay(pdMS_TO_TICKS(milliseconds))
  }
  
  async sleepUntil(timestamp: number): Promise<void> {
    // Transpiles to: vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(delay))
  }
  
  inInterrupt(): boolean {
    // Transpiles to: xPortInIsrContext()
    return false;
  }
  
  getMillis(): number {
    // Transpiles to: millis() or xTaskGetTickCount() * portTICK_PERIOD_MS
    return 0;
  }
  
  getMicros(): number {
    // Transpiles to: micros() or esp_timer_get_time()
    return 0;
  }
}

/**
 * ESP32 Mutex (FreeRTOS)
 */
class ESP32Mutex implements IMutex {
  readonly name: string;
  private _handle: number;  // SemaphoreHandle_t
  
  constructor(name?: string) {
    this.name = name ?? 'mutex';
    // Transpiles to: this._handle = xSemaphoreCreateMutex();
  }
  
  get isLocked(): boolean {
    // Transpiles to: xSemaphoreGetMutexHolder(this._handle) != NULL
    return false;
  }
  
  async lock(): Promise<void> {
    // Transpiles to: xSemaphoreTake(this._handle, portMAX_DELAY)
  }
  
  tryLock(): boolean {
    // Transpiles to: return xSemaphoreTake(this._handle, 0) == pdTRUE;
    return false;
  }
  
  async tryLockWithTimeout(timeout: number): Promise<boolean> {
    // Transpiles to: return xSemaphoreTake(this._handle, pdMS_TO_TICKS(timeout)) == pdTRUE;
    return false;
  }
  
  unlock(): void {
    // Transpiles to: xSemaphoreGive(this._handle)
  }
  
  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.lock();
    try {
      return await fn();
    } finally {
      this.unlock();
    }
  }
}

/**
 * ESP32 Semaphore (FreeRTOS)
 */
class ESP32Semaphore implements ISemaphore {
  readonly name: string;
  readonly maxCount: number;
  private _handle: number;  // SemaphoreHandle_t
  
  constructor(maxCount: number, initialCount: number, name?: string) {
    this.name = name ?? 'semaphore';
    this.maxCount = maxCount;
    // Transpiles to: this._handle = xSemaphoreCreateCounting(maxCount, initialCount);
  }
  
  get count(): number {
    // Transpiles to: uxSemaphoreGetCount(this._handle)
    return 0;
  }
  
  async wait(): Promise<void> {
    // Transpiles to: xSemaphoreTake(this._handle, portMAX_DELAY)
  }
  
  tryWait(): boolean {
    // Transpiles to: return xSemaphoreTake(this._handle, 0) == pdTRUE;
    return false;
  }
  
  async waitWithTimeout(timeout: number): Promise<boolean> {
    // Transpiles to: return xSemaphoreTake(this._handle, pdMS_TO_TICKS(timeout)) == pdTRUE;
    return false;
  }
  
  signal(): void {
    // Transpiles to: xSemaphoreGive(this._handle)
  }
  
  getCount(): number {
    return this.count;
  }
}

/**
 * ESP32 Parallel execution (dual-core)
 */
const Parallel = {
  available: true,
  
  /**
   * Run function on Core 1 (app core)
   * Core 0 is typically used for WiFi/Bluetooth
   */
  run(callback: () => void): void {
    Task.create({
      name: 'parallel_task',
      run: callback,
      stackSize: 4096
    }, { core: 1, autoStart: true });
  },
  
  /**
   * Run function on specific core
   * @param core Core number (0 = protocol, 1 = application)
   */
  runOnCore(core: 0 | 1, callback: () => void): void {
    Task.create({
      name: `core${core}_task`,
      run: callback,
      stackSize: 4096
    }, { core: core, autoStart: true });
  }
};

// Lock factory for ESP32
const Lock: ILockFactory = {
  getCapabilities(): LockCapabilities {
    return {
      mutex: true,
      semaphore: true,
      spinlock: true,
      criticalSection: true
    };
  },
  
  createMutex(name?: string): IMutex {
    return new ESP32Mutex(name);
  },
  
  createSemaphore(maxCount: number, initialCount?: number, name?: string): ISemaphore {
    return new ESP32Semaphore(maxCount, initialCount ?? maxCount, name);
  },
  
  createBinarySemaphore(name?: string): IBinarySemaphore {
    // Transpiles to: xSemaphoreCreateBinary()
    return new ESP32Semaphore(1, 0, name) as IBinarySemaphore;
  },
  
  createSpinlock(name?: string): ISpinlock {
    // ESP32 supports spinlocks via portENTER_CRITICAL
    return {
      name: name ?? 'spinlock',
      
      acquire(): void {
        // Transpiles to: portENTER_CRITICAL(&spinlock)
      },
      
      release(): void {
        // Transpiles to: portEXIT_CRITICAL(&spinlock)
      },
      
      tryAcquire(): boolean {
        return false;
      }
    };
  },
  
  createCriticalSection(): ICriticalSection {
    return {
      enter(): void {
        // Transpiles to: taskENTER_CRITICAL()
      },
      
      exit(): void {
        // Transpiles to: taskEXIT_CRITICAL()
      }
    };
  },
  
  inCriticalSection<T>(fn: () => T): T {
    // Transpiles to:
    // taskENTER_CRITICAL();
    // T result = fn();
    // taskEXIT_CRITICAL();
    // return result;
    return fn();
  }
};
```

### RP2040 (Pico SDK)

```typescript
// src/@typecode/arch-rp2040/concurrency.ts

import { IScheduler, ITaskManager, ITaskHandle, TaskState, TaskPriority, IMutex, ISpinlock } from '@typecode/core';

/**
 * RP2040 supports dual-core symmetric execution
 * Core 0 runs main(), Core 1 needs to be launched
 */

/**
 * RP2040 Task Handle
 */
class RP2040TaskHandle implements ITaskHandle {
  readonly id: number;
  readonly name: string;
  readonly priority: TaskPriority;
  
  private _state: TaskState;
  private _callback: () => void;
  private _period: number;
  private _lastRun: number;
  private _core: number;
  
  constructor(
    id: number,
    name: string,
    callback: () => void,
    priority: TaskPriority,
    period: number,
    core: number
  ) {
    this.id = id;
    this.name = name;
    this._callback = callback;
    this.priority = priority;
    this._period = period;
    this._lastRun = 0;
    this._core = core;
    this._state = TaskState.READY;
  }
  
  get state(): TaskState {
    return this._state;
  }
  
  resume(): void {
    this._state = TaskState.READY;
  }
  
  suspend(): void {
    this._state = TaskState.SUSPENDED;
  }
  
  terminate(): void {
    this._state = TaskState.TERMINATED;
  }
  
  setPriority(priority: TaskPriority): void {
    // RP2040 uses cooperative scheduling, priority is informational
  }
  
  getStats(): TaskStats {
    return {
      name: this.name,
      state: this._state,
      priority: this.priority,
      runCount: 0,
      totalRunTime: 0,
      stackHighWaterMark: 0,
      core: this._core
    };
  }
  
  async join(): Promise<void> {
    while (this._state !== TaskState.TERMINATED) {
      await Task.sleep(10);
    }
  }
}

/**
 * RP2040 Task Manager
 */
class RP2040TaskManager implements ITaskManager {
  private _tasks: RP2040TaskHandle[] = [];
  private _nextId: number = 1;
  
  create(config: TaskConfig, options?: TaskCreateOptions): ITaskHandle {
    const core = options?.core ?? 0;
    const name = config.name ?? `task_${this._nextId}`;
    
    const task = new RP2040TaskHandle(
      this._nextId++,
      name,
      config.run as () => void,
      config.priority ?? TaskPriority.NORMAL,
      config.period ?? 0,
      core
    );
    
    this._tasks.push(task);
    return task;
  }
  
  createPeriodic(name: string, callback: () => void, period: number): ITaskHandle {
    return this.create({
      name: name,
      run: callback,
      period: period
    });
  }
  
  getCurrentTask(): ITaskHandle {
    return this._tasks[0];
  }
  
  getAllTasks(): ITaskHandle[] {
    return this._tasks;
  }
  
  yield(): void {
    // Transpiles to: yield() or __wfi()
  }
  
  async sleep(milliseconds: number): Promise<void> {
    // Transpiles to: sleep_ms(milliseconds) or busy_wait_ms()
  }
  
  async sleepUntil(timestamp: number): Promise<void> {
    const now = this.getMillis();
    const delay = timestamp - now;
    if (delay > 0) {
      await this.sleep(delay);
    }
  }
  
  inInterrupt(): boolean {
    // Check if in ISR context
    return false;
  }
  
  getMillis(): number {
    // Transpiles to: to_ms_since_boot(get_absolute_time())
    return 0;
  }
  
  getMicros(): number {
    // Transpiles to: get_absolute_time()
    return 0;
  }
}

/**
 * RP2040 Spinlock
 * Hardware spinlocks are available
 */
class RP2040Spinlock implements ISpinlock {
  readonly name: string;
  private _lockNum: number;
  
  constructor(name?: string) {
    this.name = name ?? 'spinlock';
    // Transpiles to: spin_lock_claim_unused(true)
    this._lockNum = 0;
  }
  
  acquire(): void {
    // Transpiles to: spin_lock_blocking(spin_lock_instance(this._lockNum))
  }
  
  release(): void {
    // Transpiles to: spin_unlock(spin_lock_instance(this._lockNum))
  }
  
  tryAcquire(): boolean {
    // Transpiles to: is_spin_locked() check + try lock
    return false;
  }
}

/**
 * RP2040 Parallel execution
 */
const Parallel = {
  available: true,
  
  /**
   * Run on Core 1
   */
  run(callback: () => void): void {
    // Transpiles to:
    // multicore_launch_core1(callback);
    // Or for more complex setup:
    // multicore_fifo_push_blocking((uintptr_t)callback);
    // multicore_launch_core1(core1_entry);
  },
  
  /**
   * Run on specific core
   */
  runOnCore(core: 0 | 1, callback: () => void): void {
    if (core === 0) {
      // Already on core 0, just call
      callback();
    } else {
      // Launch on core 1
      // Transpiles to: multicore_launch_core1(callback)
    }
  },
  
  /**
   * Push function to Core 1 queue
   */
  pushToCore1(callback: () => void): void {
    // Transpiles to: multicore_fifo_push_blocking((uintptr_t)callback)
  },
  
  /**
   * Pop function from Core 0 queue (call from Core 1)
   */
  popFromCore0(): (() => void) | null {
    // Transpiles to: multicore_fifo_pop_blocking()
    return null;
  }
};

// Lock factory for RP2040
const Lock: ILockFactory = {
  getCapabilities(): LockCapabilities {
    return {
      mutex: false,       // Use spinlocks instead
      semaphore: false,   // Use FIFO queues
      spinlock: true,     // Hardware spinlocks available
      criticalSection: true
    };
  },
  
  createMutex(name?: string): IMutex {
    // RP2040 doesn't have built-in mutex, use spinlock
    const spinlock = this.createSpinlock(name);
    return {
      name: spinlock.name,
      isLocked: false,
      
      async lock(): Promise<void> {
        spinlock.acquire();
      },
      
      tryLock(): boolean {
        return spinlock.tryAcquire();
      },
      
      async tryLockWithTimeout(timeout: number): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (spinlock.tryAcquire()) return true;
        }
        return false;
      },
      
      unlock(): void {
        spinlock.release();
      },
      
      async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
        spinlock.acquire();
        try {
          return await fn();
        } finally {
          spinlock.release();
        }
      }
    };
  },
  
  createSemaphore(maxCount: number, initialCount?: number, name?: string): ISemaphore {
    throw new Error('Semaphore not directly supported on RP2040. Use Queue instead.');
  },
  
  createBinarySemaphore(name?: string): IBinarySemaphore {
    throw new Error('Binary semaphore not directly supported on RP2040. Use Queue instead.');
  },
  
  createSpinlock(name?: string): ISpinlock {
    return new RP2040Spinlock(name);
  },
  
  createCriticalSection(): ICriticalSection {
    return {
      enter(): void {
        // Transpiles to: save_and_disable_interrupts()
      },
      
      exit(): void {
        // Transpiles to: restore_interrupts()
      }
    };
  },
  
  inCriticalSection<T>(fn: () => T): T {
    // Transpiles to:
    // uint32_t _save = save_and_disable_interrupts();
    // T result = fn();
    // restore_interrupts(_save);
    // return result;
    return fn();
  }
};
```

---

## Usage Examples

### Periodic Task

```typescript
import { Task, Scheduler } from '@typecode/core';

// Create a periodic task that runs every 1000ms
Task.createPeriodic('heartbeat', function heartbeatTask() {
  Board.LED.toggle();
}, 1000);

Scheduler.start();
```

### Multi-Core on ESP32

```typescript
import { Parallel, Task, Lock } from '@typecode/core';

// Shared resource
const sharedData = { value: 0 };
const mutex = Lock.createMutex('data_mutex');

// Run on Core 1
Parallel.runOnCore(1, function core1Task() {
  while (true) {
    mutex.lock().then(function() {
      sharedData.value++;
      console.log('Core 1: ' + sharedData.value);
    }).finally(function() {
      mutex.unlock();
    });
    Task.sleep(500);
  }
});

// Main loop on Core 0
while (true) {
  mutex.lock().then(function() {
    console.log('Core 0 reads: ' + sharedData.value);
  }).finally(function() {
    mutex.unlock();
  });
  Task.sleep(1000);
}
```

### Critical Section on AVR

```typescript
import { Lock } from '@typecode/core';

// Shared data accessed from ISR and main loop
let encoderCount = 0;

// In main code - safely read the count
function getEncoderCount(): number {
  return Lock.inCriticalSection(function() {
    return encoderCount;
  });
}

// Encoder ISR increments count
function encoderISR() {
  encoderCount++;
}
```

---

## Next Steps

- **[04-memory-decorators.md](./04-memory-decorators.md)** - Memory placement control
- **[05-board-definitions.md](./05-board-definitions.md)** - Board manifest format