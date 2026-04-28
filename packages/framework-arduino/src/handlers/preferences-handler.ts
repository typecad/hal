// ---------------------------------------------------------------------------
// Preferences namespace handler — maps TypeHAL Preferences.* calls to
// Arduino C++ via a global __tc_prefs object.
//
// On ESP32: __tc_prefs is a native Preferences object (#include <Preferences.h>)
// On AVR:   __tc_prefs is a __tc_Preferences shim class backed by EEPROM
//
// The handler is architecture-agnostic; the profile layer handles the split.
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typehal/core/shared';

/**
 * Render Preferences namespace calls to Arduino C++.
 *
 * All calls delegate to __tc_prefs which is either a native ESP32 Preferences
 * instance or an AVR EEPROM-backed shim — the handler does not care which.
 *
 * - Preferences.begin(name)           -> __tc_prefs.begin(name, false)
 * - Preferences.begin(name, readOnly) -> __tc_prefs.begin(name, readOnly)
 * - Preferences.end()                 -> __tc_prefs.end()
 * - Preferences.putInt(key, value)    -> __tc_prefs.putInt(key, value)
 * - Preferences.getInt(key, default)  -> __tc_prefs.getInt(key, default)
 * - Preferences.putUInt(key, value)   -> __tc_prefs.putUInt(key, value)
 * - Preferences.getUInt(key, default) -> __tc_prefs.getUInt(key, default)
 * - Preferences.putBool(key, value)   -> __tc_prefs.putBool(key, value)
 * - Preferences.getBool(key, default) -> __tc_prefs.getBool(key, default)
 * - Preferences.putFloat(key, value)  -> __tc_prefs.putFloat(key, value)
 * - Preferences.getFloat(key, default)-> __tc_prefs.getFloat(key, default)
 * - Preferences.putString(key, value) -> __tc_prefs.putString(key, value)
 * - Preferences.getString(key, def)   -> __tc_prefs.getString(key, def)
 * - Preferences.clear()               -> __tc_prefs.clear()
 * - Preferences.remove(key)           -> __tc_prefs.remove(key)
 */
export function renderPreferencesCall(
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  switch (method) {
    case 'begin':
      if (args.length >= 2) {
        return `__tc_prefs.begin(${a(0)}, ${a(1)})`;
      }
      return `__tc_prefs.begin(${a(0)}, false)`;
    case 'end':
      return `__tc_prefs.end()`;
    case 'putInt':
      return `__tc_prefs.putInt(${a(0)}, ${a(1)})`;
    case 'getInt':
      return `__tc_prefs.getInt(${a(0)}, ${a(1)})`;
    case 'putUInt':
      return `__tc_prefs.putUInt(${a(0)}, ${a(1)})`;
    case 'getUInt':
      return `__tc_prefs.getUInt(${a(0)}, ${a(1)})`;
    case 'putBool':
      return `__tc_prefs.putBool(${a(0)}, ${a(1)})`;
    case 'getBool':
      return `__tc_prefs.getBool(${a(0)}, ${a(1)})`;
    case 'putFloat':
      return `__tc_prefs.putFloat(${a(0)}, ${a(1)})`;
    case 'getFloat':
      return `__tc_prefs.getFloat(${a(0)}, ${a(1)})`;
    case 'putString':
      return `__tc_prefs.putString(${a(0)}, ${a(1)})`;
    case 'getString':
      return `__tc_prefs.getString(${a(0)}, ${a(1)})`;
    case 'clear':
      return `__tc_prefs.clear()`;
    case 'remove':
      return `__tc_prefs.remove(${a(0)})`;
    default:
      return undefined;
  }
}
