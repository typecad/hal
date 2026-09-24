// ---------------------------------------------------------------------------
// trace-core.test.ts — the pure half of the Trace panel: capture shape
// checking, the per-interval timeline math (delta CPU vs the sys-cycle
// denominator, UI frames + phase spans), and the webview page contract.
// The module imports no 'vscode' (the board-facts.ts pattern), so the
// monorepo suite exercises it directly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readCapture, buildTimelineData, viewerHtml } from '../../../packages/vscode-typecad-hal/src/trace-core';

const CAPTURE_JSON = JSON.stringify({
  schema: 'typecad-hal/trace@1',
  capturedAt: '2026-09-23T00:00:00Z',
  port: 'COM10',
  baudRate: 115200,
  intervalMs: 1000,
  samples: [
    { seq: 1, tMs: 1000, sysExecCycles: 1000000, ui: { frameCount: 60, avgFrameMsX10: 16, maxFrameMs: 33, phasesUs: [120, 45, 600, 80, 210] },
      threads: [
        { name: 'main', execCycles: 100000, stackUnusedBytes: 900, stackSizeBytes: 1024 },
        { name: 'idle', execCycles: 800000, stackUnusedBytes: 200, stackSizeBytes: 256 },
      ] },
    { seq: 2, tMs: 2000, sysExecCycles: 2000000, ui: { frameCount: 60, avgFrameMsX10: 20, maxFrameMs: 21, phasesUs: [130, 50, 640, 85, 220] },
      threads: [
        { name: 'main', execCycles: 300000, stackUnusedBytes: 512, stackSizeBytes: 1024 },
        { name: 'idle', execCycles: 1600000, stackUnusedBytes: 200, stackSizeBytes: 256 },
      ] },
  ],
  events: [
    { tMs: 1100, name: 'boot' },
    { tMs: 1500, name: 'beat', value: 1 },
  ],
});

describe('readCapture', () => {
  it('parses a trace@1 capture', () => {
    const c = readCapture(CAPTURE_JSON);
    expect(c?.schema).toBe('typecad-hal/trace@1');
    expect(c?.samples).toHaveLength(2);
    expect(c?.events?.[1].value).toBe(1);
  });

  it('rejects other JSON, partial writes, and non-JSON (the watcher sees those mid-write)', () => {
    expect(readCapture('{"schema":"typecad-hal/security-audit@1"}')).toBeUndefined();
    expect(readCapture('{"schema":"typecad-hal/trace@1"}')).toBeUndefined(); // no samples
    expect(readCapture('{"schema":"typecad-hal/tra')).toBeUndefined();
  });
});

describe('buildTimelineData', () => {
  it('computes per-interval CPU against the sys counter; idle is its own lane', () => {
    const d = buildTimelineData(readCapture(CAPTURE_JSON)!);
    expect(d.sampleCount).toBe(2);
    expect(d.points).toHaveLength(1);
    expect(d.points[0].cpu.main).toBe(20);
    expect(d.points[0].cpu.idle).toBe(80);
    expect(d.events).toHaveLength(2);
  });

  it('carries UI frame stats + the five phase spans', () => {
    const d = buildTimelineData(readCapture(CAPTURE_JSON)!);
    expect(d.points[0].ui).toEqual({ avgFrameMs: 2, maxFrameMs: 21, phasesUs: [130, 50, 640, 85, 220] });
  });

  it('degrades to empty points on a single-sample capture', () => {
    const one = { ...JSON.parse(CAPTURE_JSON), samples: [JSON.parse(CAPTURE_JSON).samples[0]] };
    const d = buildTimelineData(one);
    expect(d.points).toHaveLength(0);
    expect(d.sampleCount).toBe(1);
  });
});

describe('viewerHtml', () => {
  it('bakes the initial payload in and listens for live postMessage updates', () => {
    const html = viewerHtml(buildTimelineData(readCapture(CAPTURE_JSON)!));
    expect(html).toContain('acquireVsCodeApi()');
    expect(html).toContain("addEventListener('message'");
    // The bootstrap data is embedded (the panel renders before any message).
    expect(html).toContain('"port":"COM10"');
    expect(html).toContain('<canvas');
  });

  it('renders the error payload path for a missing capture', () => {
    const html = viewerHtml({ error: 'No capture at trace.json yet' });
    expect(html).toContain('No capture at trace.json yet');
  });
});
