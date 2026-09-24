// ---------------------------------------------------------------------------
// trace CLI — `typecad-hal trace capture|report`
//
// capture: read [TR: heartbeat lines from the board's serial port into a
//   typecad-hal/trace@1 artifact (default ./trace.json). Requires a build
//   with zephyr.trace.enabled in typecad-hal.config.ts.
// report: summarize a capture — per-thread CPU load (avg/max) and stack
//   high-water marks — as a console table or --json.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import path from 'node:path';
import { captureTrace, writeTraceCapture } from './capture.js';
import { buildTraceReport, formatTraceReport, readTraceCapture, evaluateGates } from './report.js';
import { listUsbSerialPorts, formatPortTable } from '../test-runner/port-discovery.js';
import * as ui from '../utils/ui.js';

export interface TraceCaptureArgs {
  port?: string;
  baudRate: number;
  durationSeconds?: number;
  output: string;
}

export async function runTraceCapture(args: TraceCaptureArgs): Promise<number> {
  const port = args.port ?? process.env.TYPECAD_HAL_PORT;
  if (!port) {
    // No port given: list what's attached so the retry is copy-paste easy.
    const ports = await listUsbSerialPorts();
    console.error(
      'No serial port given. Pass --port <COM10|/dev/ttyACM0> or set TYPECAD_HAL_PORT.' +
      (ports.length > 0 ? `\nAttached serial ports:\n${formatPortTable(ports)}` : ''),
    );
    return 1;
  }

  if (!existsSync('typecad-hal.config.ts')) {
    // Advisory only — the artifact is portable and the config may live in a
    // parent directory; the hard failure mode is simply "no [TR: lines".
    ui.printInfo('No typecad-hal.config.ts in this directory — confirm the flashed build has zephyr.trace.enabled.');
  }

  console.log(`Capturing trace heartbeats from ${port} @ ${args.baudRate} baud —` +
    (args.durationSeconds && args.durationSeconds > 0
      ? ` ${args.durationSeconds}s (Ctrl+C to stop early).`
      : ' Ctrl+C to stop.'));

  const result = await captureTrace({
    port,
    baudRate: args.baudRate,
    durationSeconds: args.durationSeconds,
    // The output doubles as the live file for `trace view` (rewritten after
    // every closed heartbeat; the final write below is authoritative).
    liveWritePath: args.output,
    onHeartbeat: (sampleCount, tMs, threadCount) => {
      process.stdout.write(`  heartbeat ${sampleCount} (t=${tMs}ms, ${threadCount} threads)\r`);
    },
  });

  writeTraceCapture(args.output, result.capture);
  const samples = result.capture.samples.length;
  console.log(`\nWrote ${args.output} — ${samples} sample${samples === 1 ? '' : 's'}` +
    (result.otherLineCount > 0 ? `, ${result.otherLineCount} non-trace lines ignored` : '') +
    (result.malformedLines > 0 ? `, ${result.malformedLines} malformed [TR: lines` : '') +
    ` (stopped by ${result.stoppedBy}).`);

  if (samples === 0) {
    console.error(
      'No [TR: heartbeat lines were received. Confirm the firmware was built with\n' +
      'zephyr.trace: { enabled: true } in typecad-hal.config.ts and rebuilt + reflashed.',
    );
    return 1;
  }
  return 0;
}

export interface TraceReportArgs {
  input: string;
  json: boolean;
  /** CI gate expressions (repeatable) — exit 1 on any violation. */
  gates?: string[];
}

export function runTraceReport(args: TraceReportArgs): number {
  const input = path.resolve(process.cwd(), args.input);
  if (!existsSync(input)) {
    console.error(`No trace capture at ${input} — run 'typecad-hal trace capture' first.`);
    return 1;
  }
  const capture = readTraceCapture(input);
  const report = buildTraceReport(capture);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTraceReport(report));
  }
  if (args.gates !== undefined && args.gates.length > 0) {
    const gateResult = evaluateGates(report, args.gates);
    if (!gateResult.pass) {
      for (const v of gateResult.violations) console.error(`✗ gate failed: ${v}`);
      return 1;
    }
    if (!args.json) console.log(`✓ ${args.gates.length} trace gate${args.gates.length === 1 ? '' : 's'} passed`);
  }
  return 0;
}
