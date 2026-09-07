// ---------------------------------------------------------------------------
// Generic toolchain delegation
//
// Provides framework-agnostic compile/upload/monitor functions that delegate
// to whatever toolchain the active framework provides.
// ---------------------------------------------------------------------------

import { getLoadedFramework, hasLoadedFramework } from "../framework-registry.js";
import { loadFrameworkPackage } from "../framework-package.js";
import type { FrameworkToolchain } from "../framework-registry.js";
import type { ToolchainOptions, CompileResult, UploadResult } from "../api/shared/index.js";

function getToolchain(fromDir: string, frameworkPackage?: string): FrameworkToolchain {
  if (hasLoadedFramework()) {
    const { toolchain } = getLoadedFramework();
    if (toolchain) return toolchain;
  }

  if (frameworkPackage) {
    loadFrameworkPackage(frameworkPackage, fromDir);
    if (hasLoadedFramework()) {
      const { toolchain } = getLoadedFramework();
      if (toolchain) return toolchain;
    }
  }

  throw new Error(
    "No framework toolchain available. Specify a framework package in your TypeCAD config " +
    "or ensure a framework with compile/upload support is installed."
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

export function debugServer(options: ToolchainOptions, action: "start" | "stop"): void {
  const toolchain = getToolchain(options.outputDir);
  if (!toolchain.debugServer) {
    throw new Error("The active framework does not provide a debug server.");
  }
  toolchain.debugServer(options, action);
}

export function monitorDevice(options: ToolchainOptions): void {
  const toolchain = getToolchain(options.outputDir);
  if (!toolchain.monitor) {
    throw new Error("The active framework does not support device monitoring.");
  }
  toolchain.monitor(options);
}
