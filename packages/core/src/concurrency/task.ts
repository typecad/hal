// ---------------------------------------------------------------------------
// @typecode/core — Task management
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum TaskState {
  READY      = 'READY',
  RUNNING    = 'RUNNING',
  BLOCKED    = 'BLOCKED',
  SUSPENDED  = 'SUSPENDED',
  TERMINATED = 'TERMINATED',
}

export enum TaskPriority {
  IDLE     = 0,
  LOW      = 1,
  NORMAL   = 2,
  HIGH     = 3,
  REALTIME = 4,
}

// ---------------------------------------------------------------------------
// Configuration & stats
// ---------------------------------------------------------------------------

export interface TaskConfig {
  name?: string;
  priority?: TaskPriority;
  stackSize?: number;
  core?: number;
  run: () => Promise<void> | void;
  delay?: number;
  period?: number;
}

export interface TaskCreateOptions {
  autoStart?: boolean;
  core?: 0 | 1;
}

export interface TaskStats {
  name: string;
  state: TaskState;
  priority: TaskPriority;
  runCount: number;
  totalRunTime: number;
  stackHighWaterMark?: number;
  core?: number;
}

// ---------------------------------------------------------------------------
// Task handle
// ---------------------------------------------------------------------------

export interface ITaskHandle {
  readonly id: number;
  readonly name: string;
  readonly state: TaskState;
  readonly priority: TaskPriority;

  resume(): void;
  suspend(): void;
  terminate(): void;
  setPriority(priority: TaskPriority): void;
  getStats(): TaskStats;
  join(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Task manager
// ---------------------------------------------------------------------------

export interface ITaskManager {
  create(config: TaskConfig, options?: TaskCreateOptions): ITaskHandle;
  createPeriodic(name: string, callback: () => void, period: number): ITaskHandle;
  getCurrentTask(): ITaskHandle | undefined;
  getAllTasks(): ITaskHandle[];
  yield(): void;
  sleep(ms: number): Promise<void>;
  sleepUntil(timestamp: number): Promise<void>;
  inInterrupt(): boolean;
}
