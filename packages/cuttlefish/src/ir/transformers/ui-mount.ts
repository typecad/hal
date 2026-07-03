// ---------------------------------------------------------------------------
// ui.mount resolver — validates the requested driver against the active
// framework's supportedDisplayDrivers() and returns a DisplayInitOp.
//
// Fail-fast: an unsupported driver errors at transpile time, not at runtime.
// Mirrors the pin-conflict check philosophy.
// ---------------------------------------------------------------------------

import type { PlatformGraphicsStrategy, DisplayInitOp } from "../../api/shared/index.js";

export interface MountRequest {
  display: string;
  bus: string;
  cs: number;
  dc: number;
  rst: number;
  rotation?: number;
  backlight?: number;
  spiFrequency?: number;
  address?: number;
  reset?: number;
}

export class MountValidationError extends Error {
  constructor(driver: string, supported: ReadonlySet<string>) {
    super(
      `Unsupported display driver "${driver}". ` +
      `Supported by this framework: ${[...supported].join(", ") || "(none)"}.`,
    );
    this.name = "MountValidationError";
  }
}

export function resolveMount(
  req: MountRequest,
  strategy: PlatformGraphicsStrategy,
  viewport: { width: number; height: number },
): DisplayInitOp {
  const supported = strategy.supportedDisplayDrivers();
  if (!supported.has(req.display)) {
    throw new MountValidationError(req.display, supported);
  }
  return {
    operation: "display.init",
    bus: req.bus,
    cs: req.cs,
    dc: req.dc,
    rst: req.rst,
    width: viewport.width,
    height: viewport.height,
    driver: req.display,
    rotation: req.rotation,
    address: req.address,
    reset: req.reset,
    backlight: req.backlight,
    spiFrequency: req.spiFrequency,
  } as any;
}
