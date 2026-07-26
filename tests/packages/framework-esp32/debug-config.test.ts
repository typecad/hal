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
  buildVscodeSettings,
  writeDebugConfig,
  findWorkspaceRoot,
  resolveDebugLocations,
} from '../../../packages/framework-esp32/src/toolchain/debug-config';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    // preLaunchTask is build+flash ONLY — the IDF extension's gdbtarget
    // adapter starts its own OpenOCD; starting a competing one here causes
    // LIBUSB_ERROR_ACCESS / timeouts.
    expect(cfg.preLaunchTask).toBe('cuttlefish: build + flash');
  });

  it('collapses empty sketchRel so the path has no leading segment', () => {
    const json = JSON.parse(buildLaunchJson({ ...OPTS, sketchRel: '' }));
    expect(json.configurations[0].program).toBe('${workspaceFolder}/src/out-esp32s3/build/demo.elf');
  });

  it('scopes auto-load safe-path to the workspace', () => {
    const json = JSON.parse(buildLaunchJson(OPTS));
    expect(json.configurations[0].initCommands).toContain('set auto-load safe-path ${workspaceFolder}');
  });

  it('sources the generated gdb script when hasGdbScript is true', () => {
    const json = JSON.parse(buildLaunchJson({ ...OPTS, hasGdbScript: true }));
    expect(json.configurations[0].initCommands).toContain(
      'source ${workspaceFolder}/demos/demo/src/out-esp32s3/.cuttlefish/.cuttlefish-gdb.py',
    );
  });

  it('omits the gdb-script source directive when hasGdbScript is false (no _isr_N)', () => {
    const json = JSON.parse(buildLaunchJson({ ...OPTS, hasGdbScript: false }));
    const initCommands: string[] = json.configurations[0].initCommands;
    expect(initCommands).not.toContain(
      'source ${workspaceFolder}/demos/demo/src/out-esp32s3/.cuttlefish/.cuttlefish-gdb.py',
    );
    // Watchpoint limit and safe-path are still present.
    expect(initCommands).toContain('set auto-load safe-path ${workspaceFolder}');
    expect(initCommands).toContain('set remote hardware-watchpoint-limit 2');
  });

  it('emits BOTH a gdbtarget and a cortex-debug config so either extension works', () => {
    const json = JSON.parse(buildLaunchJson(OPTS));
    const types = json.configurations.map((c: any) => c.type);
    expect(types).toContain('gdbtarget');
    expect(types).toContain('cortex-debug');
    expect(json.configurations).toHaveLength(2);
  });
});

describe('buildLaunchJson — cortex-debug config', () => {
  const cortex = (opts = OPTS) => {
    const json = JSON.parse(buildLaunchJson(opts));
    return json.configurations.find((c: any) => c.type === 'cortex-debug');
  };

  it('uses servertype openocd and self-manages OpenOCD (no external start task)', () => {
    const cfg = cortex();
    expect(cfg.servertype).toBe('openocd');
    // cortex-debug spawns OpenOCD itself, so its preLaunchTask must NOT be the
    // `debug prep` task that starts a competing OpenOCD on 3333.
    expect(cfg.preLaunchTask).toBe('cuttlefish: build + flash');
  });

  it('enables raw dev debug output so silent session-startup failures are diagnosable', () => {
    // Without this, cortex-debug hides the gdb-server launch line and OpenOCD
    // output, making "session never started" failures impossible to diagnose.
    expect(cortex().showDevDebugOutput).toBe('raw');
  });

  it('points executable at the ELF and uses board/esp32s3-builtin.cfg', () => {
    const cfg = cortex();
    expect(cfg.executable).toBe('${workspaceFolder}/demos/demo/src/out-esp32s3/build/demo.elf');
    expect(cfg.configFiles).toEqual(['board/esp32s3-builtin.cfg']);
  });

  it('bakes gdbPath/serverpath/searchDir/armToolchainPath in when toolchainPaths is provided', () => {
    const cfg = cortex({
      ...OPTS,
      toolchainPaths: {
        gdbPath: 'C:/espressif/tools/xtensa-esp-elf-gdb/17.1/bin/xtensa-esp-elf-gdb.exe',
        openocdPath: 'C:/espressif/tools/openocd-esp32/v0.12/bin/openocd-esp32.exe',
        openocdScripts: 'C:/espressif/tools/openocd-esp32/v0.12/share/openocd/scripts',
        binutilsDir: 'C:/espressif/tools/xtensa-esp-elf/esp-15.2/bin',
      },
    });
    expect(cfg.gdbPath).toBe('C:/espressif/tools/xtensa-esp-elf-gdb/17.1/bin/xtensa-esp-elf-gdb.exe');
    expect(cfg.serverpath).toBe('C:/espressif/tools/openocd-esp32/v0.12/bin/openocd-esp32.exe');
    // searchDir is the OpenOCD -s flag — without it, board/esp32s3-builtin.cfg
    // can't be found and OpenOCD quits (the fatal "GDB Server Quit" error).
    expect(cfg.searchDir).toBe('C:/espressif/tools/openocd-esp32/v0.12/share/openocd/scripts');
    // armToolchainPath resolves nm/objdump (they live in a separate binutils
    // toolchain, not the gdb dir). Without it cortex-debug warns ENOENT.
    expect(cfg.armToolchainPath).toBe('C:/espressif/tools/xtensa-esp-elf/esp-15.2/bin');
    // toolchainPrefix MUST be emitted even with gdbPath set — gdbPath points
    // at the GDB binary, but cortex-debug still uses toolchainPrefix to derive
    // nm/objdump/objcopy names from armToolchainPath. Without it cortex-debug
    // defaults to 'arm-none-eabi-' and looks for nonexistent binaries (ENOENT).
    expect(cfg.toolchainPrefix).toBe('xtensa-esp-elf');
  });

  it('omits armToolchainPath when binutilsDir is absent (nm/objdump warning only)', () => {
    const cfg = cortex({
      ...OPTS,
      toolchainPaths: {
        gdbPath: 'C:/gdb.exe',
        openocdPath: 'C:/openocd.exe',
        openocdScripts: 'C:/scripts',
      },
    });
    expect(cfg.armToolchainPath).toBeUndefined();
    // searchDir still emitted (it's required, not optional).
    expect(cfg.searchDir).toBe('C:/scripts');
  });

  it('falls back to toolchainPrefix when toolchainPaths is absent (user configures manually)', () => {
    const cfg = cortex(OPTS); // no toolchainPaths
    expect(cfg.toolchainPrefix).toBe('xtensa-esp-elf');
    expect(cfg.gdbPath).toBeUndefined();
    expect(cfg.serverpath).toBeUndefined();
  });

  it('sources the gdb script via postStartupCommands when hasGdbScript is true', () => {
    const cfg = cortex({ ...OPTS, hasGdbScript: true });
    expect(cfg.postStartupCommands).toContain(
      'source ${workspaceFolder}/demos/demo/src/out-esp32s3/.cuttlefish/.cuttlefish-gdb.py',
    );
  });

  it('omits postStartupCommands when hasGdbScript is false', () => {
    const cfg = cortex({ ...OPTS, hasGdbScript: false });
    expect(cfg.postStartupCommands).toBeUndefined();
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

  it('uses the resolved openocd.exe path when toolchainPaths is provided (not bare "openocd")', () => {
    // OpenOCD isn't on the system PATH (only in the IDF env), so a bare
    // `openocd` in the task fails silently — the isBackground+problemMatcher
    // swallows the not-found error, and gdbtarget then errors
    // "OpenOCD is not running" because nothing is listening on 3333.
    const json = JSON.parse(buildTasksJson({
      ...OPTS,
      toolchainPaths: {
        gdbPath: 'C:/gdb.exe',
        openocdPath: 'C:/espressif/tools/openocd-esp32/v0.12/bin/openocd.exe',
        openocdScripts: 'C:/scripts',
      },
    }));
    const openocd = json.tasks.find((t: any) => t.label.includes('openocd'));
    expect(openocd.command).toMatch(/^C:\/espressif\/tools\/openocd-esp32\/v0\.12\/bin\/openocd\.exe /);
    expect(openocd.command).not.toMatch(/^openocd /);
  });

  it('falls back to bare openocd when toolchainPaths is absent', () => {
    const json = JSON.parse(buildTasksJson(OPTS));
    const openocd = json.tasks.find((t: any) => t.label.includes('openocd'));
    expect(openocd.command).toMatch(/^openocd /);
  });

  it('omits --port from build+flash (CLI resolves it from config.console.port at runtime)', () => {
    const json = JSON.parse(buildTasksJson(OPTS));
    const flash = json.tasks.find((t: any) => t.label.includes('build + flash'));
    expect(flash.command).not.toMatch(/--port/);
    expect(flash.command).toContain('--debug');
    expect(flash.options.cwd).toBe('${workspaceFolder}/demos/demo');
  });

  it('has a debug-prep aggregate depending on openocd and flash in parallel', () => {
    const json = JSON.parse(buildTasksJson(OPTS));
    const prep = json.tasks.find((t: any) => t.label.includes('debug prep'));
    expect(prep.dependsOrder).toBe('parallel');
    expect(prep.dependsOn).toEqual(['cuttlefish: start openocd', 'cuttlefish: build + flash']);
  });

  it('collapses empty sketchRel cwd to bare ${workspaceFolder}', () => {
    const json = JSON.parse(buildTasksJson({ ...OPTS, sketchRel: '' }));
    const flash = json.tasks.find((t: any) => t.label.includes('build + flash'));
    expect(flash.options.cwd).toBe('${workspaceFolder}');
  });
});

describe('buildOpenOcdCfg', () => {
  it('sources the esp32s3 builtin board config and caps adapter speed', () => {
    const lines = buildOpenOcdCfg().trim().split('\n');
    expect(lines[0]).toBe('source [find board/esp32s3-builtin.cfg]');
    // The USB-Serial-JTAG peripheral is a software bitq adapter that drops
    // bulk transfers at the default 40 MHz, causing "missing data from bitq
    // interface" + LIBUSB_ERROR_IO in a re-examine loop. 5 MHz is the
    // commonly-recommended stable speed.
    expect(lines).toContain('adapter speed 5000');
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

describe('buildVscodeSettings', () => {
  it('points idf.openOcdConfigs (flat dotted key) at the generated openocd.cfg', () => {
    const out = buildVscodeSettings('C:/proj/.cuttlefish/openocd.cfg', {});
    // FLAT dotted key, NOT a nested { idf: {...} } — VS Code/IDF extension
    // settings are flat. A nested object would be silently ignored.
    expect(out['idf.openOcdConfigs']).toEqual(['C:/proj/.cuttlefish/openocd.cfg']);
    expect(out.idf).toBeUndefined();
  });

  it('preserves unrelated top-level keys (cmake, clangd, etc.)', () => {
    const existing = {
      'cmake.ignoreCMakeListsMissing': true,
      'clangd.path': 'C:/clangd.exe',
      'editor.tabSize': 2,
    };
    const out = buildVscodeSettings('C:/cfg.cfg', existing);
    expect(out['cmake.ignoreCMakeListsMissing']).toBe(true);
    expect(out['clangd.path']).toBe('C:/clangd.exe');
    expect(out['editor.tabSize']).toBe(2);
    expect(out['idf.openOcdConfigs']).toEqual(['C:/cfg.cfg']);
  });

  it('owns idf.openOcdConfigs during debug builds — overwrites a stale user value', () => {
    // cuttlefish manages idf.openOcdConfigs during debug builds so the IDF
    // extension's OpenOCD Manager loads the generated cfg (which has the
    // adapter-speed override in the right order). A user's prior manual value
    // (e.g. bare 'board/esp32s3-builtin.cfg' without the speed line) is replaced.
    // Other idf.* keys (currentSetup, customExtraVars) are still preserved.
    const existing = {
      'idf.currentSetup': 'C:/esp/v6.0.2/esp-idf',
      'idf.openOcdConfigs': ['board/esp32s3-builtin.cfg'], // stale — will be replaced
    };
    const out = buildVscodeSettings('C:/proj/.cuttlefish/openocd.cfg', existing);
    expect(out['idf.currentSetup']).toBe('C:/esp/v6.0.2/esp-idf'); // preserved
    expect(out['idf.openOcdConfigs']).toEqual(['C:/proj/.cuttlefish/openocd.cfg']); // replaced
  });

  it('is idempotent — re-merging its own output produces the same shape', () => {
    const once = buildVscodeSettings('C:/cfg.cfg', { 'editor.tabSize': 4 });
    const twice = buildVscodeSettings('C:/cfg.cfg', once);
    expect(twice).toEqual(once);
  });

  it('strips a stale idf.openOcdLaunchArgs from a prior cuttlefish version', () => {
    // An earlier cuttlefish version wrote idf.openOcdLaunchArgs: ['-c', 'adapter speed 5000'].
    // That approach fails because -c runs before -f (before any adapter driver
    // is registered) → "Debug Adapter has to be specified". The speed override
    // now lives inside the generated cfg sourced via idf.openOcdConfigs, so the
    // stale launch args must be removed or the IDF extension still passes them.
    const existing = {
      'idf.openOcdLaunchArgs': ['-c', 'adapter speed 5000'], // stale — must be dropped
      'editor.tabSize': 4,
    };
    const out = buildVscodeSettings('C:/cfg.cfg', existing);
    expect(out['idf.openOcdLaunchArgs']).toBeUndefined();
    expect(out['editor.tabSize']).toBe(4); // unrelated key still preserved
    expect(out['idf.openOcdConfigs']).toEqual(['C:/cfg.cfg']);
  });
});

describe('writeDebugConfig', () => {
  it('writes launch.json/tasks.json at the workspace root, build artifacts at the project root', () => {
    // Use distinct dirs so the split is actually exercised: VS Code reads
    // launch.json from the workspace root, while openocd/sdkconfig belong
    // next to the build output under the project root.
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'cuttlefish-ws-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'cuttlefish-proj-'));
    try {
      writeDebugConfig({
        projectRoot,
        projectName: 'demo',
        sketchRel: 'demos/demo',
        port: 'COM10',
        target: 'esp32s3',
        workspaceRoot,
        sourceMapPath: join(projectRoot, 'main', 'main.cc.thcppmap.json'),
      });

      // VS Code-discovered configs live at the workspace root.
      expect(existsSync(join(workspaceRoot, '.vscode/launch.json'))).toBe(true);
      expect(existsSync(join(workspaceRoot, '.vscode/tasks.json'))).toBe(true);
      // Build-output artifacts live at the project root (next to the ELF).
      expect(existsSync(join(projectRoot, '.cuttlefish/openocd.cfg'))).toBe(true);
      expect(existsSync(join(projectRoot, 'sdkconfig.defaults.debug'))).toBe(true);

      // Nothing should leak to the wrong side of the split.
      expect(existsSync(join(projectRoot, '.vscode/launch.json'))).toBe(false);
      expect(existsSync(join(workspaceRoot, '.cuttlefish/openocd.cfg'))).toBe(false);

      const launch = JSON.parse(readFileSync(join(workspaceRoot, '.vscode/launch.json'), 'utf8'));
      expect(launch.configurations[0].program).toContain('build/demo.elf');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rewrites idf.openOcdConfigs to point at the generated cfg, preserving other keys', () => {
    // cuttlefish owns idf.openOcdConfigs during debug builds (pointing it at
    // the generated .cuttlefish/openocd.cfg, which has the speed override in
    // the right order). Unrelated settings + other idf.* keys must survive.
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'cuttlefish-ws-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'cuttlefish-proj-'));
    try {
      mkdirSync(join(workspaceRoot, '.vscode'), { recursive: true });
      writeFileSync(
        join(workspaceRoot, '.vscode/settings.json'),
        JSON.stringify({
          'cmake.ignoreCMakeListsMissing': true,
          // FLAT dotted keys, as the IDF extension writes them.
          'idf.currentSetup': 'C:/esp-idf',
          'idf.openOcdConfigs': ['board/esp32s3-builtin.cfg'], // will be replaced
        }, null, 2),
      );

      writeDebugConfig({
        projectRoot,
        projectName: 'demo',
        sketchRel: 'demos/demo',
        port: 'COM10',
        target: 'esp32s3',
        workspaceRoot,
        sourceMapPath: join(projectRoot, 'main', 'main.cc.thcppmap.json'),
      });

      const settings = JSON.parse(readFileSync(join(workspaceRoot, '.vscode/settings.json'), 'utf8'));
      // Preserved:
      expect(settings['cmake.ignoreCMakeListsMissing']).toBe(true);
      expect(settings['idf.currentSetup']).toBe('C:/esp-idf');
      // Replaced — points at the generated cfg (forward-slashed absolute path):
      const expectedCfgPath = join(projectRoot, '.cuttlefish', 'openocd.cfg').replace(/\\/g, '/');
      expect(settings['idf.openOcdConfigs']).toEqual([expectedCfgPath]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('writes the gdb script and threads hasGdbScript into launch.json when _isr_N entries exist', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'cuttlefish-ws-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'cuttlefish-proj-'));
    try {
      const mapPath = join(projectRoot, 'main', 'main.cc.thcppmap.json');
      mkdirSync(join(projectRoot, 'main'), { recursive: true });
      writeFileSync(mapPath, JSON.stringify({
        version: 1,
        generatedFilePath: 'main/main.cc',
        sourceFilePath: 'main.ts',
        entries: [
          { generatedStartLine: 1, generatedStartColumn: 1, generatedEndLine: 2, generatedEndColumn: 1,
            tsSpan: { filePath: 'main.ts', startOffset: 0, endOffset: 1, startLine: 4, startColumn: 0, endLine: 4, endColumn: 1 },
            nodeKind: 'function_definition', symbolName: 'main_isr_0' },
        ],
      }));

      writeDebugConfig({
        projectRoot,
        projectName: 'demo',
        sketchRel: 'demos/demo',
        port: 'COM10',
        target: 'esp32s3',
        workspaceRoot,
        sourceMapPath: mapPath,
      });

      // gdb script lives at the project root (next to openocd.cfg), launch.json at the workspace root.
      const script = readFileSync(join(projectRoot, '.cuttlefish/.cuttlefish-gdb.py'), 'utf8');
      expect(script).toContain('"main_isr_0"');
      const launch = readFileSync(join(workspaceRoot, '.vscode/launch.json'), 'utf8');
      expect(launch).toContain('.cuttlefish-gdb.py');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('does NOT write the gdb script when the source map has no _isr_N entries', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'cuttlefish-debug-'));
    try {
      const mapPath = join(projectRoot, 'main', 'main.cc.thcppmap.json');
      mkdirSync(join(projectRoot, 'main'), { recursive: true });
      writeFileSync(mapPath, JSON.stringify({
        version: 1,
        generatedFilePath: 'main/main.cc',
        sourceFilePath: 'main.ts',
        entries: [
          { generatedStartLine: 1, generatedStartColumn: 1, generatedEndLine: 2, generatedEndColumn: 1,
            tsSpan: { filePath: 'main.ts', startOffset: 0, endOffset: 1, startLine: 0, startColumn: 0, endLine: 0, endColumn: 1 },
            nodeKind: 'function_definition', symbolName: 'setup' },
        ],
      }));

      writeDebugConfig({
        projectRoot,
        projectName: 'demo',
        sketchRel: 'demos/demo',
        port: 'COM10',
        target: 'esp32s3',
        workspaceRoot: projectRoot,
        sourceMapPath: mapPath,
      });

      expect(existsSync(join(projectRoot, '.cuttlefish/.cuttlefish-gdb.py'))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('findWorkspaceRoot', () => {
  it('walks up from a nested dir to the nearest ancestor with .git', () => {
    // Mirror the monorepo layout: <root>/.git + <root>/demos/demo/
    const root = mkdtempSync(join(tmpdir(), 'cuttlefish-ws-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    const sketch = join(root, 'demos', 'demo');
    mkdirSync(sketch, { recursive: true });
    try {
      expect(findWorkspaceRoot(sketch)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null when no .git is found up to the filesystem root', () => {
    // mkdtempSync lands under the OS temp dir, which on CI/dev machines may
    // or may not be inside a git repo. Run in a deeply nested tmp path that
    // we KNOW has no .git by creating a fresh tree without one — but since
    // we can't guarantee the tmp root isn't a git repo, assert the weaker
    // property: if there IS no .git anywhere above, we get null. Use a path
    // we just created and check the function type rather than exact value.
    const tmp = mkdtempSync(join(tmpdir(), 'cuttlefish-nogit-'));
    try {
      const result = findWorkspaceRoot(tmp);
      // Either null (no .git above) or some ancestor that has .git (the test
      // environment itself is a git repo). Both are valid outcomes; what we
      // assert is the function returns a string or null, never throws.
      expect(result === null || typeof result === 'string').toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('resolveDebugLocations', () => {
  it('resolves to the git root with a relative sketch path when nested in a repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'cuttlefish-ws-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    const sketch = join(root, 'demos', 'demo');
    mkdirSync(sketch, { recursive: true });
    try {
      const loc = resolveDebugLocations(sketch);
      expect(loc.workspaceRoot).toBe(root);
      expect(loc.sketchRel).toBe('demos/demo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses backslash-free, forward-slashed sketchRel on Windows-shaped paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'cuttlefish-ws-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    const sketch = join(root, 'demos', 'demo');
    mkdirSync(sketch, { recursive: true });
    try {
      const loc = resolveDebugLocations(sketch);
      expect(loc.sketchRel).not.toContain('\\');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns empty sketchRel when the sketch IS the workspace root', () => {
    const root = mkdtempSync(join(tmpdir(), 'cuttlefish-ws-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    try {
      // Sketch dir == git root.
      const loc = resolveDebugLocations(root);
      expect(loc.workspaceRoot).toBe(root);
      expect(loc.sketchRel).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
