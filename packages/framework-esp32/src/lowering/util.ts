/** Parse a peripheral bus/port string like "UART0" / "I2C1" / "SPI2" → numeric index. */
export function parseControllerIndex(busOrPort: string | undefined): number {
  if (!busOrPort) return 0;
  const m = busOrPort.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Normalize an IDF target or Arduino FQBN to a bare chip id ('esp32s3', …). */
export function normalizeIdfTarget(raw?: string): string {
  if (!raw) return 'esp32';
  if (raw.includes(':')) {
    const parts = raw.split(':').filter(Boolean);
    return parts[parts.length - 1] || 'esp32';
  }
  return raw;
}

/** Strip MSYS/MinGW env vars that break Windows export.bat / cmd.exe activation. */
export function scrubMsysEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...env };
  for (const k of Object.keys(out)) {
    if (k === 'MSYSTEM' || k === 'MSYSTEM_CHOST' || k === 'MSYSTEM_PREFIX'
        || k === 'MINGW_CHOST' || k === 'MINGW_PREFIX' || k === 'MINGW_PACKAGE_PREFIX') {
      delete out[k];
    }
  }
  return out;
}
