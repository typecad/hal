// ---------------------------------------------------------------------------
// Zephyr project scaffolding
//
// Writes the CMakeLists.txt + prj.conf around the typecad-hal-emitted src/main.cpp
// so `west build` has a valid Zephyr application. Idempotent: overwrites the
// generated files only when their content changes (avoids invalidating the
// Ninja incremental build's mtime-based dependency tracking).
// ---------------------------------------------------------------------------

import { writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveKconfigFragments, type KconfigUsage } from '../dt-config/kconfig.js';
import { scanSensorParts } from './index.js';
import { readCuttlefishLibrarySidecar } from '@typecad/cuttlefish/library-packages';
import { SENSOR_PART_INFO } from '@typecad/hal';

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
 * Names of the typecad-hal-emitted C/C++ sources under src/ (top level only,
 * matching the old `src/*.cpp src/*.c` glob; sorted so the generated
 * CMakeLists.txt is stable across readdir orderings). Empty when no sources
 * exist yet (first prepare call).
 */
function listEmittedSources(srcDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  const names = readdirSync(srcDir).filter((name) => name.endsWith('.cpp') || name.endsWith('.c'));
  names.sort();
  return names;
}

/**
 * Concatenate all emitted source under src/ so the scaffold can detect which
 * peripherals the program actually uses. The cuttlefish lowering emits
 * well-known driver API tokens (adc_read, spi_transceive, bt_*, …), so scanning
 * the post-transpile source is an authoritative usage signal — and it keeps
 * the scaffold self-contained (no need to thread analysis through the toolchain
 * contract). Returns '' when no sources exist yet (first prepare call).
 */
function readEmittedSources(srcDir: string): string {
  let out = '';
  for (const name of listEmittedSources(srcDir)) {
    try {
      out += readFileSync(join(srcDir, name), 'utf8');
    } catch {
      // ignore unreadable files
    }
  }
  return out;
}

/**
 * Append typecad-hal library packages' devicetree overlay fragments to the
 * generated overlay. Library entries come from the transpiler's libraries.json
 * sidecar (next to the emitted sources) and are already gated on the
 * library's include token appearing in the emitted sources — no re-detection.
 * Fragments merge after the framework overlay so library nodes (e.g.
 * @typecad/zephyr-esp32s3-rgb's WS2812 node on I2S0) layer over it.
 */
export function appendLibraryOverlayFragments(overlay: string, projectRoot: string): string {
  let out = overlay;
  for (const entry of readCuttlefishLibrarySidecar(join(projectRoot, 'src'))) {
    if (!entry.overlay) continue;
    try {
      const fragment = readFileSync(entry.overlay, 'utf8').trim();
      if (fragment.length > 0) {
        out += (out.endsWith('\n') ? '' : '\n') + '\n' + fragment + '\n';
      }
    } catch {
      // best-effort; a missing fragment surfaces as a DT error
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
export function scaffoldZephyrProject(projectRoot: string, debug = false, userKconfig?: Record<string, string>, psram?: 'opi' | 'quad'): boolean {
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
    usesDac: uses('dac_') || uses('__tc_dac'),
    usesFS: uses('__tc_fs'),
    usesHwtimer: uses('counter_') || uses('__tc_hw'),
    // The __tc_<bus> alternative matches the shim's state block — a program
    // that only calls begin() emits `(void)__tc_i2c1_dev;` (no driver API
    // call yet), but the shim still declared DEVICE_DT_GET(DT_NODELABEL(...))
    // so the overlay must enable the node or the device symbol is missing.
    usesI2c: uses('i2c_') || uses('__tc_i2c'),
    // DT-bound sensor parts: the __tc_sensor_* state references and the
    // sensor_sample_fetch/sensor_channel_get calls both carry the token.
    usesSensor: uses('sensor_') || uses('__tc_sensor'),
    usesFloatFormat: /%[-0-9.]*[eEfFgG]/.test(src),
    usesSpi: uses('spi_') || uses('__tc_spi'),
    usesUart: uses('uart_') || uses('__tc_uart'),
    // USB CDC serial: every usb.* lowering calls into the __tc_usb<N>_* shim
    // (device + init helper emitted under usesUsb).
    usesUsb: uses('__tc_usb'),
    // STM32F4 DBGMCU keep-SWD-alive init present (emitted for stm32f4 socs).
    usesStm32DebugSleep: uses('__tc_stm32_dbgmcu'),
    usesWdt: uses('wdt_'),
    usesBle: uses('bt_') || uses('bt_gatt') || uses('bt_le_'),
    usesDisplay: uses('display_write') || uses('display_init') || uses('display_fill_rect') || uses('__tc_display_dev') || uses('CuttlefishDisplayTarget'),
    usesTouch: uses('ft6336u') || uses('touch_'),
    // (The power HAL is removed; its former pm_/k_sleep token scan is gone —
    // nothing here must match tx_power_dbm's `power` substring.)
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
    psram,
  };

  let changed = false;

  // ── Root CMakeLists.txt ─────────────────────────────────────────────────
  // The canonical Zephyr CMake application. The emitted source list is
  // explicit (no file(GLOB CONFIGURE_DEPENDS ...)): CONFIGURE_DEPENDS puts a
  // cmake.verify_globs step in the ninja graph that spawns CMake to re-check
  // the glob on every build, and the scaffold already rewrites this file via
  // writeIfChanged whenever the emitted file set changes — which flips
  // configChanged and reconfigures with the new list baked in.
  const sourceFiles = listEmittedSources(srcDir);
  const cmakeLists = [
    '# Auto-generated by @typecad/framework-zephyr from typecad-hal.config.ts.',
    'cmake_minimum_required(VERSION 3.20.0)',
    '',
    '# The app is its own board root: MCU-only targets generate an out-of-tree',
    '# custom board under boards/typecad/<name>/ that Zephyr must discover.',
    '# Harmless when boards/ holds only .overlay files (BOARD_ROOT just needs',
    '# the directory to exist).',
    'list(APPEND BOARD_ROOT ${CMAKE_CURRENT_SOURCE_DIR})',
    '',
    'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})',
    '',
    'project(zephyr_app)',
    '',
    ...(sourceFiles.length > 0
      ? [
        '# TypeCAD-emitted sources. This list is regenerated whenever the',
        '# emitted file set changes (the scaffold rewrites CMakeLists.txt).',
        'target_sources(app PRIVATE',
        ...sourceFiles.map((name) => `  src/${name}`),
        ')',
      ]
      : [
        '# No emitted sources yet — the scaffold regenerates this list on the',
        '# next compile once src/ contains .cpp/.c files.',
      ]),
    // When PSRAM is configured, define BOARD_HAS_PSRAM so the UI runtime's
    // PSRAM canvas allocator (ui_create_canvas_best) is compiled in.
    ...(psram ? ['', '# PSRAM enabled: activate the runtime PSRAM canvas paths.', 'target_compile_definitions(app PRIVATE BOARD_HAS_PSRAM)', ''] : ['']),
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
    '# Auto-generated by @typecad/framework-zephyr from typecad-hal.config.ts.',
    '# Edit in typecad-hal.config.ts (frameworkData), not here.',
    '# Driver symbols are usage-gated on the emitted source — only peripherals',
    '# the program references are enabled.',
    '',
    '# Route printf/stdout to the console UART (needed by the typecad-hal',
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
    // in typecad-hal.config.ts zephyr.kconfig — the user value is
    // emitted in the User Kconfig section below and takes precedence.
    if (userKconfig && userKconfig.hasOwnProperty(sym)) continue;
    prjConf.push(`${sym}=${val}`);
  }
  // ── Cuttlefish library packages ─────────────────────────────────────────
  // Libraries the program imports (recorded in the transpiler's libraries.json
  // sidecar, next to the emitted sources) contribute their manifest's kconfig
  // lines — e.g. @typecad/zephyr-esp32s3-rgb contributes CONFIG_LED_STRIP.
  // Sidecar entries are already gated on the library's include token
  // appearing in the emitted sources, so no re-detection here. User
  // zephyr.kconfig overrides still win.
  const libraryEntries = readCuttlefishLibrarySidecar(srcDir);
  if (libraryEntries.length > 0) {
    prjConf.push('', '# Library packages (typecad-hal.library.json contributions).');
    for (const entry of libraryEntries) {
      for (const line of entry.kconfig) {
        const sym = line.split('=')[0];
        if (userKconfig && sym !== undefined && userKconfig.hasOwnProperty(sym)) continue;
        prjConf.push(line);
      }
    }
  }
  // Per-part Kconfig exceptions: catalog parts whose driver is NOT default-y
  // on its DT node carry extra lines here (empty today — every in-tree sensor
  // driver lights up from the node; the path exists so the first exception
  // found by the generator has somewhere to go).
  const sensorParts = scanSensorParts(src);
  if (sensorParts.length > 0) {
    const extra = [...new Set(sensorParts.flatMap((sp) => SENSOR_PART_INFO[sp.part]?.kconfig ?? []))];
    if (extra.length > 0) {
      prjConf.push('', '# Sensor part Kconfig (catalog exceptions).');
      for (const line of extra) prjConf.push(line);
    }
  }
  // Emit user-specified Kconfig from typecad-hal.config.ts zephyr.kconfig.
  // These override any matching auto-detected symbol (skipped above).
  if (userKconfig) {
    prjConf.push('', '# User Kconfig (typecad-hal.config.ts → zephyr.kconfig).');
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
