// ---------------------------------------------------------------------------
// Generic toolchain delegation
//
// Provides framework-agnostic compile/upload/monitor functions that delegate
// to whatever toolchain the active framework provides.
// ---------------------------------------------------------------------------

import { getLoadedFramework, hasLoadedFramework } from "../framework-registry";
import { loadFrameworkPackage } from "../framework-package";
import type { FrameworkToolchain } from "../framework-registry";
import type { ToolchainOptions, CompileResult, UploadResult } from "@typehal/core/shared";

function getToolchain(fromDir: string): FrameworkToolchain {
  if (hasLoadedFramework()) {
    const { toolchain } = getLoadedFramework();
    if (toolchain) return toolchain;
  }

  const mod = loadFrameworkPackage(undefined, fromDir);
  if (hasLoadedFramework()) {
    const { toolchain } = getLoadedFramework();
    if (toolchain) return toolchain;
  }

  throw new Error(
    "No framework toolchain available. Ensure a framework package with compile/upload support is installed."
  );
}

export function compileSource(options: ToolchainOptions): CompileResult {
  const toolchain = getToolchain(options.outputDir);
  return toolchain.compile(options);
}

export function uploadFirmware(options: ToolchainOptions): UploadResult {
  const toolchain = getToolchain(options.outputDir);
  if (!toolchain.upload) {
    throw new Error("The active framework does not support upload.");
  }
  return toolchain.upload(options);
}

export function monitorDevice(options: ToolchainOptions): void {
  const toolchain = getToolchain(options.outputDir);
  if (!toolchain.monitor) {
    throw new Error("The active framework does not support device monitoring.");
  }
  toolchain.monitor(options);
}
