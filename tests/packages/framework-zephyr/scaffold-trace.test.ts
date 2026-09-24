import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldZephyrProject } from '../../../packages/framework-zephyr/src/toolchain/scaffold';

// zephyr.trace.enabled contributes the exact symbol set the heartbeat
// sampler calls: runtime stats (k_thread_runtime_stats_*), the monitor
// list (k_thread_foreach — kernel/thread_monitor.c only links under
// THREAD_MONITOR), thread names, and stack inspection. User zephyr.kconfig
// overrides still win over the section.
describe('scaffoldZephyrProject — trace heartbeat Kconfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zephyr-scaffold-trace-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.cpp'), 'int main(){ return 0; }\n');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const readConf = (): string => readFileSync(join(dir, 'prj.conf'), 'utf8');

  it('emits the trace section when trace is enabled', () => {
    scaffoldZephyrProject(dir, false, undefined, undefined, { enabled: true });
    const conf = readConf();
    expect(conf).toContain('CONFIG_THREAD_RUNTIME_STATS=y');
    expect(conf).toContain('CONFIG_THREAD_MONITOR=y');
    expect(conf).toContain('CONFIG_THREAD_NAME=y');
    expect(conf).toContain('CONFIG_INIT_STACKS=y');
    expect(conf).toContain('CONFIG_THREAD_STACK_INFO=y');
  });

  it('emits no trace symbols by default', () => {
    scaffoldZephyrProject(dir);
    const conf = readConf();
    expect(conf).not.toContain('CONFIG_THREAD_RUNTIME_STATS');
    expect(conf).not.toContain('CONFIG_THREAD_MONITOR');
  });

  it('skips trace symbols the user overrides in zephyr.kconfig', () => {
    scaffoldZephyrProject(dir, false, { CONFIG_THREAD_NAME: 'n' }, undefined, { enabled: true });
    const conf = readConf();
    expect(conf).not.toContain('CONFIG_THREAD_NAME=y');
    // The user line lands in the User Kconfig section and wins.
    expect(conf).toContain('CONFIG_THREAD_NAME=n');
    expect(conf).toContain('CONFIG_THREAD_RUNTIME_STATS=y');
  });

  it('keeps the section idempotent (no change → false)', () => {
    expect(scaffoldZephyrProject(dir, false, undefined, undefined, { enabled: true })).toBe(true);
    expect(scaffoldZephyrProject(dir, false, undefined, undefined, { enabled: true })).toBe(false);
  });
});
