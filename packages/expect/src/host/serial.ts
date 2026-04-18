// ---------------------------------------------------------------------------
// @typecode/expect — Serial reader
//
// Opens a serial port after firmware upload, reads lines until [TC:SUITE_END]
// or timeout.  Filters protocol lines from debug output.
// ---------------------------------------------------------------------------

import { PROTOCOL_PREFIX } from './types';

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
): Promise<SerialReadResult> {
  // Dynamic import — serialport is a native dependency
  const { SerialPort } = await import('serialport');
  const { ReadlineParser } = await import('@serialport/parser-readline');

  const protocolLines: string[] = [];
  const debugLines: string[] = [];
  let completed = false;

  return new Promise<SerialReadResult>((resolve) => {
    let resolved = false;

    const finish = (error?: string) => {
      if (resolved) return;
      resolved = true;
      try { sp.close(); } catch { /* ignore close errors */ }
      clearTimeout(timer);
      resolve({ protocolLines, debugLines, completed, error });
    };

    // Open serial port
    const sp = new SerialPort({ path: port, baudRate, autoOpen: false });
    const parser = sp.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    // Timeout guard
    const timer = setTimeout(() => {
      finish(completed ? undefined : `Timeout after ${timeoutMs}ms — no [TC:SUITE_END] received`);
    }, timeoutMs);

    parser.on('data', (line: string) => {
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
    });

    sp.on('error', (err: Error) => {
      finish(`Serial error: ${err.message}`);
    });

    // Give the device time to reset after upload (Arduino resets on serial open)
    setTimeout(() => {
      sp.open((err: Error | null) => {
        if (err) {
          finish(`Failed to open ${port}: ${err.message}`);
        }
      });
    }, 500);
  });
}
