// ---------------------------------------------------------------------------
// App-local CS-holding MIPI DBI host — the 'local-hold-cs' dbiHost.
//
// Implements the mipi-dbi host API for the overlay's zephyr,mipi-dbi-spi node
// with CS held across each command+data burst (GPIO-managed, DC toggled
// mid-burst — the Adafruit ST77xx protocol the direct transport verified on
// the clone-ST7796S rig). The stock mipi-dbi-spi driver issues the command
// byte and its parameters as two CS-deasserted SPI transactions, which
// scrambles clone ST77xx panels; the mipi-hold-cs DT knob that would fix it
// is documented by the binding but unimplemented in Zephyr 4.4.2. This host
// is that behavior, emitted app-locally — the stock bridge stays compiled
// out (CONFIG_MIPI_DBI_SPI=n) and the in-tree panel driver (e.g.
// sitronix,st7796s, CONFIG_ST7796S=y) binds on top unchanged.
//
// A bus host is a normal Zephyr extension point (11 ship in-tree); once
// upstream implements mipi-hold-cs, this section retires and the profile's
// dbiHost flips back to 'spi-bridge'.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

import type { ZephyrDisplayProfile } from "./profiles.js";

/** Build the local CS-holding mipi-dbi host for a profile. Emits a device at
 *  the overlay's bridge node (bridgeLabel) implementing
 *  struct mipi_dbi_driver_api, plus the includes it needs. The panel driver
 *  reaches it via DEVICE_DT_GET(DT_INST_PARENT(display0)). */
export function localHoldCsDbiHost(profile: ZephyrDisplayProfile): {
  includes: string[];
  functions: string;
} {
  const bus = profile.busLabel ?? 'spi2';
  const bridge = profile.bridgeLabel ?? 'mipi_dbi';

  const includes = [
    `#include <zephyr/drivers/mipi_dbi.h>`,
    `#include <zephyr/drivers/spi.h>`,
  ];

  const functions = `
// ── App-local MIPI DBI host (CS held across command+data) ───────────────
// The mipi-hold-cs behavior the zephyr,mipi-dbi-spi child binding documents:
// CS asserted by GPIO around each complete command+data burst (or whole
// display write), DC toggled mid-burst. The spi_config carried in the
// panel's mipi_dbi_config is used verbatim EXCEPT .cs, which this host
// nulls so the SPI driver never touches the CS line mid-burst.
static const struct gpio_dt_spec __tc_dbi_dc = GPIO_DT_SPEC_GET(DT_NODELABEL(${bridge}), dc_gpios);
static const struct gpio_dt_spec __tc_dbi_rst = GPIO_DT_SPEC_GET(DT_NODELABEL(${bridge}), reset_gpios);
// CS comes from the SPI bus node's cs-gpios, selected by the panel's
// dbi config .slave (= reg). The overlay puts the panel at index 0 and an
// SPI touch controller, if any, at index 1 — each owner drives its own CS.
static const struct gpio_dt_spec __tc_dbi_cs[] = {
#if DT_PROP_LEN(DT_NODELABEL(${bus}), cs_gpios) > 0
  GPIO_DT_SPEC_GET_BY_IDX(DT_NODELABEL(${bus}), cs_gpios, 0),
#endif
#if DT_PROP_LEN(DT_NODELABEL(${bus}), cs_gpios) > 1
  GPIO_DT_SPEC_GET_BY_IDX(DT_NODELABEL(${bus}), cs_gpios, 1),
#endif
};
#define __TC_DBI_CS_COUNT (sizeof(__tc_dbi_cs) / sizeof(__tc_dbi_cs[0]))
// Staging buffer for display writes: display_write buffers may live in PSRAM
// (not DMA-capable on ESP32); chunked SRAM staging is the pattern the direct
// transport proved on this rig. Reused, never per-frame (AGENTS.md).
static uint8_t __tc_dbi_bounce[4096];

static const struct gpio_dt_spec* __tc_dbi_cs_for(const struct mipi_dbi_config* cfg) {
  if (cfg->config.slave >= __TC_DBI_CS_COUNT) return nullptr;
  return &__tc_dbi_cs[cfg->config.slave];
}

// One command byte (DC low) + its parameters (DC high) under one CS burst.
static int __tc_dbi_command_write(const struct device* /*dev*/,
                                  const struct mipi_dbi_config* cfg,
                                  uint8_t cmd, const uint8_t* data, size_t len) {
  const struct gpio_dt_spec* cs = __tc_dbi_cs_for(cfg);
  if (cs == nullptr) return -EIO;
  struct spi_config sc = cfg->config;
  // This host owns CS — keep the SPI core off it. Both fields matter in
  // Zephyr 4.4: the core gates on cs.cs_is_gpio (NOT the port pointer), and
  // leaving it set makes spi_context_cs_control deref the port-less spec
  // (EXCCAUSE 28 on the first panel init command — verified on hardware).
  sc.cs.cs_is_gpio = false;
  sc.cs.gpio.port = nullptr;
  struct spi_buf __cb = { &cmd, 1 };
  struct spi_buf_set __csb = { &__cb, 1 };
  gpio_pin_set_dt(cs, 1);
  gpio_pin_set_dt(&__tc_dbi_dc, 0);
  int ret = spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &sc, &__csb);
  if ((ret == 0) && (len > 0)) {
    struct spi_buf __db = { const_cast<uint8_t*>(data), len };
    struct spi_buf_set __dsb = { &__db, 1 };
    gpio_pin_set_dt(&__tc_dbi_dc, 1);
    ret = spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &sc, &__dsb);
  }
  gpio_pin_set_dt(cs, 0);
  return ret;
}

// Write-only host: the bridge node carries 'write-only' (no MISO readback
// path is wired for these panels).
static int __tc_dbi_command_read(const struct device* /*dev*/,
                                 const struct mipi_dbi_config* /*cfg*/,
                                 uint8_t* /*cmds*/, size_t /*num_cmds*/,
                                 uint8_t* /*response*/, size_t /*len*/) {
  return -ENOTSUP;
}

// Stream desc->buf_size bytes to the panel (DC high) under one CS assertion,
// chunked through the SRAM bounce buffer.
static int __tc_dbi_write_display(const struct device* /*dev*/,
                                  const struct mipi_dbi_config* cfg,
                                  const uint8_t* framebuf,
                                  struct display_buffer_descriptor* desc,
                                  enum display_pixel_format /*pixfmt*/) {
  const struct gpio_dt_spec* cs = __tc_dbi_cs_for(cfg);
  if (cs == nullptr) return -EIO;
  struct spi_config sc = cfg->config;
  sc.cs.cs_is_gpio = false;
  sc.cs.gpio.port = nullptr;
  gpio_pin_set_dt(cs, 1);
  gpio_pin_set_dt(&__tc_dbi_dc, 1);
  const uint8_t* p = framebuf;
  size_t remaining = desc->buf_size;
  int ret = 0;
  while ((remaining > 0) && (ret == 0)) {
    size_t chunk = (remaining > sizeof(__tc_dbi_bounce)) ? sizeof(__tc_dbi_bounce) : remaining;
    memcpy(__tc_dbi_bounce, p, chunk);
    struct spi_buf __b = { __tc_dbi_bounce, chunk };
    struct spi_buf_set __s = { &__b, 1 };
    ret = spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &sc, &__s);
    p += chunk;
    remaining -= chunk;
  }
  gpio_pin_set_dt(cs, 0);
  return ret;
}

// Assert reset for the requested delay, then release (the stock host's
// semantics — st7796s calls mipi_dbi_reset(host, 100) at init).
static int __tc_dbi_reset(const struct device* /*dev*/, k_timeout_t delay) {
  gpio_pin_set_dt(&__tc_dbi_rst, 1);
  k_sleep(delay);
  return gpio_pin_set_dt(&__tc_dbi_rst, 0);
}

// Nothing is locked between calls (no per-panel spi reconfig here).
static int __tc_dbi_release(const struct device* /*dev*/,
                            const struct mipi_dbi_config* /*cfg*/) {
  return 0;
}

static DEVICE_API(mipi_dbi, __tc_dbi_api) = {
  __tc_dbi_command_write,
  __tc_dbi_command_read,
  __tc_dbi_write_display,
  __tc_dbi_reset,
  __tc_dbi_release,
};

static int __tc_dbi_host_init(const struct device* /*dev*/) {
  if (!device_is_ready(__tc_dbi_dc.port)) return -ENODEV;
  gpio_pin_configure_dt(&__tc_dbi_dc, GPIO_OUTPUT);
  if (device_is_ready(__tc_dbi_rst.port)) {
    gpio_pin_configure_dt(&__tc_dbi_rst, GPIO_OUTPUT_INACTIVE);
  }
  for (size_t i = 0; i < __TC_DBI_CS_COUNT; i++) {
    if (device_is_ready(__tc_dbi_cs[i].port)) {
      gpio_pin_configure_dt(&__tc_dbi_cs[i], GPIO_OUTPUT_INACTIVE);
    }
  }
  return 0;
}

// Same init level/priority slot the stock bridge uses — panel drivers init
// later (CONFIG_DISPLAY_INIT_PRIORITY=85 > MIPI_DBI_INIT_PRIORITY=80), so
// the host's GPIOs are live before the panel's init commands run.
DEVICE_DT_DEFINE(DT_NODELABEL(${bridge}), __tc_dbi_host_init, NULL, NULL, NULL,
                 POST_KERNEL, CONFIG_MIPI_DBI_INIT_PRIORITY, &__tc_dbi_api);
`;

  return { includes, functions };
}
