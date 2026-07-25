import { describe, it, expect } from 'vitest';
import { lowerMdns, mdnsInitLines } from '../../../../packages/framework-esp32/src/lowering/mdns';

describe('mdns init block', () => {
  it('emits CUTTLEFISH_MDNS markers and the esp_mdns wrappers', () => {
    const lines = mdnsInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_MDNS_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_MDNS_END');
    expect(lines).toContain('mdns_init()');
    expect(lines).toContain('mdns_hostname_set');
    expect(lines).toContain('mdns_service_add');
    expect(lines).toContain('mdns_free');
  });
});

describe('mdns lowering', () => {
  it('mdns.start → __tc_mdns_start(hostname) statement', () => {
    const out = lowerMdns({ operation: 'mdns.start', hostname: '"mydev"' } as any);
    expect(out.code).toBe('__tc_mdns_start("mydev");');
  });
  it('mdns.set_hostname → statement', () => {
    const out = lowerMdns({ operation: 'mdns.set_hostname', name: '"x"' } as any);
    expect(out.code).toBe('__tc_mdns_set_hostname("x");');
  });
  it('mdns.add_service → statement with instance/proto/port', () => {
    const out = lowerMdns({ operation: 'mdns.add_service', instance: '"dev"', proto: '"_tcp"', port: 80 } as any);
    expect(out.code).toBe('__tc_mdns_add_service("dev", "_tcp", 80);');
  });
  it('mdns.announce → statement', () => {
    const out = lowerMdns({ operation: 'mdns.announce' } as any);
    expect(out.code).toBe('__tc_mdns_announce();');
  });
  it('mdns.stop → statement', () => {
    const out = lowerMdns({ operation: 'mdns.stop' } as any);
    expect(out.code).toBe('__tc_mdns_stop();');
  });
  it('unknown mdns.* op throws', () => {
    expect(() => lowerMdns({ operation: 'mdns.bogus' } as any)).toThrow();
  });
});
