// ---------------------------------------------------------------------------
// ESP32 native STMPE610 touch adapter — SPI register-addressed touch controller.
//
// The STMPE610 uses register-based access: write (reg) to set the register
// pointer for writes, write (0x80 | reg) for reads. Touch data is drained
// from a FIFO via the data register 0xD7. Touch status is bit 7 of TSC_CTRL
// (0x40); FIFO empty is bit 5 of FIFO_STA (0x4B).
//
// Shares SPI2_HOST with the display. 1 MHz, SPI mode 0.
//
// Register protocol transcribed from Adafruit_STMPE610.cpp.
// ---------------------------------------------------------------------------

import type { TouchProfile } from "@typecad/cuttlefish/api/shared";
import { emitSpiTouchHelpers, emitSpiTouchCS } from "./spi-touch-helpers.js";
import type { TouchAdapterCodegen } from "./ft6336u-esp32.js";

export function esp32Stmpe610TouchAdapter(touch: TouchProfile): TouchAdapterCodegen {
  const cs = touch.cs;
  if (cs === undefined || cs < 0) {
    throw new Error(
      `STMPE610 native touch adapter requires display.touch.cs (a GPIO connected ` +
      `to the controller's CS line). Set it in cuttlefish.config.ts: ` +
      `display: { touch: { ..., cs: <gpio> } }.`,
    );
  }

  const helpers = emitSpiTouchHelpers(cs, 1_000_000, 0); // 1 MHz, SPI mode 0

  return {
    includes: [
      `// --- ESP32 STMPE610 touch driver (SPI register-addressed) ---`,
      `// No vendor touch library, no Arduino SPI header.`,
      ...helpers.includes,
    ],

    declaration: [
      helpers.declaration,
      `// Cached touch coordinates from the last touch_isTouched() probe.`,
      `static int16_t __esp32_touch_cached_x = 0;`,
      `static int16_t __esp32_touch_cached_y = 0;`,
      `static int16_t __esp32_touch_cached_z = 0;`,
      `static uint8_t __esp32_touch_cached_valid = 0;`,
    ].join('\n'),

    functions: [
      emitSpiTouchCS(),
      ``,
      `// Half-duplex register read: send (0x80 | reg), then read 1 byte.`,
      `static inline uint8_t __esp32_stmpe_read_reg(uint8_t reg) {`,
      `  if (!__esp32_spi_touch.dev) return 0;`,
      `  __esp32_touch_cs_low();`,
      `  uint8_t cmd = 0x80 | reg;`,
      `  spi_transaction_t t1 = {};`,
      `  t1.length = 8; t1.tx_buffer = &cmd;`,
      `  spi_device_polling_transmit(__esp32_spi_touch.dev, &t1);`,
      `  uint8_t val = 0;`,
      `  spi_transaction_t t2 = {};`,
      `  t2.length = 8; t2.rx_buffer = &val;`,
      `  // Send dummy 0xFF (STMPE610 drives MISO during this byte).`,
      `  uint8_t dummy = 0xFF; t2.tx_buffer = &dummy;`,
      `  spi_device_polling_transmit(__esp32_spi_touch.dev, &t2);`,
      `  __esp32_touch_cs_high();`,
      `  return val;`,
      `}`,
      ``,
      `// Half-duplex register write: send reg, then send val.`,
      `static inline void __esp32_stmpe_write_reg(uint8_t reg, uint8_t val) {`,
      `  if (!__esp32_spi_touch.dev) return;`,
      `  __esp32_touch_cs_low();`,
      `  uint8_t buf[2] = { reg, val };`,
      `  spi_transaction_t t = {};`,
      `  t.length = 16; t.tx_buffer = buf;`,
      `  spi_device_polling_transmit(__esp32_spi_touch.dev, &t);`,
      `  __esp32_touch_cs_high();`,
      `}`,
      ``,
      `// Read 4 bytes from a register (for the FIFO data port 0xD7).`,
      `static inline void __esp32_stmpe_read_data(uint8_t reg, uint8_t* buf, uint8_t len) {`,
      `  if (!__esp32_spi_touch.dev) return;`,
      `  __esp32_touch_cs_low();`,
      `  uint8_t cmd = 0x80 | reg;`,
      `  spi_transaction_t t1 = {};`,
      `  t1.length = 8; t1.tx_buffer = &cmd;`,
      `  spi_device_polling_transmit(__esp32_spi_touch.dev, &t1);`,
      `  // Read len bytes (each needs a dummy TX byte).`,
      `  for (uint8_t i = 0; i < len; i++) {`,
      `    uint8_t dummy = 0xFF;`,
      `    spi_transaction_t t = {};`,
      `    t.length = 8; t.tx_buffer = &dummy; t.rx_buffer = &buf[i];`,
      `    spi_device_polling_transmit(__esp32_spi_touch.dev, &t);`,
      `  }`,
      `  __esp32_touch_cs_high();`,
      `}`,
      ``,
      `// STMPE610 register addresses.`,
      `#define STMPE_SYS_CTRL1_RESET    0x02`,
      `#define STMPE_TSC_CTRL           0x40  // bit 7 = touched, EN=0x01`,
      `#define STMPE_FIFO_STA           0x4B  // bit 5 = empty, bit 0 = reset`,
      `#define STMPE_TSC_DATA           0xD7  // data port (drains FIFO)`,
      `#define STMPE_INT_STA            0x0B`,
      ``,
      `static inline void touch_init() {`,
      helpers.initLines,
      `  if (!__esp32_spi_touch.ready) return;`,
      `  // Soft reset.`,
      `  __esp32_stmpe_write_reg(0x03, STMPE_SYS_CTRL1_RESET);`,
      `  vTaskDelay(pdMS_TO_TICKS(10));`,
      `  __esp32_stmpe_write_reg(0x03, 0x00);`,
      `  // Enable clocks (SYS_CTRL2 = 0x00 = all clocks on).`,
      `  __esp32_stmpe_write_reg(0x04, 0x00);`,
      `  // Touchscreen config: XYZ mode, enable TSC.`,
      `  __esp32_stmpe_write_reg(STMPE_TSC_CTRL, 0x00);   // disable first`,
      `  __esp32_stmpe_write_reg(0x41, 0xA4);              // TSC_CFG: 4-sample, 1ms delay, 5ms settle`,
      `  __esp32_stmpe_write_reg(0x20, 0x00);              // ADC_CTRL1: 10-bit`,
      `  __esp32_stmpe_write_reg(0x21, 0x02);              // ADC_CTRL2: 6.5 MHz`,
      `  __esp32_stmpe_write_reg(0x56, 0x06);              // FRACTION_Z`,
      `  __esp32_stmpe_write_reg(0x4A, 0x01);              // FIFO_TH = 1`,
      `  __esp32_stmpe_write_reg(0x4B, 0x01);              // FIFO reset`,
      `  __esp32_stmpe_write_reg(0x4B, 0x00);              // FIFO un-reset`,
      `  __esp32_stmpe_write_reg(STMPE_INT_STA, 0xFF);     // clear interrupts`,
      `  __esp32_stmpe_write_reg(STMPE_TSC_CTRL, 0x01);    // enable TSC (XYZ mode)`,
      `}`,
      ``,
      `static inline bool touch_isTouched() {`,
      `  if (!__esp32_spi_touch.ready) return false;`,
      `  __esp32_touch_cached_valid = 0;`,
      `  __esp32_touch_cached_z = 0;`,
      `  // Check TSC_CTRL bit 7 (touched) and FIFO not empty.`,
      `  uint8_t ctrl = __esp32_stmpe_read_reg(STMPE_TSC_CTRL);`,
      `  if (!(ctrl & 0x80)) {`,
      `    __esp32_stmpe_write_reg(STMPE_INT_STA, 0xFF);  // clear interrupt`,
      `    return false;`,
      `  }`,
      `  uint8_t fifo = __esp32_stmpe_read_reg(STMPE_FIFO_STA);`,
      `  if (fifo & 0x20) return false;  // FIFO empty`,
      `  // Read 4 bytes from the data port.`,
      `  uint8_t data[4] = {0, 0, 0, 0};`,
      `  __esp32_stmpe_read_data(STMPE_TSC_DATA, data, 4);`,
      `  __esp32_touch_cached_x = (int16_t)(((uint16_t)data[0] << 4) | (data[1] >> 4));`,
      `  __esp32_touch_cached_y = (int16_t)(((uint16_t)(data[1] & 0x0F) << 8) | data[2]);`,
      `  __esp32_touch_cached_z = (int16_t)data[3];`,
      `  // Drain remaining FIFO entries (keep the last sample).`,
      `  while (!(__esp32_stmpe_read_reg(STMPE_FIFO_STA) & 0x20)) {`,
      `    __esp32_stmpe_read_data(STMPE_TSC_DATA, data, 4);`,
      `    __esp32_touch_cached_x = (int16_t)(((uint16_t)data[0] << 4) | (data[1] >> 4));`,
      `    __esp32_touch_cached_y = (int16_t)(((uint16_t)(data[1] & 0x0F) << 8) | data[2]);`,
      `    __esp32_touch_cached_z = (int16_t)data[3];`,
      `  }`,
      `  __esp32_stmpe_write_reg(STMPE_INT_STA, 0xFF);  // clear interrupt`,
      `  __esp32_touch_cached_valid = 1;`,
      `  return true;`,
      `}`,
      ``,
      `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
      `  if (!__esp32_touch_cached_valid) {`,
      `    (void)touch_isTouched();`,
      `  }`,
      `  if (x) *x = __esp32_touch_cached_x;`,
      `  if (y) *y = __esp32_touch_cached_y;`,
      `  if (z) *z = __esp32_touch_cached_z;`,
      `  __esp32_touch_cached_valid = 0;`,
      `}`,
    ].join('\n'),
  };
}
