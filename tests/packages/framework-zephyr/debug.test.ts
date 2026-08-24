// Unit tests for Zephyr `--debug` wiring: debugMode() target selection, the
// printf halt shim gating, and the gdb-mode artifact generators
// (debug-config.ts). These are pure unit tests — no hardware, no west build.

import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import {
  writeDebugConfig,
  writeProjectDebugArtifacts,
  generateGdbScript,
  resolveDebugLocations,
  discoverZephyrSdkRoots,
  gdbPathFromSdkRoot,
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

  it('selects gdb for blackpill (ST-Link probe method ships in the board package)', () => {
    expect(strategy.debugMode('blackpill_f411ce')).toBe('gdb');
    expect(strategy.debugMode('blackpill_f411ce/stm32f411xe')).toBe('gdb');
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

describe('gdbPathFromSdkRoot — per-architecture toolchain dir', () => {
  it('resolves the arm-zephyr-eabi GDB for ARM board targets', () => {
    const sdk = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-sdk-arm-'));
    const armBin = path.join(sdk, 'arm-zephyr-eabi', 'bin');
    fs.mkdirSync(armBin, { recursive: true });
    fs.writeFileSync(path.join(armBin, 'arm-zephyr-eabi-gdb.exe'), '');
    try {
      const p = gdbPathFromSdkRoot(sdk, 'blackpill_f411ce/stm32f411xe');
      expect(p).toBeTruthy();
      expect(p!.replace(/\\/g, '/')).toContain('arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb.exe');
      // Xtensa targets must not resolve against an ARM-only SDK layout.
      expect(gdbPathFromSdkRoot(sdk, 'esp32s3_devkitc')).toBeUndefined();
    } finally {
      fs.rmSync(sdk, { recursive: true, force: true });
    }
  });

  it('keeps the xtensa-espressif default for esp32 targets and legacy no-target calls', () => {
    const sdk = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-sdk-xt-'));
    const xtBin = path.join(sdk, 'xtensa-espressif_esp32s3_zephyr-elf', 'bin');
    fs.mkdirSync(xtBin, { recursive: true });
    fs.writeFileSync(path.join(xtBin, 'xtensa-espressif_esp32s3_zephyr-elf-gdb.exe'), '');
    try {
      expect(gdbPathFromSdkRoot(sdk, 'esp32s3_devkitc')).toContain('xtensa-espressif_esp32s3');
      expect(gdbPathFromSdkRoot(sdk)).toContain('xtensa-espressif_esp32s3');
    } finally {
      fs.rmSync(sdk, { recursive: true, force: true });
    }
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

describe('writeDebugConfig — probe-method-driven artifacts (Black Pill stlink)', () => {
  it('shapes openocd.cfg + launch.json from the board probeMethods table (swd, no xtensa mem)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-dbg-bp-'));
    const projectRoot = path.join(tmp, 'src', 'out');
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    // The board constants carry the probeMethods table; the config selects
    // the method. resolveDebugProbeMethod reads both.
    try {
      const { resolveBoardConstants } = await import('../../../packages/cuttlefish/src/ir/board-resolver');
      const bc = resolveBoardConstants('boards/board-blackpill-f411ce/src/index.ts');
      fs.writeFileSync(path.join(projectRoot, 'src', 'board-constants.json'), JSON.stringify(Object.fromEntries(bc)));
      fs.writeFileSync(path.join(tmp, 'cuttlefish.config.ts'), "export default { zephyr: { probe: 'stlink' } } as any;");

      writeDebugConfig({
        projectRoot,
        workspaceRoot: tmp,
        sketchRel: 'src/out',
        target: 'blackpill_f411ce/stm32f411xe',
        buildDir: path.join(projectRoot, 'build'),
      });

      const cfgText = fs.readFileSync(path.join(projectRoot, '.cuttlefish', 'openocd.cfg'), 'utf8');
      expect(cfgText).toContain('source [find interface/stlink.cfg]');
      expect(cfgText).toContain('source [find target/stm32f4x.cfg]');
      expect(cfgText).toContain('reset_config none');

      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const cfg = launch.configurations[0];
      expect(cfg.name).toBe('TypeCAD Debug (Zephyr, blackpill_f411ce)');
      expect(cfg.servertype).toBe('openocd');
      expect(cfg.interface).toBe('swd');
      // The ESP32 flash-mapping commands are xtensa-only.
      expect(cfg.postAttachCommands.some((l: string) => l.includes('0x42000000'))).toBe(false);
      // No trailing `c`: an instant reset→thb-main stop would arrive while
      // cortex-debug is still initializing, leaving the session half-started.
      // The pending thb means the first user Continue stops at main().
      expect(cfg.postAttachCommands).toContain('monitor reset init');
      expect(cfg.postAttachCommands).toContain('thb main');
      expect(cfg.postAttachCommands).not.toContain('c');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
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
      expect(cfg.name).toBe('TypeCAD Debug (Zephyr, esp32s3_devkitc)');
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
      expect(postCmds).toContain('thb main');
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

describe('writeProjectDebugArtifacts — create-time starter artifacts', () => {
  it('writes launch.json + tasks.json + openocd.cfg under the starter src/out layout for esp32s3', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-'));
    try {
      const written = writeProjectDebugArtifacts({
        workspaceRoot: tmp,
        buildTarget: 'esp32s3_devkitc/esp32s3/procpu',
      });
      expect(written).toContain('.vscode/launch.json');
      expect(written).toContain('.vscode/tasks.json');
      expect(written).toContain('src/out/.cuttlefish/openocd.cfg');

      // All three artifacts exist under the scaffolded src/out app layout.
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const tasks = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'tasks.json'), 'utf8'));
      expect(fs.existsSync(path.join(tmp, 'src', 'out', '.cuttlefish', 'openocd.cfg'))).toBe(true);

      // The launch config targets the starter app's ELF + openocd cfg, and its
      // preLaunchTask pairs with the emitted task label (F5 wiring).
      const cfg = launch.configurations[0];
      expect(cfg.name).toBe('TypeCAD Debug (Zephyr, esp32s3_devkitc)');
      expect(cfg.executable).toBe('${workspaceFolder}/src/out/build/zephyr/zephyr.elf');
      expect(cfg.configFiles[0]).toBe('${workspaceFolder}/src/out/.cuttlefish/openocd.cfg');
      const task = tasks.tasks[0];
      expect(task.label).toBe(cfg.preLaunchTask);
      expect(task.command).toContain('--debug');
      // The task runs from the starter app dir, where cuttlefish.config.ts
      // resolution walks up to the project root.
      expect(task.options.cwd).toBe('${workspaceFolder}/src/out');

      // No gdb frame-filter script at create time (no source map exists yet).
      expect(fs.existsSync(path.join(tmp, 'src', 'out', '.cuttlefish', '.cuttlefish-gdb.py'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('is idempotent — re-running does not duplicate entries', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-idem-'));
    try {
      writeProjectDebugArtifacts({ workspaceRoot: tmp, buildTarget: 'esp32s3_devkitc' });
      writeProjectDebugArtifacts({ workspaceRoot: tmp, buildTarget: 'esp32s3_devkitc' });
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const tasks = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'tasks.json'), 'utf8'));
      expect(launch.configurations).toHaveLength(1);
      expect(tasks.tasks).toHaveLength(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('no-ops for printf targets and when no target is given', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-printf-'));
    try {
      expect(writeProjectDebugArtifacts({ workspaceRoot: tmp, buildTarget: 'xiao_ble' })).toEqual([]);
      expect(writeProjectDebugArtifacts({ workspaceRoot: tmp })).toEqual([]);
      expect(fs.existsSync(path.join(tmp, '.vscode'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('upgrades cleanly alongside the post-build writer (same entry names)', () => {
    // The starter artifacts and the post-build writeDebugConfig must merge
    // into the SAME launch entry / task (by name/label), not duplicate.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-upgrade-'));
    const appRoot = path.join(tmp, 'src', 'out');
    try {
      writeProjectDebugArtifacts({ workspaceRoot: tmp, buildTarget: 'esp32s3_devkitc' });
      writeDebugConfig({
        projectRoot: appRoot,
        workspaceRoot: tmp,
        sketchRel: 'src/out',
        target: 'esp32s3_devkitc',
        buildDir: path.join(appRoot, 'build'),
      });
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const tasks = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'tasks.json'), 'utf8'));
      expect(launch.configurations).toHaveLength(1);
      expect(tasks.tasks).toHaveLength(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('Zephyr SDK discovery (create-time gdbPath fallback)', () => {
  const fakeGdb = (sdkRoot: string): void => {
    const bin = path.join(sdkRoot, 'xtensa-espressif_esp32s3_zephyr-elf', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'xtensa-espressif_esp32s3_zephyr-elf-gdb.exe'), '');
  };

  it('gdbPathFromSdkRoot resolves only roots containing the esp32s3 gdb', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-sdkroot-'));
    try {
      const withGdb = path.join(tmp, 'sdk-a');
      fakeGdb(withGdb);
      expect(gdbPathFromSdkRoot(withGdb)).toContain('xtensa-espressif_esp32s3_zephyr-elf-gdb.exe');
      // Forward slashes — ${workspaceFolder}-style paths that GDB reads must
      // not carry backslash escapes.
      expect(gdbPathFromSdkRoot(withGdb)).not.toContain('\\');
      expect(gdbPathFromSdkRoot(path.join(tmp, 'sdk-empty'))).toBeUndefined();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('discovers SDK roots newest-version-first from the installer + standalone layouts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-sdks-'));
    const home = path.join(tmp, 'home');
    try {
      // Installer layout: <home>/micromamba/zephyr-sdk/zephyr-sdk-<ver>
      const installerBase = path.join(home, 'micromamba', 'zephyr-sdk');
      fs.mkdirSync(path.join(installerBase, 'zephyr-sdk-0.16.0'), { recursive: true });
      fs.mkdirSync(path.join(installerBase, 'zephyr-sdk-0.17.10'), { recursive: true });
      // Standalone layout: <home>/zephyr-sdk-<ver> (numeric compare: 0.17.4 < 0.17.10)
      fs.mkdirSync(path.join(home, 'zephyr-sdk-0.17.4'), { recursive: true });

      const roots = discoverZephyrSdkRoots({ home, env: {} });
      const names = roots.map((r) => path.basename(r));
      expect(names.indexOf('zephyr-sdk-0.17.10')).toBeLessThan(names.indexOf('zephyr-sdk-0.16.0'));
      expect(names.indexOf('zephyr-sdk-0.17.10')).toBeLessThan(names.indexOf('zephyr-sdk-0.17.4'));
      expect(roots).toHaveLength(3);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prefers $ZEPHYR_SDK_INSTALL_DIR over scanned locations', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-sdkenv-'));
    const home = path.join(tmp, 'home');
    try {
      fs.mkdirSync(path.join(home, 'zephyr-sdk-0.17.4'), { recursive: true });
      const envRoot = path.join(tmp, 'env-sdk');
      fs.mkdirSync(envRoot, { recursive: true });
      const roots = discoverZephyrSdkRoots({ home, env: { ZEPHYR_SDK_INSTALL_DIR: envRoot } });
      expect(roots[0]).toBe(path.resolve(envRoot));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
