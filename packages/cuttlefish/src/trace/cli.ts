// ---------------------------------------------------------------------------
// trace CLI — `typecad-hal trace capture|report|view`
//
// capture: the agent-friendly one-command loop. Preflight the last build for
//   the sampler's Kconfig (untraced firmware → exit 2 with the rebuild
//   remedy, BEFORE burning the duration), optionally --flash first, auto-pick
//   the lone serial port, then read [TR: heartbeat lines into a
//   typecad-hal/trace@1 artifact (default ./trace.json) and evaluate --gate /
//   --gates-file expressions in the same process — exit 0/1 is the verdict.
//   Progress goes to stderr; stdout carries the summary (a single JSON line
//   with --quiet), so captures pipe cleanly.
// report: summarize a capture — CPU load, stack high-water marks, UI frame +
//   tick-phase stats, --worst N spike intervals, and the same gates.
// view:   serve the timeline viewer over a capture file.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { captureTrace, writeTraceCapture } from './capture.js';
import {
  buildTraceReport, formatTraceReport, readTraceCapture, evaluateGates,
  buildWorstIntervals, formatWorstIntervals,
} from './report.js';
import { listUsbSerialPorts, formatPortTable } from '../test-runner/port-discovery.js';
import { preflightTracedBuild, parseGatesFile, pickAutoPort } from './preflight.js';
import * as ui from '../utils/ui.js';

export interface TraceCaptureArgs {
  port?: string;
  baudRate?: number;
  durationSeconds?: number;
  output: string;
  /** Progress to stderr only; stdout is a single JSON summary line. */
  quiet?: boolean;
  /** Run `typecad-hal build --compile --upload` before capturing. */
  flash?: boolean;
  /** Gate expressions evaluated after the capture (exit 1 on violation). */
  gates?: string[];
  /** Gates file ({ "gates": [...] } or a bare array), merged with --gate. */
  gatesFile?: string;
  /** Working directory for build preflight + relative paths. */
  cwd?: string;
}

/** Resolve the serial port: flag > TYPECAD_HAL_PORT > the lone attached port.
 *  Returns undefined after printing why it cannot proceed. */
async function resolvePort(explicit?: string): Promise<string | undefined> {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  if (process.env.TYPECAD_HAL_PORT) return process.env.TYPECAD_HAL_PORT;
  let ports: string[] = [];
  try {
    ports = (await listUsbSerialPorts()).map((p) => p.path);
  } catch {
    ports = [];
  }
  const auto = pickAutoPort(ports);
  if (auto !== undefined) {
    console.error(`No --port given — using the only attached serial port: ${auto}`);
    return auto;
  }
  console.error(
    'No serial port given (and not exactly one attached). Pass --port <COM10|/dev/ttyACM0>'
    + ' or set TYPECAD_HAL_PORT.'
    + (ports.length > 0 ? `\nAttached serial ports:\n${formatPortTable(await listUsbSerialPorts())}` : ''),
  );
  return undefined;
}

export async function runTraceCapture(args: TraceCaptureArgs): Promise<number> {
  const cwd = args.cwd ?? process.cwd();
  const port = await resolvePort(args.port);
  if (!port) return 1;

  // --flash: rebuild + reflash through the same CLI (one command from source
  // change to capture). Failure short-circuits with the build's own output.
  if (args.flash === true) {
    const cliJs = path.join(__dirname, 'cli.js');
    console.error(`⇉ Rebuilding + flashing (typecad-hal build --compile --upload --port ${port})…`);
    const built = spawnSync(process.execPath, [cliJs, 'build', '--compile', '--upload', '--port', port], {
      cwd,
      stdio: 'inherit',
    });
    if (built.status !== 0) {
      console.error(`✗ Build/flash failed (exit ${built.status}) — not capturing.`);
      return built.status ?? 1;
    }
  }

  // Preflight: an untraced firmware produces a silent empty capture — fail
  // fast with the remedy instead. A missing build dir only warns.
  const pre = preflightTracedBuild(cwd);
  if (pre.status === 'untraced') {
    console.error(
      `✗ The last build (${path.relative(cwd, pre.configPath ?? '')}) has no trace sampler — a capture would see no [TR: lines.\n` +
      '  Enable zephyr.trace in typecad-hal.config.ts, then rebuild + reflash:\n' +
      `    npx typecad-hal build --compile --upload --port ${port}\n` +
      '  (or re-run with --flash to do both in one command)',
    );
    return 2;
  }
  if (pre.status === 'no-build') {
    console.error('! No build directory found — cannot preflight the firmware for tracing.');
  }

  if (!existsSync('typecad-hal.config.ts')) {
    ui.printInfo('No typecad-hal.config.ts in this directory — confirm the flashed build has zephyr.trace.enabled.');
  }

  console.error(`Capturing trace heartbeats from ${port} @ ${args.baudRate ?? 115200} baud —`
    + (args.durationSeconds && args.durationSeconds > 0
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
      process.stderr.write(`  heartbeat ${sampleCount} (t=${tMs}ms, ${threadCount} threads)\r`);
    },
  });

  writeTraceCapture(args.output, result.capture);
  const samples = result.capture.samples.length;
  const gates = gatesFor(args);
  if (args.quiet === true) {
    const summary: Record<string, unknown> = {
      file: args.output, samples, port,
      otherLines: result.otherLineCount, malformed: result.malformedLines,
      stoppedBy: result.stoppedBy,
    };
    if (samples > 0) {
      const report = buildTraceReport(result.capture);
      const gateResult = gates.length > 0 ? evaluateGates(report, gates) : undefined;
      summary.gates = gates;
      summary.gatesPassed = gateResult?.pass;
      summary.gateViolations = gateResult?.violations ?? [];
    }
    console.log(JSON.stringify(summary));
  } else {
    console.log(`\nWrote ${args.output} — ${samples} sample${samples === 1 ? '' : 's'}`
      + (result.otherLineCount > 0 ? `, ${result.otherLineCount} non-trace lines ignored` : '')
      + (result.malformedLines > 0 ? `, ${result.malformedLines} malformed [TR: lines` : '')
      + ` (stopped by ${result.stoppedBy}).`);
  }

  if (samples === 0) {
    console.error(
      'No [TR: heartbeat lines were received. Confirm the firmware was built with\n' +
      'zephyr.trace: { enabled: true } in typecad-hal.config.ts and rebuilt + reflashed.',
    );
    return 1;
  }

  // One-command verdict: gates evaluated over the fresh capture.
  if (gates.length > 0) {
    const report = buildTraceReport(result.capture);
    const gateResult = evaluateGates(report, gates);
    if (!gateResult.pass) {
      for (const v of gateResult.violations) console.error(`✗ gate failed: ${v}`);
      return 1;
    }
    console.error(`✓ ${gates.length} trace gate${gates.length === 1 ? '' : 's'} passed`);
  }
  return 0;
}

/** Merge --gate expressions with a --gates-file (file load errors throw). */
function gatesFor(args: TraceCaptureArgs): string[] {
  const gates = [...(args.gates ?? [])];
  if (args.gatesFile !== undefined) {
    gates.unshift(...parseGatesFile(readFileSync(path.resolve(args.cwd ?? process.cwd(), args.gatesFile), 'utf8'), args.gatesFile));
  }
  return gates;
}

export interface TraceReportArgs {
  input: string;
  json: boolean;
  /** CI gate expressions (repeatable) — exit 1 on any violation. */
  gates?: string[];
  /** Gates file, merged with --gate. */
  gatesFile?: string;
  /** Show the top-N spike intervals (by worst frame / top thread CPU). */
  worst?: number;
}

export function runTraceReport(args: TraceReportArgs): number {
  const input = path.resolve(process.cwd(), args.input);
  if (!existsSync(input)) {
    console.error(`No trace capture at ${input} — run 'typecad-hal trace capture' first.`);
    return 1;
  }
  const capture = readTraceCapture(input);
  const report = buildTraceReport(capture);
  const gates = [...(args.gates ?? [])];
  if (args.gatesFile !== undefined) {
    gates.unshift(...parseGatesFile(readFileSync(path.resolve(process.cwd(), args.gatesFile), 'utf8'), args.gatesFile));
  }
  const worst = args.worst !== undefined && args.worst > 0
    ? buildWorstIntervals(capture, args.worst)
    : undefined;
  if (args.json) {
    console.log(JSON.stringify({ ...report, ...(worst !== undefined ? { worst } : {}) }, null, 2));
  } else {
    console.log(formatTraceReport(report));
    if (worst !== undefined && worst.length > 0) {
      console.log();
      console.log(formatWorstIntervals(worst));
    }
  }
  if (gates.length > 0) {
    const gateResult = evaluateGates(report, gates);
    if (!gateResult.pass) {
      for (const v of gateResult.violations) console.error(`✗ gate failed: ${v}`);
      return 1;
    }
    if (!args.json) console.log(`✓ ${gates.length} trace gate${gates.length === 1 ? '' : 's'} passed`);
  }
  return 0;
}
