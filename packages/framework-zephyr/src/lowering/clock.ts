// ---------------------------------------------------------------------------
// Clock lowering — rtc_set_time / rtc_get_time on the `rtc` DT alias
//
// The alias is Zephyr's own discovery convention. Boards with a hardware
// calendar RTC alias it themselves; the overlay generator synthesizes a
// zephyr,rtc-counter shim (a child of the board's first free counter — the
// counter driver keeps the parent, so Counter and Clock coexist) when they
// do not.
//
// Epoch ↔ civil conversion is Howard Hinnant's days_from_civil pair —
// pure int64 arithmetic, no libc timezone machinery, valid over the whole
// Unix range. The helpers live in the shim block so both ops share them.
// ----------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

const RTC_DEV = 'DEVICE_DT_GET(DT_ALIAS(rtc))';

/** The conversion helpers + device handle. Called from shimLines when the
 *  program uses clock.* — each helper only when its consuming op appears
 *  (a now()-only program must not carry the unused set() helper: -Werror
 *  fails the build on unreferenced static functions). */
export function clockInitLines(usage: { set: boolean; now: boolean }): string[] {
  const lines: string[] = [
    '// CUTTLEFISH_CLOCK_BEGIN',
    `static const struct device* __tc_rtc = ${RTC_DEV};`,
  ];
  if (usage.now) {
    lines.push(
      'static int64_t __tc_days_from_civil(int32_t yy, int32_t mm, int32_t dd) {',
      '    yy -= (mm <= 2) ? 1 : 0;',
      '    const int32_t era = (yy >= 0 ? yy : yy - 399) / 400;',
      '    const int32_t yoe = yy - era * 400;',
      '    const int32_t doy = (153 * (mm + (mm > 2 ? -3 : 9)) + 2) / 5 + dd - 1;',
      '    const int32_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;',
      '    return (static_cast<int64_t>(era) * 146097) + static_cast<int64_t>(doe) - 719468;',
      '}',
    );
  }
  if (usage.set) {
    lines.push(
      'static void __tc_civil_from_days(int64_t z, int32_t* yy, int32_t* mm, int32_t* dd) {',
      '    z += 719468;',
      '    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;',
      '    const int64_t doe = z - (era * 146097);',
      '    const int64_t yoe = (doe - (doe / 1460) + (doe / 36524) - (doe / 146096)) / 365;',
      '    const int64_t y = yoe + (era * 400);',
      '    const int64_t doy = doe - ((365 * yoe) + (yoe / 4) - (yoe / 100));',
      '    const int64_t mp = ((5 * doy) + 2) / 153;',
      '    const int64_t d = doy - (((153 * mp) + 2) / 5) + 1;',
      '    const int64_t m = mp + (mp < 10 ? 3 : -9);',
      '    *yy = static_cast<int32_t>(y + (m <= 2 ? 1 : 0));',
      '    *mm = static_cast<int32_t>(m);',
      '    *dd = static_cast<int32_t>(d);',
      '}',
    );
  }
  lines.push('// CUTTLEFISH_CLOCK_END');
  return lines;
}

/** The all-zero/unknown rtc_time initializer (wday/yday unknown per the
 * struct's contract). */
const TM_INIT = 'struct rtc_time __tc_tm = { 0, 0, 0, 0, 0, 0, -1, -1, -1, 0 }';

/**
 * Resolve a HAL clock.* op to Zephyr C++.
 * Returns `{ code }` for set, `{ expression }` for now.
 */
export function lowerClock(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;

  switch (op.operation) {
    case 'clock.set': {
      // epoch (runtime text) → civil date → rtc_set_time.
      return {
        code: `{ int64_t __tc_ep = static_cast<int64_t>(${o.epoch}); int32_t __tc_y = 0; int32_t __tc_mo = 0; int32_t __tc_d = 0; __tc_civil_from_days(__tc_ep / 86400, &__tc_y, &__tc_mo, &__tc_d); int64_t __tc_sod = __tc_ep % 86400; ${TM_INIT}; __tc_tm.tm_year = __tc_y - 1900; __tc_tm.tm_mon = __tc_mo - 1; __tc_tm.tm_mday = __tc_d; __tc_tm.tm_hour = static_cast<int32_t>(__tc_sod / 3600); __tc_tm.tm_min = static_cast<int32_t>((__tc_sod % 3600) / 60); __tc_tm.tm_sec = static_cast<int32_t>(__tc_sod % 60); (void)rtc_set_time(__tc_rtc, &__tc_tm); }`,
      };
    }
    case 'clock.now': {
      return {
        expression: `({ ${TM_INIT}; double __tc_epoch = 0.0; if (rtc_get_time(__tc_rtc, &__tc_tm) == 0) { int64_t __tc_days = __tc_days_from_civil(__tc_tm.tm_year + 1900, __tc_tm.tm_mon + 1, __tc_tm.tm_mday); __tc_epoch = static_cast<double>((__tc_days * 86400) + (static_cast<int64_t>(__tc_tm.tm_hour) * 3600) + (static_cast<int64_t>(__tc_tm.tm_min) * 60) + static_cast<int64_t>(__tc_tm.tm_sec)); } __tc_epoch; })`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
