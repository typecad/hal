// ---------------------------------------------------------------------------
// CAN lowering — Zephyr's can API over the harvested controller node
//
// The controller is addressed by its DT nodelabel (chip.can, the harvested
// can@ node — ESP32 TWAI, STM32 bxCAN, NXP FlexCAN…). begin() applies
// mode + bitrate + start in the required order (mode and bitrate need a
// stopped controller); send() builds one can_frame and submits it with a
// bounded timeout and no tx callback (blocking-send form); onReceive()
// installs the accept-all filter whose trampoline carries the frame as
// ten scalars — the Matrix discipline (ISR context, set-a-variable work).
// ----------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';

/** The C variable names for a CAN controller's state. */
function prefix(idx: number): string {
  return `__tc_can${idx}`;
}

/** Which can.* verbs the program actually uses on a controller — the
 *  init block emits only the state those verbs reference (Zephyr's -Werror
 *  turns an unreferenced static function/variable into a build failure:
 *  a send-only program must not carry the rx trampoline). */
export interface CanUsage {
  begin: boolean;
  send: boolean;
  onReceive: boolean;
}

/**
 * Emit the per-controller CAN state: device handle, rx trampoline +
 * handler slot, and the accept-all filters. Called from shimLines when the
 * program uses can.* on this controller and the chip declares it.
 */
export function canInitLines(chip: ZephyrChipDescriptor, controllerIndex: number, usage: CanUsage): string[] {
  const ctrl = chip.can?.controllers[controllerIndex];
  if (!ctrl) return [];
  const p = prefix(controllerIndex);
  const lines: string[] = [
    '// CUTTLEFISH_CAN_BEGIN',
    `static const struct device* ${p}_dev = DEVICE_DT_GET(DT_NODELABEL(${ctrl.nodeLabel}));`,
  ];
  if (usage.begin) {
    // Shim-scoped (not per call site): a second begin() anywhere in the
    // program must not re-fire can_start on a started controller.
    lines.push(`static bool ${p}_started = false;`);
  }
  if (usage.onReceive) {
    lines.push(
      `static void (*${p}_rx)(double, double, double, double, double, double, double, double, double, double) = NULL;`,
      // dlc-bounded: drivers fill only data[0..dlc-1] — copy into a zeroed
      // local so the handler's b0..b7 tail is zero, as the class documents.
      'static void __tc_can_rx_trampoline(const struct device* dev, struct can_frame* frame, void* user_data) {',
      '    (void)dev;',
      '    (void)user_data;',
      `    if (${p}_rx != NULL) {`,
      '        uint8_t __tc_d[8] = { 0U, 0U, 0U, 0U, 0U, 0U, 0U, 0U };',
      '        for (uint32_t __tc_i = 0U; (__tc_i < 8U) && (__tc_i < static_cast<uint32_t>(frame->dlc)); ++__tc_i) { __tc_d[__tc_i] = frame->data[__tc_i]; }',
      `        ${p}_rx(static_cast<double>(frame->id), static_cast<double>(frame->dlc),`,
      `                          static_cast<double>(__tc_d[0]), static_cast<double>(__tc_d[1]),`,
      `                          static_cast<double>(__tc_d[2]), static_cast<double>(__tc_d[3]),`,
      `                          static_cast<double>(__tc_d[4]), static_cast<double>(__tc_d[5]),`,
      `                          static_cast<double>(__tc_d[6]), static_cast<double>(__tc_d[7]));`,
      '    }',
      '}',
      // Two accept-all filters: can_filter_matches_filter never delivers an
      // IDE (29-bit) frame to a filter without CAN_FILTER_IDE — one filter
      // per frame format, so extended sends are receivable too.
      `static const struct can_filter ${p}_filter = { .id = 0U, .mask = 0U, .flags = 0U };`,
      `static const struct can_filter ${p}_filter_ext = { .id = 0U, .mask = 0U, .flags = CAN_FILTER_IDE };`,
      `static bool ${p}_filter_added = false;`,
    );
  }
  if (usage.send) {
    lines.push(
      `static void __tc_can_tx_done(const struct device* dev, int error, void* user_data) {`,
      '    (void)dev; (void)error; (void)user_data;',
      '}',
    );
  }
  lines.push('// CUTTLEFISH_CAN_END');
  return lines;
}

/**
 * Resolve a HAL can.* op to Zephyr C++.
 * Returns `{ code }` for statement ops.
 */
export function lowerCan(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  // DAC discipline: a board with no harvested can@ node lowers to a comment
  // naming the constraint (the board gate already refuses the CAN import;
  // this keeps the manifest probe and direct-lowering paths honest).
  if (!chip.can || chip.can.controllers.length === 0) {
    return { code: `/* ${op.operation}: this board's chip data declares no CAN controller (no harvested can@ node) */` };
  }
  const idx = Math.min(Number(o.instance ?? 0), chip.can.controllers.length - 1);
  const p = prefix(idx);
  const started = `${p}_started`;

  switch (op.operation) {
    case 'can.begin': {
      // Mode and bitrate require a STOPPED controller — apply them before
      // the start, and start exactly once. Failures printk (the loud-
      // diagnostics policy): a CAN bus that never comes up is otherwise a
      // silent hang at the first send.
      return {
        code: `{ int __tc_err; if (${o.loopback}) { __tc_err = can_set_mode(${p}_dev, CAN_MODE_LOOPBACK); if (__tc_err != 0) { printk("typecad-hal can: set_mode failed: %d\\n", __tc_err); } } __tc_err = can_set_bitrate(${p}_dev, ${o.hz}); if (__tc_err != 0) { printk("typecad-hal can: bitrate failed: %d\\n", __tc_err); } if (!${started}) { ${started} = true; __tc_err = can_start(${p}_dev); if (__tc_err != 0) { printk("typecad-hal can: start failed: %d\\n", __tc_err); } } }`,
      };
    }
    case 'can.send': {
      const bytes = (o.data ?? []) as (number | string)[];
      if (bytes.length > 8) {
        throw new Error(
          `CAN send: classic frames carry at most 8 bytes — got ${bytes.length}.`,
        );
      }
      const assigns = bytes
        .map((b, i) => `__tc_frame.data[${i}] = static_cast<uint8_t>(${b});`)
        .join(' ');
      return {
        code: `{ struct can_frame __tc_frame = { 0 }; __tc_frame.id = static_cast<uint32_t>(${o.id}); __tc_frame.dlc = ${bytes.length}U; __tc_frame.flags = ${o.extended ? 'CAN_FRAME_IDE' : '0U'}; ${assigns} int __tc_err = can_send(${p}_dev, &__tc_frame, K_MSEC(100), __tc_can_tx_done, NULL); if (__tc_err != 0) { printk("typecad-hal can: send failed: %d\\n", __tc_err); } }`,
      };
    }
    case 'can.on_receive': {
      return {
        code: `{ ${p}_rx = ${o.handler}; if (!${p}_filter_added) { ${p}_filter_added = true; (void)can_add_rx_filter(${p}_dev, __tc_can_rx_trampoline, NULL, &${p}_filter); (void)can_add_rx_filter(${p}_dev, __tc_can_rx_trampoline, NULL, &${p}_filter_ext); } }`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
