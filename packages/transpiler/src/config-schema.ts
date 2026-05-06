// ---------------------------------------------------------------------------
// Config Schema — Zod validation for typehal.config.ts parsed values
//
// After the AST-based config loader extracts scalar/structured values from
// typehal.config.ts, this schema validates the shape, required fields, and
// enum constraints before the config is used by the transpiler.
// ---------------------------------------------------------------------------

import { z } from 'zod';

/** Optimization levels accepted by the output.optimize field. */
const OptimizationLevel = z.enum(['none', 'size', 'speed', 'balanced']);

/** Schema for the `output` section. */
const OutputConfig = z.object({
  framework: z.string().min(1),
  optimize: OptimizationLevel.optional(),
  outDir: z.string().optional(),
  defines: z.record(z.string(), z.string()).optional(),
  extraFlags: z.array(z.string()).optional(),
}).strict();

/** Schema for the `console` section. */
const ConsoleConfig = z.object({
  baudRate: z.number().int().positive().optional(),
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

/**
 * Schema for the full TypehalConfig shape.
 *
 * `target` and `board` are required. Everything else is optional.
 */
export const TypehalConfigSchema = z.object({
  entry: z.string().optional(),
  target: z.string().min(1),
  board: z.string().min(1),
  framework: z.string().optional(),
  output: OutputConfig.optional(),
  frameworkData: z.record(z.string(), z.unknown()).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  test: TestConfig.optional(),
  toolchain: ToolchainConfig.optional(),
  console: ConsoleConfig.optional(),
  native: z.record(z.string(), z.unknown()).optional(),
}).strict();

/** Inferred TypeScript type from the Zod schema. */
export type ValidatedTypehalConfig = z.infer<typeof TypehalConfigSchema>;

/**
 * Validate a parsed config object against the schema.
 * Returns the validated config or throws a ZodError with detailed diagnostics.
 */
export function validateConfig(config: unknown): ValidatedTypehalConfig {
  return TypehalConfigSchema.parse(config);
}

/**
 * Validate a parsed config object, returning a result instead of throwing.
 * Useful when you want to collect diagnostics without catching exceptions.
 */
export function safeValidateConfig(config: unknown): { success: true; data: ValidatedTypehalConfig } | { success: false; errors: string[] } {
  const result = TypehalConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map(issue => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { success: false, errors };
}
