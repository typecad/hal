## Plan: Implement Pin Capability Validation

### Goal
Fill in the stub `validatePinCapabilities` in `pin-capability-validation.ts` so that calling capability-specific methods (PWM, ADC, DAC, interrupts) on pins that don't support them produces a compile-time error diagnostic. This matches the website docs which describe validator #1.

### Approach: Option B — Walk hal-op IR nodes directly
This gives us source spans for precise diagnostics and keeps the existing `validatePinCapabilities(program)` signature. The scanner already traverses the IR tree — we just need to make it actually handle `hal-op`/`hal-expr` nodes and check capabilities against `program.boardConstants`.

### Files to change

#### 1. `packages/cuttlefish/src/ir/pin-capability-validation.ts` — the stub
- Add imports: `BoardConstants` from `board-resolver.ts`, `HALOpIR` type
- Replace the empty `scanStatement` handling for `'hal-op'` (currently a no-op break) with real logic:
  - Extract the pin number from `stmt.operation.pin`
  - Map the operation to a capability: `pwm.write`/`tone.play` → `pwm`, `adc.read`/`adc.read_voltage` → `analogInput`, `dac.write` → `analogOutput`, `interrupt.attach` → `interrupt`
  - Look up `pins.all.${pinNumber}.capabilities.${capability}` in `boardConstants`
  - If `!== true`, emit a diagnostic with the pin name, requested capability, and a hint listing pins that DO support it
- Same for `'hal-expr'` in `scanExpression`
- Pass `program.boardConstants` through to `scanStatement`/`scanExpression`
- Add a helper to find pins that DO support a capability (scan `pins.all.N.capabilities.${cap}` for all N) for the diagnostic hint

#### 2. No orchestrator changes needed
`validation-orchestrator.ts:29` already calls `validatePinCapabilities(program)` and `program.boardConstants` is already populated on the ProgramIR.

### Capability → HAL operation mapping
```
pwm.write, pwm.get_frequency, pwm.get_resolution, tone.play → capabilities.pwm
adc.read, adc.read_voltage → capabilities.analogInput  
dac.write → capabilities.analogOutput
interrupt.attach → capabilities.interrupt
```

GPIO operations (gpio.write/read/toggle/set_mode) are always available on all digital pins — no check needed.

### Diagnostic shape (matching pulldown-validation pattern)
```ts
{
  severity: 'error',
  code: 'pin-capability-mismatch',
  message: `Pin ${pinName} (PD0) does not support PWM on this board. PWM-capable pins: PD3, PD5, PD6, PB1, PB2, PB3`,
  hint: `Use one of: D3, D5, D6, D9, D10, D11`,
  line: stmt.sourceSpan.startLine,
  column: stmt.sourceSpan.startColumn,
}
```

### Tests
Add tests to `hal-lowering-coverage.test.ts`:
- `pin.pwm()` on A0 (analog pin, no PWM) → error diagnostic
- `pin.pwm()` on D3 (PWM-capable) → no error
- `pin.readAnalog()` on D2 (no ADC) → error diagnostic
- `pin.readAnalog()` on A0 (ADC-capable) → no error
- `pin.tone()` on A0 (no PWM/tone) → error diagnostic

### Build/test/verify
- `npm run build --workspace @typecad/cuttlefish`
- `npm run typecheck`
- `npm test`