// ---------------------------------------------------------------------------
// Zephyr project scaffolding
//
// Writes the CMakeLists.txt + prj.conf around the cuttlefish-emitted src/main.cpp
// so `west build` has a valid Zephyr application. Idempotent: overwrites the
// generated files only when their content changes (avoids invalidating the
// Ninja incremental build's mtime-based dependency tracking).
// ---------------------------------------------------------------------------

import { writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveKconfigFragments, type KconfigUsage } from '../dt-config/kconfig.js';

/** Write a file only if the content differs from the existing file.
 *  Returns true when the file was written (content changed or file was new). */
export function writeIfChanged(filePath: string, content: string): boolean {
  if (existsSync(filePath)) {
    try {
      if (readFileSync(filePath, 'utf8') === content) return false;
    } catch {
      // Read failed — fall through to write.
    }
  }
  writeFileSync(filePath, content);
  return true;
}

/**
 * Concatenate all emitted source under src/ so the scaffold can detect which
 * peripherals the program actually uses. The cuttlefish lowering emits
 * well-known driver API tokens (adc_read, spi_transceive, bt_*, …), so scanning
 * the post-transpile source is an authoritative usage signal — and it keeps the
 * scaffold self-contained (no need to thread analysis through the toolchain
 * contract). Returns '' when no sources exist yet (first prepare call).
 */
function readEmittedSources(srcDir: string): string {
  if (!existsSync(srcDir)) return '';
  let out = '';
  for (const name of readdirSync(srcDir)) {
    if (name.endsWith('.cpp') || name.endsWith('.c')) {
      try {
        out += readFileSync(join(srcDir, name), 'utf8');
      } catch {
        // ignore unreadable files
      }
    }
  }
  return out;
}

/**
 * Emit the Zephyr application skeleton around the generated src/main.cpp.
 *
 * Layout written:
 *   <projectRoot>/
 *     CMakeLists.txt   (find_package(Zephyr), target_sources app ← src/*.cpp)
 *     prj.conf         (CONFIG_* for GPIO + C++ + libc)
 *     src/main.cpp     (owned by cuttlefish's emit pipeline — NOT touched here)
 *
 * Idempotent. Mirrors scaffoldEspIdfProject's writeIfChanged discipline.
 */
export function scaffoldZephyrProject(projectRoot: string, debug = false, userKconfig?: Record<string, string>): boolean {
  const srcDir = join(projectRoot, 'src');
  if (!existsSync(srcDir)) mkdirSync(srcDir, { recursive: true });

  // Detect which peripherals the program actually uses by scanning the emitted
  // source. The cuttlefish lowering emits well-known driver API tokens, so this
  // is authoritative. Usage-gating the Kconfig symbols keeps a GPIO-only
  // program from pulling in (and linking) stacks it doesn't need — notably
  // NimBLE (CONFIG_BT), whose Espressif prebuilt blobs are not always present
  // in a workspace. The symbol set itself lives in resolveKconfigFragments
  // (dt-config/kconfig.ts), unit-tested separately.
  const src = readEmittedSources(srcDir);
  // Boundary-anchored token scan: a bare `src.includes('power_')` would match
  // `tx_power_dbm` (emitted by the WiFi shim) and flip CONFIG_PM on for a
  // WiFi-only program — on the ESP32-S3 that spins the PM soft-off retry loop
  // forever and starves the app. Anchor each `<prefix>_` token at a leading
  // word boundary so it matches the intended driver/HAL symbol, not a suffix.
  const uses = (token: string): boolean => {
    if (token.endsWith('_')) {
      return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(src);
    }
    return src.includes(token);
  };
  const usage: KconfigUsage = {
    usesAdc: uses('adc_'),
    usesPwm: uses('pwm_'),
    usesI2c: uses('i2c_'),
    usesSpi: uses('spi_'),
    usesUart: uses('uart_'),
    usesWdt: uses('wdt_'),
    usesBle: uses('bt_') || uses('bt_gatt') || uses('bt_le_'),
    usesDisplay: uses('display_write') || uses('display_init') || uses('display_fill_rect'),
    // Power tokens: k_sleep + pm_state_force / PM_STATE_* (what power.ts emits).
    // The old `power_` token matched nothing the power HAL emits and collides
    // with tx_power_dbm — removed.
    usesPower: uses('pm_') || uses('k_sleep') || uses('PM_STATE_'),
    usesWifi: uses('wifi_') || uses('net_mgmt') || uses('conn_mgr'),
    // HTTP: the __tc_http_* shim + http_client_req + getaddrinfo. The '_'-anchored
    // 'http_' token matches __tc_http_* and http_client_req (the core HTTP lib
    // symbol), mirroring how wifi_ detects the wifi shim. An http-only program
    // still pulls the networking stack even without usesWifi.
    usesHttp: uses('http_') || uses('__tc_http') || uses('http_client_req'),
    // MQTT: the __tc_mqtt_* shim + mqtt_connect/mqtt_publish/mqtt_subscribe.
    usesMqtt: uses('mqtt_') || uses('__tc_mqtt') || uses('mqtt_connect'),
    // Preferences: the __tc_prefs_* shim + the settings_* API the shim calls.
    // settings_load/save_one/delete + SETTINGS_STATIC_HANDLER_DEFINE all emit
    // `settings_` symbols; __tc_prefs catches the typed accessors (put_int etc.
    // template into __tc_prefs_put<...>, which keeps the __tc_prefs token).
    usesPreferences: uses('settings_') || uses('__tc_prefs'),
    // Random: the __tc_rand_* shim + the sys_rand_get entropy tap it seeds from.
    usesRandom: uses('__tc_rand') || uses('sys_rand_get'),
  };

  let changed = false;

  // ── Root CMakeLists.txt ─────────────────────────────────────────────────
  // The canonical Zephyr CMake application. GLOB src/*.cpp so future multi-
  // file emits are picked up automatically; cuttlefish owns the file contents.
  const cmakeLists = [
    '# Auto-generated by @typecad/framework-zephyr from cuttlefish.config.ts.',
    'cmake_minimum_required(VERSION 3.20.0)',
    '',
    'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})',
    '',
    'project(zephyr_app)',
    '',
    '# Collect cuttlefish-emitted sources.',
    'file(GLOB app_sources src/*.cpp src/*.c)',
    '',
    'target_sources(app PRIVATE ${app_sources})',
    '',
  ].join('\n');
  if (writeIfChanged(join(projectRoot, 'CMakeLists.txt'), cmakeLists)) changed = true;

  // ── prj.conf ────────────────────────────────────────────────────────────
  // Driver Kconfig symbols are usage-gated on the emitted source: only a
  // peripheral whose driver API the program actually references is enabled.
  // Zephyr's Kconfig treats an enabled-but-unused driver as harmless, BUT
  // several driver stacks pull in large/specific dependencies — notably
  // NimBLE (CONFIG_BT) needs Espressif prebuilt blobs that are not always
  // fetched (`west blobs fetch hal_espressif`). Usage-gating keeps a GPIO-only
  // blink from requiring those, and shrinks the link for every program. The
  // core GPIO driver and C++ support stay unconditional. Symbol selection is
  // delegated to resolveKconfigFragments (unit-tested in dt-config/kconfig).
  const symbols = resolveKconfigFragments(usage, debug);

  const prjConf: string[] = [
    '# Auto-generated by @typecad/framework-zephyr from cuttlefish.config.ts.',
    '# Edit in cuttlefish.config.ts (frameworkData), not here.',
    '# Driver symbols are usage-gated on the emitted source — only peripherals',
    '# the program references are enabled.',
    '',
    '# Route printf/stdout to the console UART (needed by the @typecad/expect',
    '# test runner protocol, which uses printf via __tc_print/__tc_println).',
    'CONFIG_STDOUT_CONSOLE=y',
    'CONFIG_PRINTK=y',
    '',
  ];
  // Emit a section header before the BT block when present.
  let btHeaderEmitted = false;
  let wifiHeaderEmitted = false;
  for (const [sym, val] of symbols) {
    if (sym === 'CONFIG_BT' && !btHeaderEmitted) {
      prjConf.push('', '# Bluetooth (NimBLE peripheral).');
      btHeaderEmitted = true;
    }
    if (sym === 'CONFIG_WIFI' && !wifiHeaderEmitted) {
      prjConf.push('', '# WiFi / networking (conn_mgr + esp32 wifi driver).');
      wifiHeaderEmitted = true;
    }
    // Skip auto-detected symbols that the user explicitly overrides
    // in cuttlefish.config.ts zephyr.kconfig — the user value is
    // emitted in the User Kconfig section below and takes precedence.
    if (userKconfig && userKconfig.hasOwnProperty(sym)) continue;
    prjConf.push(`${sym}=${val}`);
  }
  // Emit user-specified Kconfig from cuttlefish.config.ts zephyr.kconfig.
  // These override any matching auto-detected symbol (skipped above).
  if (userKconfig) {
    prjConf.push('', '# User Kconfig (cuttlefish.config.ts → zephyr.kconfig).');
    for (const [sym, val] of Object.entries(userKconfig)) {
      prjConf.push(`${sym}=${val}`);
    }
  }
  // CONFIG_BT_DEVICE_NAME is a string value not produced by the resolver — add
  // it after the BT block when BLE is used (parity with the previous inline form).
  if (usage.usesBle) prjConf.push('CONFIG_BT_DEVICE_NAME="TypeCAD"');
  prjConf.push('');
  if (writeIfChanged(join(projectRoot, 'prj.conf'), prjConf.join('\n'))) changed = true;
  return changed;
}
