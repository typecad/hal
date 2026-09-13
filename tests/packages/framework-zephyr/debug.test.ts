// Unit tests for the west-driven debug wiring: facts-based debugMode()
// selection, the runners.yaml reader, and the cortex-debug external-server
// artifacts (launch.json + tasks.json). These are pure unit tests — no
// hardware, no west build.

import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import {
  writeDebugConfig,
  writeProjectDebugArtifacts,
  generateGdbScript,
  resolveDebugLocations,
  debugArtifactsNeedRewrite,
  DEBUG_BUILD_TASK,
  DEBUG_SERVER_TASK,
  DEBUG_SERVER_STOP_TASK,
  DEBUG_SERVER_PORT,
} from '../../../packages/framework-zephyr/src/toolchain/debug-config';
import { parseRunnersYaml } from '../../../packages/framework-zephyr/src/toolchain/runners';
import { scaffoldZephyrProject } from '../../../packages/framework-zephyr/src/toolchain/scaffold';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const strategy = new ZephyrStrategy();

describe('ZephyrStrategy.debugMode — facts-based target selection', () => {
  it('selects gdb for any board whose probe table carries a debug-capable method', () => {
    // blackpill: stlink (openocd, debug) — first debug-capable after dfu.
    expect(strategy.debugMode('blackpill_f411ce/stm32f411xe')).toBe('gdb');
    expect(strategy.debugMode('blackpill_f401ce/stm32f401xe')).toBe('gdb');
    // esp32s3: openocd over the built-in USB-JTAG.
    expect(strategy.debugMode('esp32s3_devkitc/esp32s3/procpu')).toBe('gdb');
    // xiao_ble: jlink/openocd entries in its table — gdb now that the gate
    // is the board's own facts (the old name allowlist kept it on printf).
    expect(strategy.debugMode('xiao_ble/nrf52840')).toBe('gdb');
  });

  it('reports none for boards without a debug-capable probe method', () => {
    // Bootloader-only table (bossac) and no table at all — 'none' both ways:
    // --debug errors on these targets (no printf instrumentation anymore).
    expect(strategy.debugMode('arduino_nano_33_iot/samd21g18a')).toBe('none');
    expect(strategy.debugMode('mps2/an385')).toBe('none');
    expect(strategy.debugMode(undefined)).toBe('none');
    expect(strategy.debugMode('')).toBe('none');
    // Unresolvable targets never crash the gate.
    expect(strategy.debugMode('no_such_board_xyz')).toBe('none');
  });
});

describe('parseRunnersYaml — west runner facts', () => {
  const FIXTURE = [
    '# Available runners configured by board.cmake.',
    'runners:',
    '- dfu-util',
    '- openocd',
    '- jlink',
    '',
    '# Default flash runner if --runner is not given.',
    'flash-runner: dfu-util',
    '',
    '# Default debug runner if --runner is not given.',
    'debug-runner: openocd',
    '',
    '# Common runner configuration values.',
    'config:',
    '  board_dir: C:/some/board',
    '  elf_file: zephyr.elf',
    '  gdb: C:/sdk/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb-py.exe',
    '  openocd: C:/sdk/hosttools/openocd/bin/openocd.exe',
    '  openocd_search:',
    '    - C:/sdk/hosttools/openocd/share/openocd/scripts',
    '    - C:/another/scripts',
    '',
    '# Runner specific arguments',
    'args:',
    '  dfu-util:',
    '    - --pid=0483:df11',
    '  jlink:',
    '    - --device=STM32F411CE',
    '',
  ].join('\n');

  it('extracts the debug runner, the arch gdb, and the runner list', () => {
    const facts = parseRunnersYaml(FIXTURE)!;
    expect(facts.debugRunner).toBe('openocd');
    expect(facts.gdb).toBe('C:/sdk/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb-py.exe');
    expect(facts.runners).toEqual(['dfu-util', 'openocd', 'jlink']);
  });

  it('parses the real blackpill runners.yaml shape (regression)', () => {
    // Byte-for-byte shape from a west 1.0 build of blackpill_f411ce.
    const facts = parseRunnersYaml(FIXTURE)!;
    expect(facts).toBeTruthy();
  });
});

describe('writeDebugConfig — cortex-debug external-server artifacts', () => {
  function fakeBuild(tmp: string, gdb: string): string {
    const projectRoot = path.join(tmp, 'src', 'out');
    const buildDir = path.join(projectRoot, 'build');
    fs.mkdirSync(path.join(buildDir, 'zephyr'), { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'zephyr', 'runners.yaml'), [
      'runners:', '- openocd', '- jlink', '',
      'flash-runner: openocd', 'debug-runner: openocd', '',
      'config:', `  gdb: ${gdb}`, '',
    ].join('\n'));
    return projectRoot;
  }

  it('writes an external-mode launch entry wired to the west server + the three tasks', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-dbg-west-'));
    try {
      const projectRoot = fakeBuild(tmp, 'C:/sdk/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb.exe');
      const written = writeDebugConfig({
        projectRoot,
        workspaceRoot: tmp,
        appRel: 'src/out',
        target: 'blackpill_f411ce/stm32f411xe',
        buildDir: path.join(projectRoot, 'build'),
      });
      expect(written).toContain('.vscode/launch.json');
      expect(written).toContain('.vscode/tasks.json');

      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const cfg = launch.configurations[0];
      expect(cfg.type).toBe('cortex-debug');
      expect(cfg.servertype).toBe('external');
      expect(cfg.gdbTarget).toBe(`localhost:${DEBUG_SERVER_PORT}`);
      // gdb comes from west's resolved facts, not SDK-layout guessing.
      expect(cfg.gdbPath).toBe('C:/sdk/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb.exe');
      expect(cfg.executable).toBe('${workspaceFolder}/src/out/build/zephyr/zephyr.elf');
      // The gdb server lifecycle is west's — no configFiles, no serverpath.
      expect(cfg.configFiles).toBeUndefined();
      expect(cfg.serverpath).toBeUndefined();
      // ARM gdb: no Xtensa flash-mapping commands, no trailing continue.
      expect(cfg.postAttachCommands.some((l: string) => l.includes('0x42000000'))).toBe(false);
      expect(cfg.postAttachCommands).not.toContain('c');
      // The server task IS the preLaunchTask (VS Code only auto-runs one
      // task); it depends on the build+flash task.
      expect(cfg.preLaunchTask).toBe(DEBUG_SERVER_TASK);
      expect(cfg.postDebugTask).toBe(DEBUG_SERVER_STOP_TASK);

      const tasks = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'tasks.json'), 'utf8'));
      const labels = tasks.tasks.map((t: { label: string }) => t.label);
      expect(labels).toContain(DEBUG_BUILD_TASK);
      expect(labels).toContain(DEBUG_SERVER_TASK);
      expect(labels).toContain(DEBUG_SERVER_STOP_TASK);
      const server = tasks.tasks.find((t: { label: string }) => t.label === DEBUG_SERVER_TASK);
      expect(server.isBackground).toBe(true);
      // ONE self-contained task — no dependsOn (VS Code awaits the whole
      // dependency group; a never-exiting background child hangs F5).
      expect(server.command).toContain('debug-server start --flash');
      expect(server.dependsOn).toBeUndefined();
      // NO_COLOR keeps chalk's ANSI codes from breaking the background
      // patterns (the "task has not exited" prompt otherwise appears).
      expect(server.options.env.NO_COLOR).toBe('1');
      // The matcher pattern must never match a real line — matched lines
      // become file-less ERROR problems and VS Code blocks F5 ("errors
      // exist after running preLaunchTask"). ^$ matched openocd's blank
      // lines; the sentinel cannot occur in any output.
      expect(server.problemMatcher.pattern.regexp).toBe('__cuttlefish_never_matches__');
      // The matcher's endsPattern gates the debug session on the ready marker.
      expect(server.problemMatcher.background.endsPattern)
        .toBe(`^TYPECAD_HAL: debug server ready on ${DEBUG_SERVER_PORT}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Xtensa gdb facts switch in the flash-mapping commands + trailing continue', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-dbg-west-xtensa-'));
    try {
      const projectRoot = fakeBuild(tmp, 'C:/sdk/gnu/xtensa-espressif_esp32s3_zephyr-elf/bin/xtensa-espressif_esp32s3_zephyr-elf-gdb.exe');
      writeDebugConfig({
        projectRoot,
        workspaceRoot: tmp,
        appRel: 'src/out',
        target: 'esp32s3_devkitc/esp32s3/procpu',
        buildDir: path.join(projectRoot, 'build'),
      });
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const cmds = launch.configurations[0].postAttachCommands as string[];
      expect(cmds.some((l) => l.includes('set mem inaccessible-by-default off'))).toBe(true);
      expect(cmds.some((l) => l.includes('mem 0x42000000 0x44000000 ro cache'))).toBe(true);
      expect(cmds[cmds.length - 1]).toBe('c');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prefers the plain (non -py) gdb sibling — cortex-debug derives objdump/nm from it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-dbg-west-py-'));
    try {
      // A -py gdb in runners.yaml whose PLAIN sibling exists on disk → the
      // plain one wins: cortex-debug derives objdump/nm paths from the gdb
      // path by name substitution, and the -py variants of those don't exist
      // in the SDK (ENOENT noise, degraded symbol classification).
      const bin = path.join(tmp, 'sdk', 'arm-zephyr-eabi', 'bin').split(path.sep).join('/');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(`${bin}/arm-zephyr-eabi-gdb.exe`, '');
      fs.writeFileSync(`${bin}/arm-zephyr-eabi-gdb-py.exe`, '');
      const projectRoot = fakeBuild(tmp, `${bin}/arm-zephyr-eabi-gdb-py.exe`);
      writeDebugConfig({
        projectRoot, workspaceRoot: tmp, appRel: 'src/out',
        target: 'blackpill_f411ce/stm32f411xe',
        buildDir: path.join(projectRoot, 'build'),
      });
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      expect(launch.configurations[0].gdbPath).toBe(`${bin}/arm-zephyr-eabi-gdb.exe`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('without runners.yaml (pre-build) the entry is written without gdbPath', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-dbg-west-prebuild-'));
    const projectRoot = path.join(tmp, 'src', 'out');
    fs.mkdirSync(projectRoot, { recursive: true });
    try {
      writeDebugConfig({
        projectRoot,
        workspaceRoot: tmp,
        appRel: 'src/out',
        target: 'blackpill_f411ce/stm32f411xe',
        buildDir: path.join(projectRoot, 'build'),
      });
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      expect(launch.configurations[0].gdbPath).toBeUndefined();
      // …and that starter state needs an upgrade on the next build.
      expect(debugArtifactsNeedRewrite(tmp, 'src/out')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('debugArtifactsNeedRewrite — the plain-build self-heal gate', () => {
  const writeLaunch = (tmp: string, configurations: unknown[]): void => {
    fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.vscode', 'launch.json'), JSON.stringify({ configurations }));
  };
  const ours = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'TypeCAD Debug (Zephyr, blackpill_f411ce)',
    servertype: 'external',
    gdbPath: 'C:/sdk/gdb.exe',
    executable: '${workspaceFolder}/src/out/build/zephyr/zephyr.elf',
    ...over,
  });

  it('needs a rewrite for stale shapes: foreign app root, missing gdbPath, self-managed server', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-needrewrite-'));
    try {
      writeLaunch(tmp, [ours({ executable: '${workspaceFolder}/src/generated/build/zephyr/zephyr.elf' })]);
      expect(debugArtifactsNeedRewrite(tmp, 'src/out')).toBe(true); // outDir moved

      writeLaunch(tmp, [ours({ gdbPath: undefined })]);
      expect(debugArtifactsNeedRewrite(tmp, 'src/out')).toBe(true); // create-time starter

      writeLaunch(tmp, [ours({ servertype: 'openocd', configFiles: ['x'] })]);
      expect(debugArtifactsNeedRewrite(tmp, 'src/out')).toBe(true); // pre-west shape

      writeLaunch(tmp, [ours()]);
      expect(debugArtifactsNeedRewrite(tmp, 'src/out')).toBe(false); // current
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('is false with no launch.json or user-authored entries only', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-needrewrite-none-'));
    try {
      expect(debugArtifactsNeedRewrite(tmp, 'src/out')).toBe(false);
      writeLaunch(tmp, [{ name: 'my session', servertype: 'openocd', executable: '${workspaceFolder}/elsewhere/app.elf' }]);
      expect(debugArtifactsNeedRewrite(tmp, 'src/out')).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('writeProjectDebugArtifacts — create-time starter artifacts', () => {
  it('writes the external-mode entry + tasks (no gdbPath — no build exists yet)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-west-'));
    try {
      const written = writeProjectDebugArtifacts({
        workspaceRoot: tmp,
        buildTarget: 'blackpill_f411ce/stm32f411xe',
      });
      expect(written).toContain('.vscode/launch.json');
      expect(written).toContain('.vscode/tasks.json');

      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const cfg = launch.configurations[0];
      expect(cfg.servertype).toBe('external');
      expect(cfg.gdbTarget).toBe(`localhost:${DEBUG_SERVER_PORT}`);
      expect(cfg.gdbPath).toBeUndefined();
      expect(cfg.executable).toBe('${workspaceFolder}/src/out/build/zephyr/zephyr.elf');
      // The gdb frame-filter script needs a source map — none at create time.
      expect(fs.existsSync(path.join(tmp, 'src', 'out', '.typecad-hal', '.typecad-hal-gdb.py'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('seeds the entry with the create-time starter gdb (fresh-project first F5 finds gdb)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-gdb-'));
    try {
      writeProjectDebugArtifacts({
        workspaceRoot: tmp,
        buildTarget: 'blackpill_f411ce/stm32f411xe',
        gdbPath: 'C:/sdk/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb.exe',
      });
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      expect(launch.configurations[0].gdbPath)
        .toBe('C:/sdk/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb.exe');
      // A wrong create-time silicon guess is corrected on the first build:
      // the rewrite gate flags an entry whose gdbPath differs from west's
      // runners.yaml resolution.
      expect(debugArtifactsNeedRewrite(tmp, 'src/out', 'C:/real/sdk/arm-zephyr-eabi-gdb.exe')).toBe(true);
      expect(debugArtifactsNeedRewrite(
        tmp, 'src/out', 'C:/sdk/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb.exe')).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('no-ops for probe-less boards and when no target is given', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-none-'));
    try {
      expect(writeProjectDebugArtifacts({ workspaceRoot: tmp, buildTarget: 'arduino_nano_33_iot/samd21g18a' })).toEqual([]);
      expect(writeProjectDebugArtifacts({ workspaceRoot: tmp })).toEqual([]);
      expect(fs.existsSync(path.join(tmp, '.vscode'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('lands the starter artifacts under a non-default appRel (renamed outDir scaffold)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-apprel-'));
    try {
      writeProjectDebugArtifacts({
        workspaceRoot: tmp,
        buildTarget: 'blackpill_f411ce/stm32f411xe',
        appRel: 'src/gen',
      });
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      expect(launch.configurations[0].executable)
        .toBe('${workspaceFolder}/src/gen/build/zephyr/zephyr.elf');
      expect(fs.existsSync(path.join(tmp, 'src', 'out'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('is idempotent — re-running does not duplicate entries', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-starterdbg-idem-'));
    try {
      writeProjectDebugArtifacts({ workspaceRoot: tmp, buildTarget: 'blackpill_f411ce/stm32f411xe' });
      writeProjectDebugArtifacts({ workspaceRoot: tmp, buildTarget: 'blackpill_f411ce/stm32f411xe' });
      const launch = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'launch.json'), 'utf8'));
      const tasks = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'tasks.json'), 'utf8'));
      expect(launch.configurations).toHaveLength(1);
      expect(tasks.tasks).toHaveLength(3); // build+flash, server, stop
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('resolveDebugLocations', () => {
  it('walks up from the Zephyr app dir to the typecad-hal project root (typecad-hal.config.ts)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-resloc-'));
    const appRoot = path.join(tmp, 'src', 'out');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'typecad-hal.config.ts'), 'export default {} as any;');
    try {
      const { workspaceRoot, appRel } = resolveDebugLocations(appRoot);
      expect(workspaceRoot).toBe(tmp);
      expect(appRel).toBe('src/out');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('falls back to projectRoot when no typecad-hal.config.ts ancestor exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-resloc-bare-'));
    try {
      const { workspaceRoot, appRel } = resolveDebugLocations(tmp);
      expect(workspaceRoot).toBe(tmp);
      expect(appRel).toBe('');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('generateGdbScript — conditional lambda frame filter', () => {
  it('returns null when no source map is provided', () => {
    expect(generateGdbScript(undefined)).toBeNull();
  });

  it('returns null when the source map has no _isr_N symbols', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-gdbscript-'));
    try {
      const mapPath = path.join(tmp, 'map.thcppmap.json');
      fs.writeFileSync(mapPath, JSON.stringify({ mappings: {} }));
      expect(generateGdbScript(mapPath)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns the frame-filter script when _isr_N symbols are present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-gdbscript-2-'));
    try {
      const mapPath = path.join(tmp, 'map.thcppmap.json');
      fs.writeFileSync(mapPath, JSON.stringify({ symbolTable: { _isr_1: {} } }));
      const script = generateGdbScript(mapPath)!;
      expect(script).toContain('CuttlefishLambdaFilter');
      expect(script).toContain('gdb.frame_filters');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('scaffoldZephyrProject — debug Kconfigs', () => {
  it('adds CONFIG_DEBUG + CONFIG_DEBUG_OPTIMIZATIONS when debug=true', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-kconfig-dbg-'));
    try {
      scaffoldZephyrProject(tmp, true, undefined, undefined);
      const conf = fs.readFileSync(path.join(tmp, 'prj.conf'), 'utf8');
      expect(conf).toContain('CONFIG_DEBUG=y');
      expect(conf).toContain('CONFIG_DEBUG_OPTIMIZATIONS=y');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('omits debug Kconfigs when debug=false (default)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-kconfig-nodbg-'));
    try {
      scaffoldZephyrProject(tmp, false, undefined, undefined);
      const conf = fs.readFileSync(path.join(tmp, 'prj.conf'), 'utf8');
      expect(conf).not.toContain('CONFIG_DEBUG=y');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
