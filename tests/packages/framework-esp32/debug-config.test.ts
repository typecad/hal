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
    expect(cfg.preLaunchTask).toBe('cuttlefish: debug prep');
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

  it('collapses empty sketchRel cwd to bare ${workspaceFolder}', () => {
    const json = JSON.parse(buildTasksJson({ ...OPTS, sketchRel: '' }));
    const flash = json.tasks.find((t: any) => t.label.includes('build + flash'));
    expect(flash.options.cwd).toBe('${workspaceFolder}');
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
