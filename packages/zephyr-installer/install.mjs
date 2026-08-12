#!/usr/bin/env node
// ---------------------------------------------------------------------------
// typeCAD Zephyr installer — cross-platform dispatcher.
//
// One command that works identically on Linux, macOS, and Windows:
//
//   node packages/zephyr-installer/install.mjs [--dry-run] [--no-sdk]
//                                              [--no-workspace]
//                                              [--env-name NAME]
//                                              [--sdk-version VER]
//
// Node is a hard dependency of this monorepo (cuttlefish, vitest, the whole
// workspace), so `node install.mjs` is the natural universal entry point — it
// needs no bash, no PowerShell preview, no preinstalled conda. It detects the
// host platform and delegates to the native installer script:
//
//   POSIX   →  bash install.sh   (args forwarded verbatim)
//   Windows →  pwsh install.ps1  (args translated to PowerShell param names;
//              falls back to Windows PowerShell 5.1 if pwsh is absent)
//
// The OS-native scripts (install.sh / install.ps1) remain usable directly for
// users who prefer them; this dispatcher removes the "which command?" question.
//
// translateToPwsh is exported so the Windows flag translation can be unit-
// tested on POSIX hosts that have no PowerShell. The dispatch body only runs
// when this file is the node entry point, not when imported.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

// Translate the user-facing POSIX-style flags into the PowerShell param names
// install.ps1 declares. Keeps the documented flag vocabulary identical across
// platforms; the OS-native scripts remain idiomatically written.
export function translateToPwsh(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':      out.push('-DryRun'); break;
      case '--no-sdk':       out.push('-NoSdk'); break;
      case '--no-workspace': out.push('-NoWorkspace'); break;
      case '--env-name':     out.push('-EnvName', args[++i]); break;
      case '--sdk-version':  out.push('-SdkVersion', args[++i]); break;
      default:               out.push(args[i]);
    }
  }
  return out;
}

// Try each candidate executable in order; advance on ENOENT so the caller can
// express "prefer pwsh, fall back to powershell" without probing PATH itself.
function runWithFallback(exes, args) {
  return new Promise((resolve, reject) => {
    const tryOne = (idx) => {
      if (idx >= exes.length) {
        reject(new Error(`none found on PATH: ${exes.join(', ')}`));
        return;
      }
      const child = spawn(exes[idx], args, { stdio: 'inherit' });
      child.on('error', (err) => {
        if (err && err.code === 'ENOENT') tryOne(idx + 1);
        else reject(err);
      });
      child.on('exit', (code, signal) => resolve({ code, signal }));
    };
    tryOne(0);
  });
}

// Only dispatch when invoked directly as `node install.mjs`, not when imported
// (the test suite imports translateToPwsh without triggering a dispatch).
const invokedDirectly = fileURLToPath(import.meta.url) === resolve(process.argv[1] || '');

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const promise = isWin
    ? runWithFallback(
        ['pwsh', 'powershell'],
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'install.ps1'), ...translateToPwsh(argv)],
      )
    : runWithFallback(['bash'], [join(here, 'install.sh'), ...argv]);

  promise
    .then(({ code, signal }) => {
      if (signal) process.exit(128);
      process.exit(code ?? 1);
    })
    .catch((err) => {
      console.error(`typecad-zephyr-install: ${err.message}`);
      if (isWin) {
        console.error('  Windows needs PowerShell, which ships with Windows 10+.');
        console.error('  If you have Git Bash, you can instead run: bash install.sh');
      } else {
        console.error('  POSIX hosts need bash. Install it, or on Windows use:');
        console.error('    pwsh -File install.ps1   (or powershell -File install.ps1)');
      }
      process.exit(1);
    });
}
