import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

// A program IR carrying an http.send op (the shape profileDiagnostics walks).
const programWithHttp = {
  functions: [{
    statements: [{
      kind: 'hal-op',
      operation: { operation: 'http.send' },
    }],
  }],
} as any;

describe('ZephyrStrategy HTTP wiring', () => {
  const s = new ZephyrStrategy();

  it('forcedIncludes adds socket + http client + tls headers when usesHttp', () => {
    const inc = s.forcedIncludes(undefined, { analysis: { usesHttp: true } } as any);
    expect(inc).toContain('<zephyr/net/http/client.h>');
    expect(inc).toContain('<zephyr/net/socket.h>');
    expect(inc).toContain('<zephyr/net/tls_credentials.h>');
    // zsock_getaddrinfo / zsock_addrinfo live in <zephyr/net/socket.h>; the
    // shim uses the zsock_* API directly, so no <zephyr/posix/netdb.h>.
    expect(inc).toContain('<zephyr/posix/sys/socket.h>');
    expect(inc).not.toContain('<zephyr/posix/netdb.h>');
  });

  it('forcedIncludes omits http headers when usesHttp is false', () => {
    const inc = s.forcedIncludes(undefined, { analysis: { usesHttp: false } } as any);
    expect(inc).not.toContain('<zephyr/net/http/client.h>');
  });

  it('shimLines emits the HTTP runtime when usesHttp', () => {
    const lines = s.shimLines(undefined, { frameworkData: {}, analysis: { usesHttp: true } } as any);
    const joined = lines.join('\n');
    expect(joined).toContain('CUTTLEFISH_HTTP_BEGIN');
    expect(joined).toContain('__tc_http');
  });

  it('profileDiagnostics flags http usage on a radioless chip (xiao_ble)', () => {
    const diags = s.profileDiagnostics(programWithHttp, { frameworkData: { target: 'xiao_ble' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain('zephyr-http-unavailable-on-target');
  });

  it('profileDiagnostics does NOT flag http usage on ESP32-S3', () => {
    const diags = s.profileDiagnostics(programWithHttp, { frameworkData: { target: 'esp32s3_devkitc' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).not.toContain('zephyr-http-unavailable-on-target');
  });

  it('profileDiagnostics does NOT flag http usage on plain ESP32', () => {
    const diags = s.profileDiagnostics(programWithHttp, { frameworkData: { target: 'esp32_devkitc' } } as any);
    const codes = diags.map((d) => d.code);
    expect(codes).not.toContain('zephyr-http-unavailable-on-target');
  });
});
