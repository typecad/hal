import { describe, it, expect, beforeEach } from 'vitest';
import { lowerRmt, rmtInitLines, resetRmtChannels } from '../../../../packages/framework-esp32/src/lowering/rmt';
import { setActiveChip, ESP32S3 } from '../../../../packages/framework-esp32/src/chips/index';
import type { ProgramIR } from '@typecad/cuttlefish/api/shared';

beforeEach(() => {
  setActiveChip(ESP32S3);
  resetRmtChannels();
});

// Minimal ProgramIR stub with one tx_init + one rx_init op. The real walk uses
// visitHalOps (mirroring strategy.ts profileDiagnostics); here we build the
// shape it visits: a function with hal-op statements whose .operation is the op.
function fakeProgram(rmtOps: any[]): ProgramIR {
  return {
    topLevelStatements: [],
    functions: [{
      name: 'setup',
      statements: rmtOps.map((op) => ({ kind: 'hal-op', operation: op, returns_value: false })),
    }],
    classes: [], namespaces: [],
  } as any as ProgramIR;
}

describe('rmtInitLines(program)', () => {
  it('emits file-scope declarations for each tx_init + rx_init pin found in the IR', () => {
    const prog = fakeProgram([
      { operation: 'rmt.tx_init', pin: 48, resolutionHz: 10000000, bit0Hi: 4, bit0Lo: 9, bit1Hi: 9, bit1Lo: 4 },
      { operation: 'rmt.rx_init', pin: 14, resolutionHz: 10000000 },
    ]);
    const lines = rmtInitLines(prog).join('\n');
    expect(lines).toContain('// CUTTLEFISH_RMT_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_RMT_END');
    // TX pin 48 declarations + init fn
    expect(lines).toContain('static rmt_channel_handle_t __tc_rmt_tx48 = NULL');
    expect(lines).toContain('static void __tc_rmt_tx48_init(void)');
    expect(lines).toContain('rmt_new_tx_channel');
    expect(lines).toContain('.gpio_num = 48');
    expect(lines).toContain('.resolution_hz = 10000000');
    expect(lines).toContain('rmt_new_bytes_encoder');
    // bit timings baked in
    expect(lines).toContain('.duration0 = 4');
    expect(lines).toContain('.duration1 = 9');
    // RX pin 14
    expect(lines).toContain('static rmt_channel_handle_t __tc_rmt_rx14 = NULL');
    expect(lines).toContain('rmt_new_rx_channel');
    expect(lines).toContain('rmt_rx_register_event_callbacks');
  });

  it('returns empty marker block when IR has no rmt ops', () => {
    const lines = rmtInitLines(fakeProgram([])).join('\n');
    expect(lines).toContain('// CUTTLEFISH_RMT_BEGIN');
    expect(lines).not.toContain('__tc_rmt_tx');
  });
});

describe('lowerRmt — TX', () => {
  it('tx_init records the pin for the init-lines pass (no declaration emitted here)', () => {
    const out = lowerRmt({ operation: 'rmt.tx_init', pin: 48, resolutionHz: 10000000, bit0Hi: 4, bit0Lo: 9, bit1Hi: 9, bit1Lo: 4 } as any);
    // tx_init at call site just calls the init fn; declaration is in rmtInitLines.
    expect(out.code).toContain('__tc_rmt_tx48_init()');
    expect(out.code).not.toContain('rmt_new_tx_channel');   // not re-declared here
  });
  it('tx_init is idempotent (second call no-ops the allocator)', () => {
    lowerRmt({ operation: 'rmt.tx_init', pin: 48, resolutionHz: 10000000, bit0Hi: 4, bit0Lo: 9, bit1Hi: 9, bit1Lo: 4 } as any);
    expect(() => lowerRmt({ operation: 'rmt.tx_init', pin: 48, resolutionHz: 10000000, bit0Hi: 4, bit0Lo: 9, bit1Hi: 9, bit1Lo: 4 } as any)).not.toThrow();
  });
  it('exhausting TX channels throws (S3 cap = 4)', () => {
    for (const pin of [1, 2, 3, 4]) {
      lowerRmt({ operation: 'rmt.tx_init', pin, resolutionHz: 10000000, bit0Hi: 4, bit0Lo: 9, bit1Hi: 9, bit1Lo: 4 } as any);
    }
    expect(() => lowerRmt({ operation: 'rmt.tx_init', pin: 5, resolutionHz: 10000000, bit0Hi: 4, bit0Lo: 9, bit1Hi: 9, bit1Lo: 4 } as any))
      .toThrow(/out of RMT TX channels/);
  });
  it('tx_write_bytes references handle + encoder + rmt_transmit', () => {
    const out = lowerRmt({ operation: 'rmt.tx_write_bytes', pin: 48, bytes: '1, 2, 3' } as any);
    expect(out.code).toContain('__tc_rmt_tx48_init()');
    expect(out.code).toContain('rmt_transmit');
    expect(out.code).toContain('__tc_rmt_tx48');
    expect(out.code).toContain('__tc_rmt_tx48_enc');
  });
  it('tx_write_symbols builds a rmt_symbol_word_t array', () => {
    const out = lowerRmt({ operation: 'rmt.tx_write_symbols', pin: 48, symbols: '{ .duration0 = 9, .level0 = 1, .duration1 = 4, .level1 = 0 },' } as any);
    expect(out.code).toContain('rmt_symbol_word_t');
    expect(out.code).toContain('rmt_transmit');
  });
  it('tx_wait_done emits rmt_tx_wait_all_done', () => {
    expect(lowerRmt({ operation: 'rmt.tx_wait_done', pin: 48 } as any).code).toContain('rmt_tx_wait_all_done');
  });
  it('tx_deinit emits rmt_del_channel', () => {
    expect(lowerRmt({ operation: 'rmt.tx_deinit', pin: 48 } as any).code).toContain('rmt_del_channel');
  });
});

describe('lowerRmt — RX', () => {
  it('rx_init records the pin', () => {
    const out = lowerRmt({ operation: 'rmt.rx_init', pin: 14, resolutionHz: 10000000 } as any);
    expect(out.code).toContain('__tc_rmt_rx14_init()');
  });
  it('rx_on_received stores the user handler name', () => {
    const out = lowerRmt({ operation: 'rmt.rx_on_received', pin: 14, handler: 'onIr' } as any);
    expect(out.code).toContain('__tc_rmt_rx14_user_cb');
    expect(out.code).toContain('"onIr"');
  });
  it('rx_start emits rmt_rx_start', () => {
    expect(lowerRmt({ operation: 'rmt.rx_start', pin: 14 } as any).code).toContain('rmt_rx_start');
  });
  it('rx_stop emits rmt_rx_stop', () => {
    expect(lowerRmt({ operation: 'rmt.rx_stop', pin: 14 } as any).code).toContain('rmt_rx_stop');
  });
  it('rx_read creates semaphore + blocks on take', () => {
    const out = lowerRmt({ operation: 'rmt.rx_read', pin: 14, maxCount: 64 } as any);
    expect(out.code).toContain('xSemaphoreCreateBinary');
    expect(out.code).toContain('rmt_rx_start');
    expect(out.code).toContain('xSemaphoreTake');
  });
  it('rx_deinit emits rmt_del_channel', () => {
    expect(lowerRmt({ operation: 'rmt.rx_deinit', pin: 14 } as any).code).toContain('rmt_del_channel');
  });
});

describe('lowerRmt errors', () => {
  it('throws on unknown rmt.* op', () => {
    expect(() => lowerRmt({ operation: 'rmt.unknown', pin: 48 } as any)).toThrow(/does not yet support/);
  });
});
