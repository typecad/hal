// ---------------------------------------------------------------------------
// @typecad/hal — Architecture identifier type used by project configuration.
// ---------------------------------------------------------------------------

export type ArchitectureIdentifier =
  | 'avr'
  | 'esp32'
  | 'esp32s2'
  | 'esp32s3'
  | 'esp32c3'
  | 'esp32c6'
  | 'rp2040'
  | 'rp2350'
  | 'samd'
  | 'stm32'
  | 'nrf52'
  | (string & {});
