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

  it('collapses sketchRel="." so the path has no ./ segment', () => {
    const json = JSON.parse(buildLaunchJson({ ...OPTS, sketchRel: '.' }));
    expect(json.configurations[0].program).toBe('${workspaceFolder}/src/out-esp32s3/build/demo.elf');
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

describe('writeDebugConfig', () => {
  it('writes all four core artifacts under the project out dir', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'cuttlefish-debug-'));
    try {
      writeDebugConfig({
        projectRoot,
        projectName: 'demo',
        sketchRel: 'demos/demo',
        port: 'COM10',
        target: 'esp32s3',
        workspaceRoot: projectRoot,
        sourceMapPath: join(projectRoot, 'main', 'main.cc.thcppmap.json'),
      });

      expect(existsSync(join(projectRoot, '.vscode/launch.json'))).toBe(true);
      expect(existsSync(join(projectRoot, '.vscode/tasks.json'))).toBe(true);
      expect(existsSync(join(projectRoot, '.cuttlefish/openocd.cfg'))).toBe(true);
      expect(existsSync(join(projectRoot, 'sdkconfig.defaults.debug'))).toBe(true);

      const launch = JSON.parse(readFileSync(join(projectRoot, '.vscode/launch.json'), 'utf8'));
      expect(launch.configurations[0].program).toContain('build/demo.elf');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('writes the gdb script when a source map with _isr_N entries is provided', () => {
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
        workspaceRoot: projectRoot,
        sourceMapPath: mapPath,
      });

      const script = readFileSync(join(projectRoot, '.cuttlefish/.cuttlefish-gdb.py'), 'utf8');
      expect(script).toContain('"main_isr_0"');
    } finally {
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
