// ---------------------------------------------------------------------------
// @typehal/simulator — Simulator-specific types
// ---------------------------------------------------------------------------

/**
 * Callback signature for pin state change events.
 * @param pinNumber - The pin number that changed
 * @param newValue - The new digital value (HIGH=1 or LOW=0)
 */
export type PinChangeCallback = (pinNumber: number, newValue: number) => void;

/**
 * Callback signature for interrupt events.
 * @param pinNumber - The interrupt pin number
 * @param mode - The trigger mode ('rising', 'falling', or 'change')
 */
export type InterruptCallback = (pinNumber: number, mode: 'rising' | 'falling' | 'change') => void;

/**
 * A simulated I2C device that responds to register reads and writes.
 * Tests register mock devices to simulate sensor behavior.
 */
export interface ISimI2CDevice {
  /**
   * Handle a register read from the bus master.
   * @param register - The register address being read
   * @param count - Number of bytes requested
   * @returns Array of byte values to return
   */
  read(register: number, count: number): number[];

  /**
   * Handle a register write from the bus master.
   * @param register - The register address being written
   * @param data - The data bytes being written
   */
  write(register: number, data: number[]): void;
}

/**
 * A simulated SPI device that responds to transfers.
 */
export interface ISimSPIDevice {
  /**
   * Handle a full-duplex SPI transfer.
   * @param mosiData - Data sent from master (MOSI)
   * @returns Data received from device (MISO)
   */
  transfer(mosiData: number[]): number[];

  /**
   * Handle a register write (optional).
   * If not provided, falls back to transfer().
   * @param register - The register address
   * @param data - The data bytes being written
   */
  write?(register: number, data: number[]): void;

  /**
   * Handle a register read (optional).
   * If not provided, falls back to transfer() with dummy bytes.
   * @param register - The register address
   * @param count - Number of bytes to read
   * @returns Data bytes read from the register
   */
  readRegister?(register: number, count: number): number[];
}

/**
 * Board type identifiers for the simulator factory.
 */
export type SimBoardType = 'arduino-uno' | 'arduino-nano' | string;

/**
 * Configuration for creating a simulated board.
 */
export interface SimBoardConfig {
  /** Board type identifier. Determines pin count and peripheral availability. */
  boardType: SimBoardType;
  /** Number of digital pins (default: 14 for Uno) */
  digitalPinCount?: number;
  /** Number of analog input pins (default: 6 for Uno) */
  analogPinCount?: number;
  /** Number of I2C buses (default: 1) */
  i2cBusCount?: number;
  /** Number of SPI buses (default: 1) */
  spiBusCount?: number;
  /** Number of UART ports (default: 1) */
  uartCount?: number;
  /** RX buffer size for UART simulation (default: 256) */
  uartRxBufferSize?: number;
  /** TX buffer size for UART simulation (default: 256) */
  uartTxBufferSize?: number;
}
