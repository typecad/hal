// Unit tests for the ESP32-S3 GDB debug config generators. All output is
// deterministic and idempotent so toggling --debug off/on doesn't churn the
// working tree. Paths are baked at generation time (no angle-bracket
// placeholders reach VS Code).

import { describe, it, expect } from 'vitest';
import {
  buildLaunchJson,
  buildTasksJson,
  buildOpenOcdCfg,
  buildSdkconfigDefaultsDebug,
} from '../../../packages/framework-esp32/src/toolchain/debug-config';

const OPTS = {
  projectName: 'demo',
  sketchRel: 'demos/demo',
  port: 'COM10',
  target: 'esp32s3',
};

describe('buildLaunchJson', () => {
  it('produces a gdbtarget config with the right ELF and gdb path', () => {
    const json = JSON.parse(buildLaunchJson(OPTS));
    const cfg = json.configurations[0];
    expect(cfg.type).toBe('gdbtarget');
    expect(cfg.request).toBe('attach');
    expect(cfg.name).toContain('ESP32-S3');
    expect(cfg.program).toBe('${workspaceFolder}/demos/demo/src/out-esp32s3/build/demo.elf');
    expect(cfg.gdbPath).toBe('${command:espIdf.getToolchainGdb}');
    expect(cfg.target).toEqual({ type: 'remote', host: 'localhost', port: '3333' });
    expect(cfg.preLaunchTask).toBe('cuttlefish: debug prep');
  });

  it('scopes auto-load safe-path to the workspace', () => {
    const json = JSON.parse(buildLaunchJson(OPTS));
    expect(json.configurations[0].initCommands).toContain('set auto-load safe-path ${workspaceFolder}');
  });

  it('sources the generated gdb script from the project out dir', () => {
    const json = JSON.parse(buildLaunchJson(OPTS));
    expect(json.configurations[0].initCommands).toContain(
      'source ${workspaceFolder}/demos/demo/src/out-esp32s3/.cuttlefish/.cuttlefish-gdb.py',
    );
  });
});

describe('buildTasksJson', () => {
  it('includes a background openocd task with a readiness matcher', () => {
    const json = JSON.parse(buildTasksJson(OPTS));
    const openocd = json.tasks.find((t: any) => t.label.includes('openocd'));
    expect(openocd.isBackground).toBe(true);
    expect(openocd.problemMatcher.background.endsPattern).toContain('Listening on port 3333');
    // Command points at the generated openocd.cfg (which itself sources
    // board/esp32s3-builtin.cfg — verified in buildOpenOcdCfg test below).
    expect(openocd.command).toContain('.cuttlefish/openocd.cfg');
  });

  it('threads the port into the build+flash command', () => {
    const json = JSON.parse(buildTasksJson(OPTS));
    const flash = json.tasks.find((t: any) => t.label.includes('build + flash'));
    expect(flash.command).toContain('--port COM10');
    expect(flash.command).toContain('--debug');
    expect(flash.options.cwd).toBe('${workspaceFolder}/demos/demo');
  });

  it('has a debug-prep aggregate depending on openocd and flash in parallel', () => {
    const json = JSON.parse(buildTasksJson(OPTS));
    const prep = json.tasks.find((t: any) => t.label.includes('debug prep'));
    expect(prep.dependsOrder).toBe('parallel');
    expect(prep.dependsOn).toEqual(['cuttlefish: start openocd', 'cuttlefish: build + flash']);
  });
});

describe('buildOpenOcdCfg', () => {
  it('sources the esp32s3 builtin board config', () => {
    expect(buildOpenOcdCfg().trim()).toBe('source [find board/esp32s3-builtin.cfg]');
  });
});

describe('buildSdkconfigDefaultsDebug', () => {
  it('enables -Og and disables size optimization', () => {
    const out = buildSdkconfigDefaultsDebug();
    expect(out).toContain('CONFIG_COMPILER_OPTIMIZATION_DEBUG=y');
    expect(out).toContain('CONFIG_COMPILER_OPTIMIZATION_SIZE=');
    expect(out).not.toContain('CONFIG_COMPILER_OPTIMIZATION_SIZE=y');
  });

  it('keeps assertions enabled', () => {
    expect(buildSdkconfigDefaultsDebug()).toContain('CONFIG_COMPILER_OPTIMIZATION_ASSERTIONS_LEVEL=1');
  });
});
