import type { HALOpIR, ProgramIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

/**
 * RMT (Remote Control Transceiver) lowering for framework-esp32.
 * Targets the native ESP-IDF v5.x/v6.x driver: driver/rmt_tx.h, driver/rmt_rx.h.
 *
 * Two halves:
 *  - rmtInitLines(program): walks the resolved IR, finds every rmt.tx_init /
 *    rmt.rx_init op, and emits file-scope `static` handle declarations +
 *    per-pin __tc_rmt_tx<pin>_init() helpers. PWM/I2C/SPI declare fixed handles
 *    in their init lines (their resource sets are known); RMT's pin set is
 *    user-determined, so it must be scanned from the IR. The lowering then only
 *    references these symbols — it never declares them (call-site code lives
 *    inside user functions; file-scope statics must live in the shim block).
 *  - lowerRmt(op): the call-site lowering.
 *
 * Channel identity is the GPIO pin (like pwm.ts's LEDC channel-per-pin model).
 * TX and RX each maintain an independent per-pin allocator bounded by the
 * active chip's rmt.txChannels / rmt.rxChannels caps.
 *
 * Bit timings are fixed at rmt.tx_init because ESP-IDF bakes them into the
 * bytes-encoder at rmt_new_bytes_encoder() and exposes no public mutation API.
 */

// ── local recursive IR visitor ───────────────────────────────────────────────
// Mirrors strategy.ts profileDiagnostics' `visit`. walkProgramIR exists in
// cuttlefish internals (src/ir/utils/walk-ir.ts) but is NOT in the public API
// barrel, and framework packages consume only the public API — so we ship our
// own generic walk, exactly as profileDiagnostics already does.
function visitHalOps(node: any, fn: (op: any) => void): void {
  if (node && typeof node === 'object') {
    if (node.operation && typeof node.operation === 'object'
        && typeof node.operation.operation === 'string') {
      fn(node.operation);
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => visitHalOps(c, fn));
      else if (typeof v === 'object' && v !== null) visitHalOps(v, fn);
    }
  }
}

// ── allocator state (mirrors pwm.ts channelByPin / nextChannelIdx) ───────────
interface TxPinCfg {
  pin: number;
  resolutionHz: string;
  bit0Hi: string; bit0Lo: string;
  bit1Hi: string; bit1Lo: string;
  msbFirst: string;
  queueDepth: string;
}
interface RxPinCfg { pin: number; resolutionHz: string; }

const txPins = new Map<number, TxPinCfg>();
const rxPins = new Map<number, RxPinCfg>();
let nextTxIdx = 0;
let nextRxIdx = 0;

export function resetRmtChannels(): void {
  txPins.clear();
  rxPins.clear();
  nextTxIdx = 0;
  nextRxIdx = 0;
}

function txSym(pin: number): string { return `__tc_rmt_tx${pin}`; }
function rxSym(pin: number): string { return `__tc_rmt_rx${pin}`; }

/** Render a tick/count value as a clean C integer literal. The resolver can
 *  hand us values like "4.0f" (C float literal — float-typed first positional
 *  arg) or "4" or a number; we parse and emit a bare integer so brace-enclosed
 *  initializers don't hit float→uint16 narrowing errors. Non-numeric (runtime
 *  expression) strings pass through unchanged. */
function intLit(v: unknown): string {
  if (typeof v === 'number') return String(Math.trunc(v));
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v ?? '').trim();
  if (s === '') return '0';
  // Strip C float suffixes (4.0f, 9.0F) and parse.
  const cleaned = s.replace(/[fFuUlL]+$/, '');
  const n = Number(cleaned);
  return !Number.isNaN(n) ? String(Math.trunc(n)) : s;
}

/** Split a comma-separated initializer body on top-level commas only, so an
 *  element like `f(a,b)` or `{x,y}` stays intact. Used to cast each byte of a
 *  txWriteBytes buffer individually. */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

// ── init lines: scan IR, emit file-scope declarations ────────────────────────
export function rmtInitLines(program: ProgramIR): string[] {
  // Walk the IR collecting tx_init / rx_init pins. lowerRmt may also have
  // populated txPins/rxPins during an earlier lowering pass; the has() guard
  // merges both without double-counting.
  visitHalOps(program, (op: any) => {
    if (op.operation === 'rmt.tx_init' && !txPins.has(Number(op.pin))) {
      registerTxPin(op);
    } else if (op.operation === 'rmt.rx_init' && !rxPins.has(Number(op.pin))) {
      registerRxPin(op);
    }
  });

  const out: string[] = ['// CUTTLEFISH_RMT_BEGIN'];
  for (const cfg of txPins.values()) out.push(...emitTxDecl(cfg));
  for (const cfg of rxPins.values()) out.push(...emitRxDecl(cfg));
  out.push('// CUTTLEFISH_RMT_END', '');
  return out;
}

function registerTxPin(op: any): TxPinCfg {
  const chip = getActiveChip();
  if (chip.lacks.includes('rmt') || !chip.rmt) {
    throw new Error(`framework-esp32: ${chip.id} has no RMT peripheral`);
  }
  const pin = Number(op.pin);
  if (nextTxIdx >= chip.rmt.txChannels) {
    throw new Error(`framework-esp32: out of RMT TX channels (max ${chip.rmt.txChannels} on ${chip.id})`);
  }
  nextTxIdx++;
  const cfg: TxPinCfg = {
    pin,
    resolutionHz: String(op.resolutionHz ?? 10000000),
    // Coerce to clean integers: the resolver can render numeric literals with
    // a float suffix (e.g. "4.0f") for the first element of a positional arg
    // list, and inside a brace-enclosed struct initializer float→uint16
    // narrowing is a hard error. RMT tick durations are always integers.
    bit0Hi: intLit(op.bit0Hi ?? 4), bit0Lo: intLit(op.bit0Lo ?? 9),
    bit1Hi: intLit(op.bit1Hi ?? 9), bit1Lo: intLit(op.bit1Lo ?? 4),
    msbFirst: String(op.msbFirst ?? false),
    queueDepth: intLit(op.queueDepth ?? 4),
  };
  txPins.set(pin, cfg);
  return cfg;
}

function registerRxPin(op: any): RxPinCfg {
  const chip = getActiveChip();
  if (chip.lacks.includes('rmt') || !chip.rmt) {
    throw new Error(`framework-esp32: ${chip.id} has no RMT peripheral`);
  }
  const pin = Number(op.pin);
  if (nextRxIdx >= chip.rmt.rxChannels) {
    throw new Error(`framework-esp32: out of RMT RX channels (max ${chip.rmt.rxChannels} on ${chip.id})`);
  }
  nextRxIdx++;
  const cfg: RxPinCfg = { pin, resolutionHz: String(op.resolutionHz ?? 10000000) };
  rxPins.set(pin, cfg);
  return cfg;
}

function emitTxDecl(c: TxPinCfg): string[] {
  const h = txSym(c.pin);
  const msbNum = c.msbFirst === 'true' ? 1 : 0;
  return [
    `static rmt_channel_handle_t ${h} = NULL;`,
    `static rmt_encoder_handle_t  ${h}_enc = NULL;`,
    `static rmt_transmit_config_t ${h}_txcfg;`,
    `static bool ${h}_ready = false;`,
    `static void ${h}_init(void) {`,
    `  if (${h}_ready) return;`,
    `  rmt_tx_channel_config_t ${h}_cfg = {`,
    `    .gpio_num = (gpio_num_t)${c.pin},`,
    `    .clk_src = RMT_CLK_SRC_DEFAULT,`,
    `    .resolution_hz = ${c.resolutionHz},`,
    `    .mem_block_symbols = SOC_RMT_MEM_WORDS_PER_CHANNEL,`,
    `    .trans_queue_depth = ${c.queueDepth},`,
    `  };`,
    `  rmt_new_tx_channel(&${h}_cfg, &${h});`,
    `  rmt_enable(${h});`,
    `  rmt_bytes_encoder_config_t ${h}_bcfg = {`,
    `    .bit0 = { .duration0 = ${c.bit0Hi}, .level0 = 1, .duration1 = ${c.bit0Lo}, .level1 = 0 },`,
    `    .bit1 = { .duration0 = ${c.bit1Hi}, .level0 = 1, .duration1 = ${c.bit1Lo}, .level1 = 0 },`,
    `    .flags = { .msb_first = ${msbNum} },`,
    `  };`,
    `  rmt_new_bytes_encoder(&${h}_bcfg, &${h}_enc);`,
    `  ${h}_ready = true;`,
    `}`,
  ];
}

function emitRxDecl(c: RxPinCfg): string[] {
  const h = rxSym(c.pin);
  return [
    `static rmt_channel_handle_t ${h} = NULL;`,
    `static rmt_symbol_word_t ${h}_buf[64];`,
    `static size_t ${h}_n = 0;`,
    `static SemaphoreHandle_t ${h}_sem = NULL;`,
    `static const char* ${h}_user_cb = NULL;`,
    `static void IRAM_ATTR ${h}_on_recv(rmt_channel_handle_t ch, const rmt_rx_event_data_t* e, void* arg) {`,
    `  size_t cpy = e->num_symbols;`,
    `  if (cpy > 64) cpy = 64;`,
    `  memcpy(${h}_buf, e->received_symbols, cpy * sizeof(*e->received_symbols));`,
    `  ${h}_n = cpy;`,
    `  if (${h}_user_cb) ((void(*)(rmt_symbol_word_t*, size_t))(size_t)${h}_user_cb)(${h}_buf, ${h}_n);`,
    `  if (${h}_sem) xSemaphoreGiveFromISR(${h}_sem, NULL);`,
    `}`,
    `static void ${h}_init(void) {`,
    `  if (${h}) return;`,
    `  rmt_rx_channel_config_t ${h}_cfg = {`,
    `    .gpio_num = (gpio_num_t)${c.pin},`,
    `    .clk_src = RMT_CLK_SRC_DEFAULT,`,
    `    .resolution_hz = ${c.resolutionHz},`,
    `    .mem_block_symbols = SOC_RMT_MEM_WORDS_PER_CHANNEL,`,
    `  };`,
    `  rmt_new_rx_channel(&${h}_cfg, &${h});`,
    `  rmt_rx_register_event_callbacks(${h}, &((rmt_rx_event_callbacks_t){ .on_recv_done = ${h}_on_recv }), NULL);`,
    `}`,
  ];
}

// ── call-site lowering (references only symbols rmtInitLines declared) ───────
export function lowerRmt(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  const chip = getActiveChip();
  if (chip.lacks.includes('rmt') || !chip.rmt) {
    throw new Error(`framework-esp32: ${chip.id} has no RMT peripheral`);
  }

  switch (op.operation) {
    // ── TX ───────────────────────────────────────────────────────────────────
    case 'rmt.tx_init': {
      // Register the pin (allocates a channel slot); emit only the init call.
      // The declaration lives in rmtInitLines (file scope); here we just invoke.
      if (!txPins.has(Number(o.pin))) registerTxPin(o);
      return { code: `${txSym(Number(o.pin))}_init();` };
    }
    case 'rmt.tx_write_bytes': {
      const pin = Number(o.pin);
      const h = txSym(pin);
      // The resolver renders an array literal [g, r, b] as a braced "{ g, r, b }".
      // Elements may be runtime int variables; initializing a uint8_t[] from
      // them via braced-init triggers -Wnarrowing (hard error under -Werror).
      // Strip the braces and re-emit each element wrapped in an explicit
      // (uint8_t) cast so the narrowing is intentional, not implicit.
      const bytes = String(o.bytes ?? '').trim();
      const inner = bytes.startsWith('{') ? bytes.slice(1, -1) : bytes;
      const buf = `${h}_buf`;
      // Count elements to size the buffer (split on top-level commas).
      const elems = splitTopLevelCommas(inner);
      const casted = elems.map((e) => `(uint8_t)(${e.trim()})`).join(', ');
      return { code: [
        `uint8_t ${buf}[${elems.length}] = { ${casted} };`,
        `${h}_init();`,
        `${h}_txcfg.loop_count = 0;`,
        `rmt_transmit(${h}, ${h}_enc, ${buf}, sizeof(${buf}), &${h}_txcfg);`,
      ].join('\n') };
    }
    case 'rmt.tx_write_symbols': {
      const pin = Number(o.pin);
      const h = txSym(pin);
      // symbols renders as a braced list (same caveat as tx_write_bytes).
      const symbols = String(o.symbols ?? '').trim();
      const init = symbols.startsWith('{') ? symbols : `{ ${symbols} }`;
      const arr = `${h}_syms`;
      return { code: [
        `static const rmt_symbol_word_t ${arr}[] = ${init};`,
        `${h}_init();`,
        `rmt_copy_encoder_config_t ${h}_ccopy = {};`,
        `rmt_encoder_handle_t ${h}_copyenc = NULL;`,
        `rmt_new_copy_encoder(${h}, &${h}_ccopy, &${h}_copyenc);`,
        `rmt_transmit(${h}, ${h}_copyenc, ${arr}, sizeof(${arr}), &${h}_txcfg);`,
      ].join('\n') };
    }
    case 'rmt.tx_wait_done': {
      const pin = Number(o.pin);
      const h = txSym(pin);
      // timeoutMs defaults to -1 (portMAX_DELAY equivalent). Guard against
      // undefined/NaN: Number(undefined) === NaN, and NaN is !== null so the
      // truthy check alone would emit "NaN".
      const raw = o.timeoutMs;
      const timeoutMs = (raw !== undefined && raw !== null && raw !== '' && !Number.isNaN(Number(raw)))
        ? Number(raw) : -1;
      return { code: `${h}_init(); rmt_tx_wait_all_done(${h}, ${timeoutMs});` };
    }
    case 'rmt.tx_deinit': {
      const pin = Number(o.pin);
      const h = txSym(pin);
      txPins.delete(pin);
      return { code: `rmt_del_channel(${h}); ${h} = NULL; ${h}_ready = false;` };
    }

    // ── RX ───────────────────────────────────────────────────────────────────
    case 'rmt.rx_init': {
      if (!rxPins.has(Number(o.pin))) registerRxPin(o);
      return { code: `${rxSym(Number(o.pin))}_init();` };
    }
    case 'rmt.rx_on_received': {
      const pin = Number(o.pin);
      const h = rxSym(pin);
      const handler = String(o.handler ?? '');
      return { code: `${h}_init(); ${h}_user_cb = "${handler}";` };
    }
    case 'rmt.rx_start': {
      const pin = Number(o.pin);
      const h = rxSym(pin);
      return { code: `${h}_init(); rmt_rx_start(${h}, true);` };
    }
    case 'rmt.rx_stop': {
      const pin = Number(o.pin);
      const h = rxSym(pin);
      return { code: `rmt_rx_stop(${h});` };
    }
    case 'rmt.rx_read': {
      const pin = Number(o.pin);
      const h = rxSym(pin);
      return { code: [
        `${h}_init();`,
        `if (!${h}_sem) ${h}_sem = xSemaphoreCreateBinary();`,
        `rmt_rx_start(${h}, true);`,
        `xSemaphoreTake(${h}_sem, portMAX_DELAY);`,
      ].join('\n') };
    }
    case 'rmt.rx_deinit': {
      const pin = Number(o.pin);
      const h = rxSym(pin);
      rxPins.delete(pin);
      return { code: `rmt_del_channel(${h}); ${h} = NULL;` };
    }

    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
