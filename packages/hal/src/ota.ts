/**
 * OtaClass — over-the-air firmware update (ESP-IDF esp_https_ota / esp_app_format).
 *
 * Lowered to native OTA HAL ops (ota.*): ESP-IDF's esp_https_ota downloads a
 * firmware image over HTTPS and writes it to the OTA partition, then reboots
 * into it. The runtime shim owns the session/progress/verification dance.
 *
 * Requires a network connection (WiFi) and that the partition table defines
 * at least two OTA app slots (the framework's default partitions.csv does).
 */
export class OtaClass {
  static readonly __instance_name = "OTA";

  /** Download and apply a firmware image from an HTTPS URL, then reboot.
   *  Blocks until the update is written and verified. Returns true on success
   *  (the reboot happens inside the shim on success, so a true return means
   *  the new firmware is about to boot). */
  fromUrl(url: string): boolean {
    return otaFromUrl(url);
  }

  /** Begin a manual update session (caller writes chunks via write()). */
  begin(): boolean {
    return otaBegin();
  }

  /** Write a chunk of firmware data to the OTA partition. */
  write(chunk: string): void {
    otaWrite(chunk);
  }

  /** Finalize the update: verify, set the boot partition, and reboot. */
  apply(): void {
    otaApply();
  }
}

export const OTA = new OtaClass();

// ── Semantic primitives (resolved to ota.* HAL ops by the transpiler) ──
export function otaFromUrl(url: string): boolean { return false; }
export function otaBegin(): boolean { return false; }
export function otaWrite(chunk: string): void {}
export function otaApply(): void {}
