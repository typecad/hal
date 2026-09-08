// ---------------------------------------------------------------------------
// cuttlefish test-runner — Serial reader
//
// Opens a serial port after firmware upload, reads lines until [TC:SUITE_END]
// or timeout.  Filters protocol lines from debug output.
// ---------------------------------------------------------------------------

import { PROTOCOL_PREFIX } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SerialReadResult {
  /** Lines starting with [TC: — the protocol data. */
  protocolLines: string[];
  /** All other serial output — debug prints, boot messages, etc. */
  debugLines: string[];
  /** Whether SUITE_END was received before timeout. */
  completed: boolean;
  /** If the read was cut short by an error. */
  error?: string;
}

export interface SerialReadOptions {
  /** Toggle ESP32-style DTR/RTS reset after the port is open and listeners are attached. */
  resetAfterOpen?: boolean;
  /** How long to hold reset active when resetAfterOpen is enabled. */
  resetPulseMs?: number;
}

/**
 * Read serial output from the device and separate protocol lines from debug.
 *
 * Uses the `serialport` npm package.  The port is opened, data is accumulated
 * line-by-line.  Reading stops when a `[TC:SUITE_END]` line is received or
 * the timeout expires.
 *
 * @param port     Serial port path (e.g. `'COM3'`, `'/dev/ttyACM0'`).
 * @param baudRate Baud rate — must match what the preprocessor emits.
 * @param timeoutMs How long to wait for SUITE_END.
 */
export async function readSerialOutput(
  port: string,
  baudRate: number,
  timeoutMs: number,
  serialOpenDelay = 500,
  options: SerialReadOptions = {},
): Promise<SerialReadResult> {
  // Dynamic import — serialport is a native dependency
  const { SerialPort } = await import('serialport');

  const protocolLines: string[] = [];
  const debugLines: string[] = [];
  let completed = false;
  let pending = '';

  return new Promise<SerialReadResult>((resolve) => {
    let resolved = false;

    const cleanup = (callback: () => void) => {
      // Strip the data/close listeners, but keep (re-attach) a no-op error
      // handler: a USB dropout mid-close emits 'error' after the removal,
      // and an 'error' event with no listener throws and kills the process
      // — the exact failure a nightly rig must survive.
      sp.removeAllListeners();
      sp.on('error', () => {});

      if (sp.isOpen) {
        sp.close(() => callback());
      } else {
        try {
          sp.close();
        } catch {
          // ignore close errors for unopened ports
        }
        callback();
      }
    };

    const finish = (error?: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup(() => resolve({ protocolLines, debugLines, completed, error }));
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (trimmed.startsWith(PROTOCOL_PREFIX)) {
        protocolLines.push(trimmed);
        if (trimmed.includes('SUITE_END')) {
          completed = true;
          // Give a brief delay for any trailing output
          setTimeout(() => finish(), 200);
        }
      } else if (trimmed.length > 0) {
        debugLines.push(trimmed);
      }
    };

    const handleChunk = (chunk: Buffer | string) => {
      pending += chunk.toString();

      while (true) {
        const lf = pending.indexOf('\n');
        const cr = pending.indexOf('\r');
        const indexes = [lf, cr].filter(i => i >= 0);
        if (indexes.length === 0) break;

        const next = Math.min(...indexes);
        const delimiter = pending[next];
        const line = pending.slice(0, next);
        pending = pending.slice(next + 1);

        // Treat CRLF as one newline.
        if (delimiter === '\r' && pending.startsWith('\n')) {
          pending = pending.slice(1);
        }

        handleLine(line);
      }
    };

    const resetAfterOpen = options.resetAfterOpen ?? false;
    const resetPulseMs = options.resetPulseMs ?? 100;

    const resetBoard = () => {
      if (!resetAfterOpen) return;

      // ESP32 DevKit boards use RTS for EN/reset and DTR for GPIO0/boot.
      // Keep GPIO0 high (DTR false), pulse EN low (RTS true), then release.
      sp.set({ dtr: false, rts: true }, (assertErr) => {
        if (assertErr) {
          finish(`Failed to assert serial reset on ${port}: ${assertErr.message}`);
          return;
        }
        setTimeout(() => {
          sp.set({ dtr: false, rts: false }, (releaseErr) => {
            if (releaseErr) {
              finish(`Failed to release serial reset on ${port}: ${releaseErr.message}`);
            }
          });
        }, resetPulseMs);
      });
    };

    // Open serial port
    const sp = new SerialPort({ path: port, baudRate, autoOpen: false });

    // Timeout guard
    const timer = setTimeout(() => {
      if (pending.trim().length > 0) {
        handleLine(pending);
        pending = '';
      }
      finish(completed ? undefined : `Timeout after ${timeoutMs}ms — no [TC:SUITE_END] received`);
    }, timeoutMs);

    sp.on('data', handleChunk);

    // A CDC console that just re-enumerated after a flash can be LISTED but
    // not yet OPENABLE for several seconds — Windows usbser returns
    // SetCommState error 31 while the PDO/driver state from the flash-cycle
    // detach/attach settles. Retry the open generously (the firmware's boot
    // DTR-wait holds all protocol output until the host opens, so a long
    // window loses nothing).
    const OPEN_RETRIES = 16;
    const OPEN_RETRY_MS = 750;
    let openRetriesLeft = OPEN_RETRIES;

    const tryOpen = () => {
      sp.open((err: Error | null) => {
        if (!err) {
          // Only now can open-lifecycle errors surface as events (open
          // failures above arrive via the callback, not 'error').
          sp.on('error', (err: Error) => {
            finish(`Serial error: ${err.message}`);
          });
          resetBoard();
          return;
        }
        if (openRetriesLeft-- > 0) {
          setTimeout(tryOpen, OPEN_RETRY_MS);
          return;
        }
        finish(`Failed to open ${port}: ${err.message}`);
      });
    };

    // Give the device time to reset after upload (many boards reset on serial open)
    setTimeout(tryOpen, serialOpenDelay);
  });
}
