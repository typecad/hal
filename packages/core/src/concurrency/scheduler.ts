// ---------------------------------------------------------------------------
// @typehal/core — Scheduler and timer interfaces
// ---------------------------------------------------------------------------

import type { ITaskHandle } from './task';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface SchedulerConfig {
  tickInterval?: number;
  enableStats?: boolean;
  maxTasks?: number;
  idleCallback?: () => void;
}

export interface SchedulerStats {
  totalTicks: number;
  contextSwitches: number;
  idleTimePercent: number;
  activeTaskCount: number;
  tickRate: number;
}

export interface IScheduler {
  initialize(config?: SchedulerConfig): void;
  start(): void;
  stop(): void;
  isRunning(): boolean;
  getTickCount(): number;
  getMillis(): number;
  getMicros(): number;
  getStats(): SchedulerStats;
  onTaskComplete(callback: (task: ITaskHandle) => void): void;
  onTaskError(callback: (task: ITaskHandle, error: Error) => void): void;
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

export interface TimerConfig {
  period: number;
  callback: () => void;
  autoStart?: boolean;
  repeat?: boolean;
}

export interface ITimer {
  readonly id: number;
  readonly isActive: boolean;

  start(): void;
  stop(): void;
  reset(): void;
  setPeriod(ms: number): void;
  getRemaining(): number;
}

export interface ITimerManager {
  create(config: TimerConfig): ITimer;
  createOneShot(delay: number, callback: () => void): ITimer;
  createPeriodic(period: number, callback: () => void): ITimer;
  getActiveTimers(): ITimer[];
  destroy(timer: ITimer): void;
}
