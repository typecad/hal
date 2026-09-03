// ---------------------------------------------------------------------------
// Tier-2 thin buses (hal/i2c-target.ts, spi-target.ts, uart-port.ts) — unit
// lowerings, the SPITarget state/scanner/overlay pipeline, and the overlay's
// DT child-node emission.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { TEST_CHIP } from '../helpers/test-chip';
import { lowerI2c } from '../../../../packages/framework-zephyr/src/lowering/i2c';
import { lowerSpi, spiTargetNames, spiTargetStateLines } from '../../../../packages/framework-zephyr/src/lowering/spi';
import { lowerUart, uartRingStateLines } from '../../../../packages/framework-zephyr/src/lowering/uart';
import { transpileZephyrStrategy, expectCppContains, expectCppNotContains, findDiagnostics } from '../../../setup';
import { scanSpiTargets } from '../../../../packages/framework-zephyr/src/toolchain/index';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';

// ── I2CTarget ───────────────────────────────────────────────────────────────

describe('thin I2CTarget lowering', () => {
  it('reg_write → one i2c_reg_write_byte, no transaction dance', () => {
    const out = lowerI2c({ operation: 'i2c.reg_write', bus: 'I2C1', address: 0x44, hz: 0, reg: 0x30, value: 0xA2 } as any, TEST_CHIP);
    expect(out.code).toBe(' i2c_reg_write_byte(__tc_i2c1_dev, static_cast<uint16_t>(68), static_cast<uint8_t>(48), static_cast<uint8_t>(162));');
  });

  it('construction hz applies once via a guarded i2c_configure', () => {
    const out = lowerI2c({ operation: 'i2c.reg_write', bus: 'I2C1', address: 0x44, hz: 400000, reg: 1, value: 2 } as any, TEST_CHIP);
    expect(out.code).toContain('__tc_i2c1_spd_done');
    expect(out.code).toContain('i2c_configure(__tc_i2c1_dev, I2C_SPEED_SET(I2C_SPEED_FAST))');
    expect(out.code).toContain('i2c_reg_write_byte');
  });

  it('reg_read is a statement expression returning the byte', () => {
    const out = lowerI2c({ operation: 'i2c.reg_read', bus: 'I2C1', address: 0x44, hz: 0, reg: 0x32 } as any, TEST_CHIP);
    expect(out.expression).toContain('i2c_reg_read_byte(__tc_i2c1_dev, static_cast<uint16_t>(68), static_cast<uint8_t>(50), &__v)');
    expect(out.expression).toMatch(/__v; \}\)$/);
  });

  it('reg_update → native read-modify-write (i2c_reg_update_byte)', () => {
    const out = lowerI2c({ operation: 'i2c.reg_update', bus: 'I2C1', address: 0x44, hz: 0, reg: 0x30, mask: 0x0F, value: 0x02 } as any, TEST_CHIP);
    expect(out.code).toContain('i2c_reg_update_byte(__tc_i2c1_dev, static_cast<uint16_t>(68), static_cast<uint8_t>(48), static_cast<uint8_t>(15), static_cast<uint8_t>(2))');
  });

  it('dev_write with a literal array builds one i2c_write', () => {
    const out = lowerI2c({ operation: 'i2c.dev_write', bus: 'I2C1', address: 0x44, hz: 0, bytes: [0x2C, 0x06] } as any, TEST_CHIP);
    expect(out.code).toContain('uint8_t __tc_i2cw[] = { 44, 6 };');
    expect(out.code).toContain('i2c_write(__tc_i2c1_dev, __tc_i2cw, sizeof(__tc_i2cw), static_cast<uint16_t>(68))');
  });
});

// ── UART ────────────────────────────────────────────────────────────────────

describe('thin UART lowering', () => {
  it('poll_write applies the baud once then poll_outs the string', () => {
    const out = lowerUart({ operation: 'uart.poll_write', port: 'UART0', baud: 9600, data: '"AT"' } as any);
    expect(out.code).toContain('__tc_uart0_baud_done');
    expect(out.code).toContain('__tc_uart0_init(static_cast<uint32_t>(9600))');
    expect(out.code).toMatch(/uart_poll_out\(__tc_uart0_dev, \("AT"\)\[__i\]\)/);
  });

  it('rx_read arms the IRQ on first use and pops the ring (−1 when empty)', () => {
    const out = lowerUart({ operation: 'uart.rx_read', port: 'UART0', ring: 64 } as any);
    expect(out.expression).toContain('__tc_uartrx0_armed');
    expect(out.expression).toContain('uart_irq_callback_user_data_set(__tc_uart0_dev, __tc_uartrx0_isr, NULL)');
    expect(out.expression).toContain('uart_irq_rx_enable(__tc_uart0_dev)');
    expect(out.expression).toContain('__tc_uartrx0_buf[(__tc_uartrx0_tail)++ % 64]');
    expect(out.expression).toMatch(/: -1\); \}\)$/);
  });

  it('rx_available counts the ring; rx_peek looks without consuming', () => {
    const avail = lowerUart({ operation: 'uart.rx_available', port: 'UART0', ring: 64 } as any);
    expect(avail.expression).toMatch(/\(__tc_uartrx0_head - __tc_uartrx0_tail\); \}\)$/);
    const peek = lowerUart({ operation: 'uart.rx_peek', port: 'UART0', ring: 128 } as any);
    expect(peek.expression).toContain('__tc_uartrx0_buf[__tc_uartrx0_tail % 128]');
    expect(peek.expression).not.toContain('++)');
  });
});

// ── UART RX ring state block ────────────────────────────────────────────────

describe('thin UART RX ring state', () => {
  it('emits a construction-sized buffer, free-running counters, and the FIFO-draining ISR', () => {
    const lines = uartRingStateLines(1, 128).join('\n');
    expect(lines).toContain('static uint8_t __tc_uartrx1_buf[128];');
    expect(lines).toContain('static volatile uint32_t __tc_uartrx1_head = 0;');
    expect(lines).toContain('uart_irq_update(dev);');
    expect(lines).toContain('while (uart_irq_rx_ready(dev))');
    expect(lines).toContain('uart_fifo_read(dev, &__c, 1);');
    // Drop-on-full: bounded by the ring size, never overwritten head.
    expect(lines).toContain('(__tc_uartrx1_head - __tc_uartrx1_tail) < 128');
  });
});

// ── SPITarget — names, state, lowering ──────────────────────────────────────

describe('thin SPITarget names + state', () => {
  it('names derive from bus index + cs (the shared-facts discipline)', () => {
    const n = spiTargetNames('SPI0', 10);
    expect(n).toEqual({ dtLabel: 'tc_spit_spi0_cs10', varName: '__tc_spit_spi0_cs10_spec', busIndex: 0, cs: 10 });
  });

  it('state lines emit the spi_dt_spec + the tc-spit-cfg scanner comment', () => {
    const lines = spiTargetStateLines('SPI0', 10, 10000000, 3).join('\n');
    expect(lines).toContain('static const struct spi_dt_spec __tc_spit_spi0_cs10_spec = SPI_DT_SPEC_GET(DT_NODELABEL(tc_spit_spi0_cs10), SPI_OP_MODE_MASTER | SPI_WORD_SET(8), 0);');
    expect(lines).toContain('// tc-spit-cfg: tc_spit_spi0_cs10 hz=10000000 mode=3');
  });

  it('the scanner parses the cfg comment back into target facts', () => {
    const scanned = scanSpiTargets('static const struct spi_dt_spec __tc_spit_spi0_cs10_spec = SPI_DT_SPEC_GET(DT_NODELABEL(tc_spit_spi0_cs10), SPI_OP_MODE_MASTER | SPI_WORD_SET(8), 0);\n// tc-spit-cfg: tc_spit_spi0_cs10 hz=10000000 mode=3\n');
    expect(scanned).toEqual([{ busIndex: 0, cs: 10, hz: 10000000, mode: 3 }]);
  });

  it('transceive lowers to spi_transceive_dt against the spec var, hardware CS', () => {
    const out = lowerSpi({ operation: 'spi.transceive', bus: 'SPI0', cs: 10, hz: 10000000, mode: 0, tx: [0x9F], rx: 'idBuf' } as any, TEST_CHIP);
    expect(out.code).toContain('uint8_t __txt[] = { 159 };');
    expect(out.code).toContain('.buf = const_cast<void*>(static_cast<const void*>(idBuf)), .len = sizeof(idBuf)');
    expect(out.code).toContain('spi_transceive_dt(&__tc_spit_spi0_cs10_spec, &__txst, &__rbs)');
    expect(out.code).not.toContain('gpio_pin_set_raw');
  });

  it('write-only transceive passes a NULL rx set; dev_write uses spi_write_dt', () => {
    const t = lowerSpi({ operation: 'spi.transceive', bus: 'SPI0', cs: 10, hz: 0, mode: 0, tx: [1, 2], rx: '' } as any, TEST_CHIP);
    expect(t.code).toContain('.buffers = NULL, .count = 0');
    const w = lowerSpi({ operation: 'spi.dev_write', bus: 'SPI0', cs: 10, hz: 0, mode: 0, tx: [0x06] } as any, TEST_CHIP);
    expect(w.code).toContain('spi_write_dt(&__tc_spit_spi0_cs10_spec, &__txsw)');
  });
});

// ── End-to-end: UART RX ring + awaitable Time.sleep ────────────────────────

describe('UART ring + awaitable Time.sleep end-to-end (esp32s3 target)', () => {
  it('the construction ring size flows and the RX ops arm the IRQ', () => {
    // The esp32s3 test chip declares uart1 (mirroring the board package),
    // so the ring gate fires on the default test target.
    const result = transpileZephyrStrategy(`
      import { UART } from '@typecad/hal';

      const gps = new UART('UART0', { baud: 9600, rxBufferBytes: 128 });
      console.log(gps.available());
      console.log(gps.peek());
      console.log(gps.read());
    `);

    expectCppContains(result, [
      'static uint8_t __tc_uartrx0_buf[128];',
      '__tc_uartrx0_isr',
      'uart_irq_callback_user_data_set(__tc_uart0_dev, __tc_uartrx0_isr, NULL)',
      'uart_irq_rx_enable(__tc_uart0_dev)',
      '(__tc_uartrx0_head - __tc_uartrx0_tail)',
      '__tc_uartrx0_buf[__tc_uartrx0_tail % 128]',
      '__tc_uartrx0_buf[(__tc_uartrx0_tail)++ % 128]',
    ]);
  });

  it('await Time.sleep(50) inside an async function rides the async state machine', () => {
    const result = transpileZephyrStrategy(`
      import { Time } from '@typecad/hal';

      async function tick(): Promise<void> {
        while (true) {
          await Time.sleep(50);
        }
      }
      void tick();
    `);

    // The coroutine machine with its deadline field — the awaited sleep is
    // cooperative (arms _waitUntil), not a bare blocking statement.
    expect(result.cpp).toContain('_waitUntil');
  });

  it('construction facts resolve inside a coroutine body (while-condition + await)', () => {
    const result = transpileZephyrStrategy(`
      import { UART, Time } from '@typecad/hal';

      const gps = new UART('UART0', { baud: 9600, rxBufferBytes: 128 });

      async function waitByte(): Promise<void> {
        while (gps.available() < 1) {
          await Time.sleep(50);
        }
      }
      void waitByte();
      console.log(gps.read());
      console.log(gps.peek());
    `);

    // Every ring reference — the ISR buffer, the peek/read modulo, the
    // state block sizing — carries the CONSTRUCTION size, not the default.
    expect(result.cpp).toContain('static uint8_t __tc_uartrx0_buf[128];');
    expect(result.cpp).toContain('__tc_uartrx0_buf[__tc_uartrx0_tail % 128]');
    expect(result.cpp).toContain('__tc_uartrx0_buf[(__tc_uartrx0_tail)++ % 128]');
    expect(result.cpp).toContain('_waitUntil');
    expect(result.cpp).not.toContain('% 64');
  });

  it('a hal-op chain (block IR) before an await keeps its ops — no bare {', () => {
    // Regression: chained HAL calls lower to a BLOCK of hal-ops. When such a
    // chain runs before an await inside an async fn, the block lands in the
    // segment pre-statements, and the single-line statement renderer emitted
    // a literal `{` — dropping every op in the block AND unbalancing the
    // braces. The state machine must render the full chain body.
    const result = transpileZephyrStrategy(`
      import { Time, Request } from '@typecad/hal';

      async function poll(): Promise<void> {
        new Request('GET', 'http://192.168.2.184:8080/health').header('x-test', '1').send();
        await Time.sleep(100);
      }
      void poll();
    `);

    expectCppContains(result, [
      '__tc_http_set_header("x-test", "1")',
      '__tc_http_reset(); __tc_http_begin(HTTP_GET, "http://192.168.2.184:8080/health")',
      '__tc_http_send()',
    ]);
    // Sentinel ops (no body, insecure=false, no caCert) elide silently —
    // no placeholder comments, no unregistered-op warnings.
    expectCppNotContains(result, [
      'unhandled hal-op',
      'PEM failed to decode',
    ]);
    expect(findDiagnostics(result, 'TS2CPP_UNHANDLED_HAL')).toHaveLength(0);
  });
});

// ── Overlay — SPITarget DT child nodes ─────────────────────────────────────

describe('overlay emits SPITarget child nodes', () => {
  it('one node per target: cs-gpios entry + reg index + spi-max-frequency + mode bits', () => {
    const txt = generateOverlay(TEST_CHIP, {
      usesSpi: true,
      spiTargets: [{ busIndex: 0, cs: 10, hz: 10000000, mode: 3 }],
    }, undefined);
    expect(txt).toContain('&spi2 {');
    expect(txt).toContain('cs-gpios = <&gpio0 10 GPIO_ACTIVE_LOW>;');
    expect(txt).toContain('tc_spit_spi0_cs10: spidev@0 {');
    expect(txt).toContain('reg = <0>;');
    expect(txt).toContain('spi-max-frequency = <10000000>;');
    // mode 3 = CPOL|CPHA.
    expect(txt).toContain('spi-cpol;');
    expect(txt).toContain('spi-cpha;');
    // The app-local binding's compatible — present so gen_defines emits the
    // spi properties SPI_DT_SPEC_GET consumes.
    expect(txt).toContain('compatible = "cuttlefish,spi-target";');
  });

  it('targets append after sensors on a shared controller (stable reg indexes)', () => {
    const txt = generateOverlay(TEST_CHIP, {
      usesSpi: true,
      sensorParts: [{ part: 'bosch_bme280', busIndex: 0, port: 9, busKind: 'spi', spiHz: 1000000, spiMode: 0, alertPin: -1 }],
      spiTargets: [{ busIndex: 0, cs: 10, hz: 10000000, mode: 0 }],
    }, undefined);
    expect(txt).toContain('cs-gpios = <&gpio0 9 GPIO_ACTIVE_LOW>, <&gpio0 10 GPIO_ACTIVE_LOW>;');
    expect(txt).toMatch(/tc_bosch_bme280_spi0_cs9: bme280@0/);
    expect(txt).toMatch(/tc_spit_spi0_cs10: spidev@1/);
  });
});
