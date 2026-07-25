import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Native ESP-IDF OTA runtime shim (`__tc_ota_*`). Wraps esp_https_ota for the
 * one-shot HTTPS firmware update path, and esp_ota_* for the manual
 * begin/write/apply path.
 *
 * Requires WiFi + a partition table with at least two OTA app slots (the
 * framework's default partitions.csv provides this). esp_https_ota and esp_app_format
 * are built-in ESP-IDF components.
 *
 * Lowered via framework-esp32/src/lowering/ota.ts. Forced includes
 * (esp_https_ota.h, esp_ota_ops.h) are gated on usesOta in strategy.ts.
 */

export function otaInitLines(): string[] {
  return [
    `// CUTTLEFISH_OTA_BEGIN`,
    `static esp_ota_handle_t __tc_ota_handle = 0;`,
    `static const esp_partition_t* __tc_ota_partition = NULL;`,
    `static bool __tc_ota_in_progress = false;`,
    ``,
    `// One-shot: download an HTTPS firmware image, verify, set boot partition, reboot.`,
    `static inline bool __tc_ota_from_url(const char* url) {`,
    `    esp_http_client_config_t http_cfg = { .url = url, .cert_pem = NULL, .timeout_ms = 30000 };`,
    `    esp_https_ota_config_t ota_cfg = { .http_config = &http_cfg };`,
    `    esp_err_t err = esp_https_ota(&ota_cfg);`,
    `    if (err != ESP_OK) {`,
    `        ESP_LOGE("tc", "OTA failed: %s", esp_err_to_name(err));`,
    `        return false;`,
    `    }`,
    `    esp_https_ota_abort(NULL);  // no-op if already clean; idempotent cleanup`,
    `    ESP_LOGI("tc", "OTA ok, rebooting");`,
    `    esp_restart();`,
    `    return true;  // unreachable after restart, but keeps the signature honest`,
    `}`,
    ``,
    `// Manual session: begin -> write(chunks) -> apply.`,
    `static inline bool __tc_ota_begin(void) {`,
    `    if (__tc_ota_in_progress) return true;`,
    `    __tc_ota_partition = esp_ota_get_next_update_partition(NULL);`,
    `    if (!__tc_ota_partition) return false;`,
    `    esp_err_t err = esp_ota_begin(__tc_ota_partition, OTA_WITH_SEQUENTIAL_WRITES, &__tc_ota_handle);`,
    `    if (err != ESP_OK) return false;`,
    `    __tc_ota_in_progress = true;`,
    `    return true;`,
    `}`,
    ``,
    `static inline void __tc_ota_write(const char* chunk_expr) {`,
    `    if (!__tc_ota_in_progress) return;`,
    `    // chunk_expr is a C expression evaluating to a NUL-terminated string;`,
    `    // write its byte length. (Callers passing raw byte buffers should use`,
    `    // rawCpp to call esp_ota_write with an explicit length.)`,
    `    esp_ota_write(__tc_ota_handle, chunk_expr, strlen(chunk_expr));`,
    `}`,
    ``,
    `static inline void __tc_ota_apply(void) {`,
    `    if (!__tc_ota_in_progress) return;`,
    `    esp_ota_end(__tc_ota_handle);`,
    `    esp_ota_set_boot_partition(__tc_ota_partition);`,
    `    __tc_ota_in_progress = false;`,
    `    ESP_LOGI("tc", "OTA applied, rebooting");`,
    `    esp_restart();`,
    `}`,
    `// CUTTLEFISH_OTA_END`,
    ``,
  ];
}

/** Resolve a HAL ota.* op to ESP-IDF C++. */
export function lowerOta(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'ota.from_url': return { expression: `__tc_ota_from_url(${o.url})` };
    case 'ota.begin':    return { expression: `__tc_ota_begin()` };
    case 'ota.write':    return { code: `__tc_ota_write(${o.chunk});` };
    case 'ota.apply':    return { code: `__tc_ota_apply();` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
