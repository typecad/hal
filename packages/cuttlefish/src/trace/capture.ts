// ---------------------------------------------------------------------------
// Trace capture — read [TR: lines from the device console into trace.json
//
// Opens the board's serial port (USB CDC or UART — the same channel the test
// runner uses), feeds every line to TraceLineParser, and stops on --duration
// or Ctrl+C. The artifact (schema typecad-hal/trace@1) is written even when
// the stop was a signal — a partial capture is evidence, not garbage.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { TraceLineParser } from './protocol.js';
import type { TraceCapture } from './types.js';

export interface CaptureOptions {
  port: string;
  baudRate?: number;
  /** Capture length in seconds; 0/undefined = until interrupted. */
  durationSeconds?: number;
  /** Called after each closed heartbeat for live progress. */
  onHeartbeat?: (sampleCount: number, tMs: number, threadCount: number) => void;
  /** When set, the artifact is rewritten after every closed heartbeat so a
   *  viewer (trace view) can poll the file for live updates. */
  liveWritePath?: string;
}

export interface CaptureResult {
  capture: TraceCapture;
  /** Non-protocol console lines seen (debug prints, boot messages). */
  otherLineCount: number;
  /** [TR: lines that failed to parse. */
  malformedLines: number;
  /** Why the capture ended. */
  stoppedBy: 'duration' | 'signal' | 'error';
  error?: string;
}

/**
 * Capture trace heartbeat lines from the device. Resolves when the duration
 * expires, the process is interrupted (SIGINT), or the port errors out.
 */
export async function captureTrace(options: CaptureOptions): Promise<CaptureResult> {
  const { SerialPort } = await import('serialport');
  const baudRate = options.baudRate ?? 115200;
  const parser = new TraceLineParser();
  let otherLines = 0;
  let pending = '';
  let stoppedBy: CaptureResult['stoppedBy'] = 'duration';
  let captureError: string | undefined;

  const capture: TraceCapture = {
    schema: 'typecad-hal/trace@1',
    capturedAt: new Date().toISOString(),
    port: options.port,
    baudRate,
    intervalMs: null,
    samples: [],
  };

  const durationMs = (options.durationSeconds ?? 0) > 0
    ? Math.round((options.durationSeconds as number) * 1000)
    : 0;

  return new Promise<CaptureResult>((resolve) => {
    let resolved = false;
    // Signal registration must be removable — a capture embedded in a longer
    // process must not leave a SIGINT handler behind.
    const onSignal = () => finish('signal');
    const timers: NodeJS.Timeout[] = [];

    const finish = (by: CaptureResult['stoppedBy'], error?: string) => {
      if (resolved) return;
      resolved = true;
      stoppedBy = by;
      captureError = error;
      for (const t of timers) clearTimeout(t);
      process.removeListener('SIGINT', onSignal);
      // Strip data listeners but keep a no-op error handler: a USB dropout
      // mid-close emits 'error' after removal and an unhandled 'error' event
      // kills the process (the same trap the test-runner reader guards).
      sp.removeAllListeners();
      sp.on('error', () => {});
      if (sp.isOpen) {
        sp.close(() => resolveDone());
      } else {
        try {
          sp.close();
        } catch {
          // ignore close errors for unopened ports
        }
        resolveDone();
      }
    };

    const resolveDone = () => {
      capture.samples = parser.finish();
      if (parser.meta !== null) capture.intervalMs = parser.meta.intervalMs;
      const events = parser.eventList;
      if (events.length > 0) capture.events = [...events];
      const alarms = parser.alarmList;
      if (alarms.length > 0) capture.alarms = [...alarms];
      resolve({
        capture,
        otherLineCount: otherLines,
        malformedLines: parser.malformed,
        stoppedBy,
        error: captureError,
      });
    };

    const handleLine = (line: string) => {
      const before = parser.sampleCount;
      const trimmed = line.trim();
      if (!trimmed.startsWith('[TR:')) {
        if (trimmed.length > 0) otherLines++;
      }
      parser.feed(line);
      if (parser.sampleCount > before) {
        const last = parser.peekLastSample();
        if (last !== null) {
          options.onHeartbeat?.(parser.sampleCount, last.tMs, last.threads.length);
        }
        // Live rewrite for the viewer: the file always holds a complete,
        // valid artifact (the in-flight sample group is excluded until
        // closed, so a concurrent reader never sees a partial heartbeat —
        // and the parser state is NOT disturbed; snapshot() is read-only).
        if (options.liveWritePath !== undefined) {
          capture.samples = parser.snapshot();
          const events = parser.eventList;
          if (events.length > 0) capture.events = [...events];
          const alarms = parser.alarmList;
          if (alarms.length > 0) capture.alarms = [...alarms];
          try {
            writeTraceCapture(options.liveWritePath, capture);
          } catch {
            // best-effort — the final write at capture end is authoritative
          }
        }
      }
    };

    const handleChunk = (chunk: Buffer | string) => {
      pending += chunk.toString();
      while (true) {
        const lf = pending.indexOf('\n');
        const cr = pending.indexOf('\r');
        const indexes = [lf, cr].filter((i) => i >= 0);
        if (indexes.length === 0) break;
        const next = Math.min(...indexes);
        const delimiter = pending[next];
        const line = pending.slice(0, next);
        pending = pending.slice(next + 1);
        if (delimiter === '\r' && pending.startsWith('\n')) {
          pending = pending.slice(1);
        }
        handleLine(line);
      }
    };

    const sp = new SerialPort({ path: options.port, baudRate, autoOpen: false });

    if (durationMs > 0) {
      timers.push(setTimeout(() => finish('duration'), durationMs));
    }
    process.on('SIGINT', onSignal);

    sp.on('data', handleChunk);

    // A CDC console that just re-enumerated after a flash can be LISTED but
    // not yet OPENABLE for several seconds (Windows usbser SetCommState error
    // 31 while the driver state settles) — the same retry the test-runner
    // reader performs.
    const OPEN_RETRIES = 16;
    const OPEN_RETRY_MS = 750;
    let openRetriesLeft = OPEN_RETRIES;

    const tryOpen = () => {
      sp.open((err: Error | null) => {
        if (!err) {
          sp.on('error', (err2: Error) => finish('error', `Serial error: ${err2.message}`));
          return;
        }
        if (openRetriesLeft-- > 0) {
          timers.push(setTimeout(tryOpen, OPEN_RETRY_MS));
          return;
        }
        finish('error', `Failed to open ${options.port}: ${err.message}`);
      });
    };

    tryOpen();
  });
}

/** Write a capture artifact. */
export function writeTraceCapture(filePath: string, capture: TraceCapture): void {
  writeFileSync(filePath, JSON.stringify(capture, null, 2) + '\n');
}
