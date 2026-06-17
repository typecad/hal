// ---------------------------------------------------------------------------
// Native test pipeline
//
// Full pipeline for one test fixture:
//   read -> preprocess -> transpile -> compile -> run -> parse -> evaluate
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativePreprocess } from './native-preprocessor';
import { parseProtocolLines } from '@typecad/expect/parser';
import type { DescribeResult } from '@typecad/expect/types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NativeTestResult {
  passed: boolean;
  describes: DescribeResult[];
  debugOutput: string[];
  error?: string;
}

export function runNativeTest(fixturePath: string): NativeTestResult {
  const startTime = Date.now();
  const baseName = path.basename(fixturePath, '.test.ts').replace(/[^a-zA-Z0-9_]/g, '_');
  const packageRoot = path.resolve(__dirname, '..', '..');
  const buildDir = path.join(packageRoot, '.build', 'tests', baseName);

  // 1. Read fixture source
  let source: string;
  try {
    source = fs.readFileSync(fixturePath, 'utf8');
  } catch (e) {
    return { passed: false, describes: [], debugOutput: [], error: `Failed to read fixture: ${(e as Error).message}` };
  }

  // 2. Preprocess
  let preprocessed: string;
  try {
    preprocessed = nativePreprocess(source, path.basename(fixturePath));
  } catch (e) {
    return { passed: false, describes: [], debugOutput: [], error: `Preprocessing failed: ${(e as Error).message}` };
  }

  // 3. Set up build directory
  try {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.mkdirSync(buildDir, { recursive: true });
  } catch (e) {
    return { passed: false, describes: [], debugOutput: [], error: `Failed to create build dir: ${(e as Error).message}` };
  }

  // Rewrite relative imports for transpiler-support.ts
  const rewrittenSource = rewriteRelativeImports(preprocessed, fixturePath, buildDir);

  const tsPath = path.join(buildDir, `${baseName}.ts`);
  fs.writeFileSync(tsPath, rewrittenSource, 'utf8');

  const hasRelativeImports = /from\s+['"]\.\.?\//.test(rewrittenSource);
  const expectedTranspileErrors = collectExpectedTranspileErrors(source);

  // Always write config so the CLI discovers framework-native
  writeBuildConfig(buildDir, baseName);

  // 4. Transpile via TypeCAD CLI (always use build mode for config discovery)
  const cliPath = path.resolve(packageRoot, '..', '..', 'packages', 'cuttlefish', 'dist', 'cli.js');

  const transpileResult = spawnSync(
    process.execPath,
    [cliPath, 'build', '--skip-type-check', '--force'],
    {
      encoding: 'utf8',
      cwd: buildDir,
      timeout: 60_000,
    },
  );

  if (transpileResult.status !== 0) {
    const output = `${transpileResult.stdout ?? ''}\n${transpileResult.stderr ?? ''}`.trim();
    if (expectedTranspileErrors.length > 0) {
      const missing = expectedTranspileErrors.filter(expected => !output.includes(expected));
      if (missing.length === 0) {
        return { passed: true, describes: [], debugOutput: output.split(/\r?\n/).filter(Boolean) };
      }
      return {
        passed: false,
        describes: [],
        debugOutput: [],
        error: `Transpilation failed, but did not include expected diagnostic text:\n${missing.join('\n')}\n\n${output}`,
      };
    }
    return { passed: false, describes: [], debugOutput: [], error: `Transpilation failed:\n${output}` };
  }

  if (expectedTranspileErrors.length > 0) {
    return {
      passed: false,
      describes: [],
      debugOutput: [],
      error: `Expected transpilation to fail with:\n${expectedTranspileErrors.join('\n')}`,
    };
  }

  // 5. Find the generated .cpp file
  const cppFile = findCppFile(buildDir, baseName);
  if (!cppFile) {
    return { passed: false, describes: [], debugOutput: [], error: `No .cpp file found in ${buildDir}` };
  }

  // Inline class definitions from support module .cpp files into the main .cpp
  // The transpiler puts forward declarations in headers but full class defs in
  // separate .cpp files. Since we only compile the main .cpp, we need to inline
  // the full definitions before their first use.
  inlineSupportClasses(cppFile, buildDir);

  // 6. Compile with g++/clang++
  const exeExt = process.platform === 'win32' ? '.exe' : '.out';
  const exeFile = cppFile.replace(/\.cpp$/, exeExt);

  const compileResult = spawnSync(
    'g++',
    ['-std=c++17', '-O2', '-Wall', '-o', exeFile, cppFile],
    {
      encoding: 'utf8',
      timeout: 120_000,
      env: resolveCompilerEnv(),
    },
  );

  if (compileResult.status !== 0) {
    const output = `${compileResult.stdout ?? ''}\n${compileResult.stderr ?? ''}`.trim();
    return { passed: false, describes: [], debugOutput: [], error: `Compilation failed:\n${output}` };
  }

  // 7. Run the executable and capture stdout
  const execResult = spawnSync(exeFile, [], {
    encoding: 'utf8',
    timeout: 10_000,
  });

  if (execResult.error) {
    return { passed: false, describes: [], debugOutput: [], error: `Execution failed: ${execResult.error.message}` };
  }

  const stdout = execResult.stdout ?? '';

  // 8. Parse protocol lines
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
  const protocolLines = lines.filter(l => l.startsWith('[TC:') && l.endsWith(']'));
  const debugOutput = lines.filter(l => !l.startsWith('[TC:'));

  const describes = parseProtocolLines(protocolLines);
  const passed = describes.every(d => d.passed);

  return { passed, describes, debugOutput };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findMatchingBrace(src: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectExpectedTranspileErrors(source: string): string[] {
  return Array.from(source.matchAll(/@cuttlefish-expect-transpile-error\s+([^\r\n]+)/g))
    .map(match => match[1]?.trim())
    .filter((value): value is string => !!value);
}

function inlineSupportClasses(cppPath: string, buildDir: string): void {
  // Find all .cpp files in the build output directory that are NOT the main file
  const cppDir = path.dirname(cppPath);
  if (!fs.existsSync(cppDir)) return;

  const entries = fs.readdirSync(cppDir);
  const supportCpps = entries.filter(
    e => e.endsWith('.cpp') && path.resolve(cppDir, e) !== cppPath,
  );

  if (supportCpps.length === 0) return;

  let mainSrc = fs.readFileSync(cppPath, 'utf8');
  const defsToInline: string[] = [];

  for (const supportCpp of supportCpps) {
    const supportPath = path.join(cppDir, supportCpp);
    const supportSrc = fs.readFileSync(supportPath, 'utf8');

    // Extract class definitions using findMatchingBrace for nested braces
    const classPattern = /class\s+(\w+)\s*\{/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classPattern.exec(supportSrc)) !== null) {
      const className = classMatch[1];
      const braceStart = classMatch.index + classMatch[0].lastIndexOf('{');
      const braceEnd = findMatchingBrace(supportSrc, braceStart);
      if (braceEnd === -1) continue;

      // Include the semicolon after the closing brace
      let end = braceEnd + 1;
      if (end < supportSrc.length && supportSrc[end] === ';') end++;

      const fullDef = supportSrc.substring(classMatch.index, end).trim();

      // Only inline if the main cpp uses this class
      if (mainSrc.includes(`new ${className}(`) || mainSrc.includes(`${className}*`)) {
        defsToInline.push(fullDef);
      }
    }

    // Also extract standalone functions (not templates, not String() overloads)
    const funcPattern = /\n(double|int|void|long long|bool)\s+(\w+)\s*\([^)]*\)\s*\{/g;
    let funcMatch: RegExpExecArray | null;
    while ((funcMatch = funcPattern.exec(supportSrc)) !== null) {
      const funcName = funcMatch[2];
      const funcStart = funcMatch.index;
      const braceStart = supportSrc.indexOf('{', funcStart);
      const braceEnd = findMatchingBrace(supportSrc, braceStart);
      if (braceEnd === -1) continue;

      const fullFunc = supportSrc.substring(funcStart, braceEnd + 1).trim();

      // Only inline if the main cpp calls this function
      if (mainSrc.includes(funcName + '(') && !funcName.startsWith('__tc_') && funcName !== 'String') {
        defsToInline.push(fullFunc);
      }
    }

    // Also extract struct definitions
    const structPattern = /struct\s+(\w+)\s*\{/g;
    let structMatch: RegExpExecArray | null;
    while ((structMatch = structPattern.exec(supportSrc)) !== null) {
      const structName = structMatch[1];
      const braceStart = structMatch.index + structMatch[0].lastIndexOf('{');
      const braceEnd = findMatchingBrace(supportSrc, braceStart);
      if (braceEnd === -1) continue;

      let end = braceEnd + 1;
      if (end < supportSrc.length && supportSrc[end] === ';') end++;

      const fullDef = supportSrc.substring(structMatch.index, end).trim();

      if (mainSrc.includes(structName)) {
        defsToInline.push(fullDef);
      }
    }
  }

  if (defsToInline.length === 0) return;

  // Insert definitions before the first __tc_fn function definition
  const insertPoint = mainSrc.search(/\n(double|int|long long|void)\s+__tc_fn1\b/);
  if (insertPoint === -1) {
    // Try to find the main() function and insert before it
    const mainPoint = mainSrc.indexOf('\nint main()');
    if (mainPoint !== -1) {
      mainSrc =
        mainSrc.substring(0, mainPoint) +
        '\n' + defsToInline.join('\n\n') + '\n' +
        mainSrc.substring(mainPoint);
    }
  } else {
    mainSrc =
      mainSrc.substring(0, insertPoint) +
      '\n' + defsToInline.join('\n\n') +
      mainSrc.substring(insertPoint);
  }

  fs.writeFileSync(cppPath, mainSrc, 'utf8');
}

function findCppFile(buildDir: string, baseName: string): string | undefined {
  const candidates = [
    buildDir,
    path.join(buildDir, baseName),
    path.join(buildDir, 'out', baseName),
    path.join(buildDir, 'out', '.build'),
    path.join(buildDir, 'out'),
  ];

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir);
    const cpp = entries.find(e => e.endsWith('.cpp'));
    if (cpp) return path.join(dir, cpp);
  }

  // Recursive search
  return findCppRecursive(buildDir);
}

function findCppRecursive(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.cpp')) return path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findCppRecursive(path.join(dir, entry.name));
      if (found) return found;
    }
  }
  return undefined;
}

function rewriteRelativeImports(source: string, originalFilePath: string, buildDir: string): string {
  const originalDir = path.dirname(originalFilePath);
  return source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_match, quote: string, specifier: string) => {
    const resolvedPath = path.resolve(originalDir, specifier);
    let relativePath = path.relative(buildDir, resolvedPath).replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }
    return `from ${quote}${relativePath}${quote}`;
  });
}

function writeBuildConfig(buildDir: string, entryFileName: string): void {
  const configPath = path.join(buildDir, 'cuttlefish.config.ts');
  fs.writeFileSync(
    configPath,
    [
      `import type { TypeCADConfig } from '@typecad/hal';`,
      '',
      'const config: TypeCADConfig = {',
      `  entry: './${entryFileName}.ts',`,
      `  framework: '@typecad/framework-native',`,
      `  target: 'generic',`,
      '  output: {',
      `    outDir: './out',`,
      '  },',
      '};',
      '',
      'export default config;',
      '',
    ].join('\n'),
    'utf8',
  );
}

function resolveCompilerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // On Windows, check common MSYS2/MinGW paths
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\msys64\\ucrt64\\bin',
      'C:\\msys64\\mingw64\\bin',
    ];
    for (const binDir of candidates) {
      const gpp = path.join(binDir, 'g++.exe');
      if (fs.existsSync(gpp)) {
        env.PATH = `${binDir};${env.PATH ?? ''}`;
        return env;
      }
    }
  }
  return env;
}
