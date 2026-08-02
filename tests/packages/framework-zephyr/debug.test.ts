// Unit tests for Zephyr `--debug` wiring: debugMode() target selection, the
// printf halt shim gating, and the gdb-mode artifact generators
// (debug-config.ts). These are pure unit tests — no hardware, no west build.

import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import {
  writeDebugConfig,
  generateGdbScript,
  resolveDebugLocations,
} from '../../../packages/framework-zephyr/src/toolchain/debug-config';
import { scaffoldZephyrProject } from '../../../packages/framework-zephyr/src/toolchain/scaffold';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const strategy = new ZephyrStrategy();

describe('ZephyrStrategy.debugMode — target selection', () => {
  it('selects gdb for esp32s3_devkitc (built-in USB-JTAG)', () => {
    expect(strategy.debugMode('esp32s3_devkitc')).toBe('gdb');
  });

  it('selects gdb for esp32s3_devkitc with a /qualifier suffix', () => {
    expect(strategy.debugMode('esp32s3_devkitc/esp32s3/procpu')).toBe('gdb');
  });

  it('selects gdb for any esp32s3* board', () => {
    expect(strategy.debugMode('esp32s3_other')).toBe('gdb');
  });

  it('falls back to printf for xiao_ble (J-Link path not yet wired)', () => {
    expect(strategy.debugMode('xiao_ble')).toBe('printf');
  });

  it('falls back to printf for esp32_devkitc (no built-in USB-JTAG; needs ESP-PROG)', () => {
    // The plain ESP32 has no built-in USB-JTAG unlike the S3, so gdb would need
    // an external probe + a different OpenOCD cfg/toolchain dir (deferred).
    expect(strategy.debugMode('esp32_devkitc')).toBe('printf');
    expect(strategy.debugMode('esp32_devkitc/esp32/procpu')).toBe('printf');
  });

  it('falls back to printf when no target is given', () => {
    expect(strategy.debugMode(undefined)).toBe('printf');
  });
});

describe('printf halt shim gating', () => {
  // The __tc_debug_wait_for_continue shim must only appear in printf builds;
  // in gdb builds the printf preprocessor is skipped, so the shim is dead code
  // and its <zephyr/drivers/uart.h> include would be unused.

  it('emits the halt shim + uart.h include in printf mode (xiao_ble)', () => {
    // Explicit analysis with no UART usage: the uart.h include in printf mode
    // comes from the printf-gated shim push (not the usage gate), proving the
    // gate actually adds it for the shim.
    const ctx = {
      frameworkData: { buildTarget: 'xiao_ble' },
      analysis: { usesUart: false, usesI2C: false, usesSPI: false, usesADC: false, usesPWM: false, usesWDT: false, usesPower: false, usesBle: false, usesStdString: false },
    } as any;
    const shims = strategy.shimLines(undefined, ctx);
    expect(shims.join('\n')).toContain('__tc_debug_wait_for_continue');
    const includes = strategy.forcedIncludes(undefined, ctx);
    expect(includes).toContain('<zephyr/drivers/uart.h>');
  });

  it('omits the halt shim in gdb mode (esp32s3_devkitc)', () => {
    const ctx = { frameworkData: { buildTarget: 'esp32s3_devkitc' } } as any;
    const shims = strategy.shimLines(undefined, ctx);
    expect(shims.join('\n')).not.toContain('__tc_debug_wait_for_continue');
  });

  it('omits the unconditional uart.h include in gdb mode when the program does not use UART', () => {
    // Provide an explicit analysis with usesUart:false so the usage-gated
    // include doesn't fire — without analysis, forcedIncludes defaults every
    // use-flag to true (defensive "include everything" for pre-build queries).
    const ctx = {
      frameworkData: { buildTarget: 'esp32s3_devkitc' },
      analysis: { usesUart: false, usesI2C: false, usesSPI: false, usesADC: false, usesPWM: false, usesWDT: false, usesPower: false, usesBle: false, usesStdString: false },
    } as any;
    const includes = strategy.forcedIncludes(undefined, ctx);
    // uart.h should NOT be present in gdb mode: no shim needs it, and the
    // program doesn't use UART.
    expect(includes).not.toContain('<zephyr/drivers/uart.h>');
  });
});

describe('scaffoldZephyrProject — debug Kconfigs', () => {
  it('adds CONFIG_DEBUG + CONFIG_DEBUG_OPTIMIZATIONS when debug=true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-debug-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'main.cpp'), 'int x = 0;\n');
    try {
      scaffoldZephyrProject(dir, true);
      const prj = fs.readFileSync(path.join(dir, 'prj.conf'), 'utf8');
      expect(prj).toContain('CONFIG_DEBUG=y');
      expect(prj).toContain('CONFIG_DEBUG_OPTIMIZATIONS=y');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits debug Kconfigs when debug=false (default)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-nodebug-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'main.cpp'), 'int x = 0;\n');
    try {
      scaffoldZephyrProject(dir, false);
      const prj = fs.readFileSync(path.join(dir, 'prj.conf'), 'utf8');
      expect(prj).not.toContain('CONFIG_DEBUG=y');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generateGdbScript — conditional lambda frame filter', () => {
  it('returns null when no source map is provided', () => {
    expect(generateGdbScript(undefined)).toBeNull();
  });

  it('returns null when the source map has no _isr_N symbols', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-noscript-'));
    const mapPath = path.join(dir, 'main.cpp.thcppmap.json');
    fs.writeFileSync(mapPath, '{"version":3,"sources":[],"names":[]}');
    try {
      expect(generateGdbScript(mapPath)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the frame-filter script when _isr_N symbols are present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-script-'));
    const mapPath = path.join(dir, 'main.cpp.thcppmap.json');
    // A source map referencing a hoisted lambda symbol.
    fs.writeFileSync(mapPath, '{"names":["__lambda_isr_0","foo_isr_1"]}');
    try {
      const script = generateGdbScript(mapPath);
      expect(script).not.toBeNull();
      expect(script).toContain('CuttlefishLambdaFilter');
      expect(script).toContain('gdb.frame_filters');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('writeDebugConfig — launch.json + tasks.json generation', () => {
  it('writes a self-contained cortex-debug launch config + build task', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-debugcfg-'));
    const projectRoot = path.join(tmp, 'project');
    const workspaceRoot = tmp; // workspace root is the temp dir
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    try {
      const opts = {
        projectRoot,
        workspaceRoot,
        sketchRel: 'project',
        target: 'esp32s3_devkitc',
        buildDir: path.join(projectRoot, 'build'),
      };
      writeDebugConfig(opts);

      const launchPath = path.join(workspaceRoot, '.vscode', 'launch.json');
      const tasksPath = path.join(workspaceRoot, '.vscode', 'tasks.json');
      expect(fs.existsSync(launchPath)).toBe(true);
      expect(fs.existsSync(tasksPath)).toBe(true);

      const launch = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
      const cfg = launch.configurations[0];
      expect(cfg.name).toBe('TypeCAD Debug (Zephyr, ESP32-S3)');
      // cortex-debug (the standard Cortex-Debug extension), NOT gdbtarget.
      // cortex-debug starts OpenOCD via servertype; postAttachCommands reset
      // the target, set a HW breakpoint at setup(), and continue.
      expect(cfg.type).toBe('cortex-debug');
      expect(cfg.request).toBe('attach');
      // cortex-debug uses `executable` (the ELF), not gdbtarget's `program`.
      expect(cfg.executable).toContain('project/build/zephyr/zephyr.elf');
      expect(cfg.servertype).toBe('openocd');
      expect(Array.isArray(cfg.configFiles)).toBe(true);
      expect(cfg.configFiles[0]).toContain('project/.cuttlefish/openocd.cfg');
      expect(cfg.interface).toBe('jtag');
      // gdbPath is a concrete resolved path (NOT an IDF command variable).
      // May be absent if the SDK path isn't resolvable in the test env;
      // when present, it's absolute and references the xtensa gdb.
      if (cfg.gdbPath !== undefined) {
        expect(cfg.gdbPath).toMatch(/xtensa.*gdb/);
      }
      // serverpath is only present when resolveOpenOcdPath() finds the
      // Espressif OpenOCD fork on disk; may be absent in CI/test envs.
      if (cfg.serverpath !== undefined) {
        expect(cfg.serverpath).toContain('openocd');
      }
      // No gdbtarget properties.
      expect(cfg.program).toBeUndefined();
      expect(cfg.gdb).toBeUndefined();
      expect(cfg.target).toBeUndefined();
      expect(cfg.runOpenOCD).toBeUndefined();
      expect(cfg.initialBreakpoint).toBeUndefined();
      expect(cfg.initCommands).toBeUndefined();
      // postAttachCommands: dirs + limits + mem + reset + thb + continue.
      const postCmds = cfg.postAttachCommands as string[];
      expect(postCmds.some((c) => c.startsWith('set directories'))).toBe(true);
      expect(postCmds).toContain('set remote hardware-watchpoint-limit 2');
      expect(postCmds).toContain('set remote hardware-breakpoint-limit 2');
      expect(postCmds).toContain('set mem inaccessible-by-default off');
      expect(postCmds.some((c) => c.startsWith('mem 0x42000000'))).toBe(true);
      expect(postCmds).toContain('monitor reset init');
      expect(postCmds).toContain('thb setup');
      expect(postCmds).toContain('c');
      expect(cfg.preLaunchTask).toBe('cuttlefish: build + flash (debug)');

      // tasks.json: the task only builds + flashes (cortex-debug starts OpenOCD).
      const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
      const task = tasks.tasks[0];
      expect(task.label).toBe('cuttlefish: build + flash (debug)');
      expect(task.command).toContain('--debug');
      // Command must NOT embed OpenOCD — cortex-debug manages it.
      expect(task.command).not.toContain('openocd');
      expect(task.isBackground).toBeUndefined();

      // Idempotence: re-running must not duplicate the config/task.
      writeDebugConfig(opts);
      const launch2 = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
      expect(launch2.configurations).toHaveLength(1);
      const tasks2 = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
      expect(tasks2.tasks).toHaveLength(1);

      // openocd.cfg is generated next to the launch config, sources the board
      // cfg, and overrides the adapter speed AFTER the driver loads.
      const cfgPath = path.join(projectRoot, '.cuttlefish', 'openocd.cfg');
      expect(fs.existsSync(cfgPath)).toBe(true);
      const ocdCfg = fs.readFileSync(cfgPath, 'utf8');
      expect(ocdCfg).toContain('source [find board/esp32s3-builtin.cfg]');
      expect(ocdCfg).toContain('adapter speed 4000');
      const srcIdx = ocdCfg.split('\n').findIndex((l) => l.startsWith('source [find'));
      const speedIdx = ocdCfg.split('\n').findIndex((l) => l.startsWith('adapter speed'));
      expect(srcIdx).toBeGreaterThanOrEqual(0);
      expect(speedIdx).toBeGreaterThan(srcIdx);

      // No settings.json is written — the session runs its own OpenOCD via
      // cortex-debug's servertype, so there's no idf.openOcdConfigs dependency.
      expect(fs.existsSync(path.join(workspaceRoot, '.vscode', 'settings.json'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not emit a gdb-script source command when no source map is provided', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-debugcfg-noscript-'));
    const projectRoot = path.join(tmp, 'project');
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    try {
      writeDebugConfig({
        projectRoot,
        workspaceRoot: tmp,
        sketchRel: 'project',
        target: 'esp32s3_devkitc',
        buildDir: path.join(projectRoot, 'build'),
        // no sourceMapPath
      });
      // launch.json postAttachCommands should NOT contain a `source ...` entry
      // when no source map / gdb-script is present.
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const postCmds = launch.configurations[0].postAttachCommands as string[];
      expect(postCmds.some((c) => c.startsWith('source '))).toBe(false);
      // No .cuttlefish-gdb.py written.
      expect(fs.existsSync(path.join(projectRoot, '.cuttlefish', '.cuttlefish-gdb.py'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('resolveDebugLocations', () => {
  it('walks up from the Zephyr app dir to the cuttlefish project root (cuttlefish.config.ts)', () => {
    // Layout: <tmp>/projectRoot/cuttlefish.config.ts
    //         <tmp>/projectRoot/src/out/  <- Zephyr app dir (projectRoot arg)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-debug-'));
    const cfgDir = path.join(tmp, 'projectRoot');
    const appDir = path.join(cfgDir, 'src', 'out');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'cuttlefish.config.ts'), '// stub');
    try {
      const { workspaceRoot, sketchRel } = resolveDebugLocations(appDir);
      // workspaceRoot is the cuttlefish config dir (where .vscode/ goes).
      expect(path.resolve(workspaceRoot)).toBe(path.resolve(cfgDir));
      // sketchRel is the app dir relative to the config dir.
      expect(sketchRel).toBe('src/out');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('falls back to projectRoot when no cuttlefish.config.ts ancestor exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-debug-nocfg-'));
    try {
      const { workspaceRoot, sketchRel } = resolveDebugLocations(tmp);
      expect(path.resolve(workspaceRoot)).toBe(path.resolve(tmp));
      // path.relative(x, x) === '' (same dir); the app dir IS the workspace.
      expect(sketchRel).toBe('');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
