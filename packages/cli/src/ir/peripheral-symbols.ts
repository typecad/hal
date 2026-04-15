// ---------------------------------------------------------------------------
// Peripheral symbol helpers
//
// Shared detection/parsing for named bus instances like I2C0, SPI1, UART0,
// Serial, and Serial2.
// ---------------------------------------------------------------------------

export type PeripheralReceiverKind = "i2c" | "spi" | "serial";

const I2C_INSTANCE_PATTERN = /^I2C(\d+)$/;
const SPI_INSTANCE_PATTERN = /^SPI(\d+)$/;
const UART_INSTANCE_PATTERN = /^UART(\d+)$/;
const SERIAL_INSTANCE_PATTERN = /^Serial(\d*)$/;

export function inferPeripheralKindByName(name: string): PeripheralReceiverKind | undefined {
  if (I2C_INSTANCE_PATTERN.test(name)) return "i2c";
  if (SPI_INSTANCE_PATTERN.test(name)) return "spi";
  if (UART_INSTANCE_PATTERN.test(name) || SERIAL_INSTANCE_PATTERN.test(name)) return "serial";
  return undefined;
}

export function parsePeripheralInstance(name: string): { kind: PeripheralReceiverKind; index: number } | undefined {
  let match = name.match(I2C_INSTANCE_PATTERN);
  if (match) {
    return { kind: "i2c", index: parseInt(match[1], 10) };
  }

  match = name.match(SPI_INSTANCE_PATTERN);
  if (match) {
    return { kind: "spi", index: parseInt(match[1], 10) };
  }

  match = name.match(UART_INSTANCE_PATTERN);
  if (match) {
    return { kind: "serial", index: parseInt(match[1], 10) };
  }

  match = name.match(SERIAL_INSTANCE_PATTERN);
  if (match) {
    return { kind: "serial", index: match[1] === "" ? 0 : parseInt(match[1], 10) };
  }

  return undefined;
}