// ---------------------------------------------------------------------------
// Config Schema — Zod validation for cuttlefish.config.ts parsed values
//
// After the AST-based config loader extracts scalar/structured values from
// cuttlefish.config.ts, this schema validates the shape, required fields, and
// enum constraints before the config is used by the transpiler.
// ---------------------------------------------------------------------------

import { z } from 'zod';

/** PSRAM types accepted by the top-level `psram` field (ESP32 PSRAM variants). */
const PsramType = z.enum(['opi', 'quad']);

/** Schema for the `output` section. */
const OutputConfig = z.object({
  framework: z.string().min(1).optional(),
  outDir: z.string().optional(),
  defines: z.record(z.string(), z.string()).optional(),
  extraFlags: z.array(z.string()).optional(),
}).strict();

/** Schema for the `console` section. */
const ConsoleConfig = z.object({
  baudRate: z.number().int().positive().optional(),
  port: z.string().optional(),
  /** Where console.log output goes. 'default' (omitted) is the board's own
   *  console (its devicetree `zephyr,console` node — often a UART on
   *  dedicated pins). 'usb' routes it to the USB CDC serial port instead,
   *  on boards that expose one. */
  output: z.enum(['default', 'usb']).optional(),
}).strict();

/** Schema for the `test` section. */
const TestConfig = z.object({
  include: z.array(z.string()).optional(),
  port: z.string().optional(),
  baudRate: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  buildTarget: z.string().optional(),
  board: z.string().optional(),
}).strict();

/** Schema for the `toolchain` section. */
const ToolchainConfig = z.object({
  type: z.string().optional(),
  frameworkOptions: z.record(z.string(), z.unknown()).optional(),
}).strict();

/** Schema for the `zephyr` section. */
const ZephyrConfig = z.object({
  kconfig: z.record(z.string(), z.string()).optional(),
  cmakeArgs: z.array(z.string()).optional(),
  probe: z.string().optional(),
  runner: z.string().optional(),
  runnerArgs: z.array(z.string()).optional(),
  /** Generate an out-of-tree Zephyr board for an MCU-only target (no board
   *  package): the framework emits boards/typecad/<buildTarget>/ from the
   *  MCU package's silicon data (SoC, console, clock plan). The board is
   *  named after `frameworkData.buildTarget`. */
  customBoard: z.boolean().optional(),
}).strict();

/**
 * Schema for the full CuttlefishConfig shape.
 *
 * `target` and `board` are required. Everything else is optional.
 */
export const CuttlefishConfigSchema = z.object({
  entry: z.string().optional(),
  target: z.string().min(1).optional(),
  mcu: z.string().min(1).optional(),
  board: z.string().optional(),
  contract: z.string().optional(),
  framework: z.string().optional(),
  /** ESP32 PSRAM type. When set, the framework emits the PSRAM-enabling
   *  Kconfig/define so canvas allocations prefer external RAM (large scroll
   *  viewports/lists stop failing on PSRAM targets). No effect on boards
   *  without PSRAM (the runtime falls back to SRAM then the band renderer). */
  psram: PsramType.optional(),
  output: OutputConfig.optional(),
  frameworkData: z.record(z.string(), z.unknown()).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  test: TestConfig.optional(),
  toolchain: ToolchainConfig.optional(),
  console: ConsoleConfig.optional(),
  native: z.record(z.string(), z.unknown()).optional(),
  /** Display profile config (driver, wiring, touch) — loosely typed here so
   *  the loader's presence/shape extraction round-trips through validation. */
  display: z.record(z.string(), z.unknown()).optional(),
  zephyr: ZephyrConfig.optional(),
}).strict().refine(data => !(data.board && data.contract), {
  message: "Specifying both 'board' and 'contract' is not allowed. Choose one.",
  path: ['board'],
});

/** Inferred TypeScript type from the Zod schema. */
export type ValidatedCuttlefishConfig = z.infer<typeof CuttlefishConfigSchema>;

/**
 * Validate a parsed config object against the schema.
 * Returns the validated config or throws a ZodError with detailed diagnostics.
 */
export function validateConfig(config: unknown): ValidatedCuttlefishConfig {
  return CuttlefishConfigSchema.parse(config);
}

/**
 * Validate a parsed config object, returning a result instead of throwing.
 * Useful when you want to collect diagnostics without catching exceptions.
 */
export function safeValidateConfig(config: unknown): { success: true; data: ValidatedCuttlefishConfig } | { success: false; errors: string[] } {
  const result = CuttlefishConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map(issue => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { success: false, errors };
}
