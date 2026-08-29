#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <cstdint>
#include <cstdio>
#include <zephyr/drivers/i2c.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/usb/usbd.h>
#include <zephyr/init.h>
#include <zephyr/drivers/adc.h>
#include <zephyr/drivers/pwm.h>
#include <zephyr/drivers/watchdog.h>

// cuttlefish runtime shim. Wrapped in a single include guard so the
// block is safe to emit into multiple headers and .cpp files within
// one translation unit (a .cpp may #include several headers that each
// carry the shim). The guard ensures the definitions are seen exactly
// once per TU.
#ifndef CUTTLEFISH_SHIM_DEFINED
#define CUTTLEFISH_SHIM_DEFINED
inline void __tc_print(const char* s) { printf("%s", s); }
static void __tc_fmt_num(double v) {
    if (v != v) { printf("nan"); return; }
    double a = v < 0 ? -v : v;
    long long ip = (long long)a;
    long long fr = (long long)((a - (double)ip) * 1000000.0 + 0.5);
    if (fr >= 1000000LL) { ip += 1LL; fr = 0LL; }
    if (v < 0 && (ip != 0LL || fr != 0LL)) printf("-");
    if (fr == 0LL) { printf("%lld", ip); return; }
    char fbuf[8];
    int len = snprintf(fbuf, sizeof(fbuf), "%06lld", fr);
    while (len > 0 && fbuf[len - 1] == '0') { fbuf[--len] = '\0'; }
    printf("%lld.%s", ip, fbuf);
}
inline void __tc_print(double v) { __tc_fmt_num(v); }
inline void __tc_println(const char* s) { printf("%s\n", s); }
inline void __tc_println(double v) { __tc_fmt_num(v); printf("\n"); }
// CUTTLEFISH_I2C_BEGIN
static const struct device* __tc_i2c0_dev = DEVICE_DT_GET(DT_NODELABEL(i2c1));
// CUTTLEFISH_I2C_END
// CUTTLEFISH_SPI_BEGIN
static const struct device* __tc_spi0_dev = DEVICE_DT_GET(DT_NODELABEL(spi1));
static bool __tc_spi0_ready = false;
static uint8_t __tc_spi0_mode = 0;   // bit0=CPOL, bit1=CPHA
static bool __tc_spi0_lsb = false;   // false=MSB (default), true=LSB
static struct spi_config __tc_spi0_cfg = {
    .frequency = 1000000,
};
static void __tc_spi0_init(void) {
    if (!__tc_spi0_ready) {
        __tc_spi0_cfg.operation = SPI_OP_MODE_MASTER | SPI_WORD_SET(8)
            | (__tc_spi0_lsb ? SPI_TRANSFER_LSB : SPI_TRANSFER_MSB)
            | ((__tc_spi0_mode & 0x1) ? SPI_MODE_CPOL : 0)
            | ((__tc_spi0_mode & 0x2) ? SPI_MODE_CPHA : 0);
        __tc_spi0_ready = true;
    }
}
// CUTTLEFISH_SPI_END
// CUTTLEFISH_SPIT_BEGIN
static const struct spi_dt_spec __tc_spit_spi0_cs4_spec = SPI_DT_SPEC_GET(DT_NODELABEL(tc_spit_spi0_cs4), SPI_OP_MODE_MASTER | SPI_WORD_SET(8), 0);
// tc-spit-cfg: tc_spit_spi0_cs4 hz=10000000 mode=0
// CUTTLEFISH_SPIT_END
// CUTTLEFISH_THREAD_BEGIN
K_THREAD_STACK_DEFINE(__tc_thrd0_stack, 4096);
static struct k_thread __tc_thrd0_thread;
static void (*__tc_thrd0_fn)(void) = NULL;
static void __tc_thrd0_tramp(void* a, void* b, void* c) { (void)a; (void)b; (void)c; if (__tc_thrd0_fn) { __tc_thrd0_fn(); } }
// CUTTLEFISH_THREAD_END
// CUTTLEFISH_USBD_BEGIN
USBD_DEVICE_DEFINE(__tc_usbd,
    DEVICE_DT_GET(DT_NODELABEL(zephyr_udc0)),
    0x2FE3, 0x0002);
USBD_DESC_LANG_DEFINE(__tc_usbd_lang);
USBD_DESC_MANUFACTURER_DEFINE(__tc_usbd_mfr, "typecad");
USBD_DESC_PRODUCT_DEFINE(__tc_usbd_product, "cuttlefish app");
USBD_DESC_CONFIG_DEFINE(__tc_usbd_cfg_desc, "cuttlefish");
USBD_CONFIGURATION_DEFINE(__tc_usbd_cfg, 0, 250, &__tc_usbd_cfg_desc);
static bool __tc_usbd_started = false;
static void __tc_usbd_start(void) {
    if (__tc_usbd_started) { return; }
    __tc_usbd_started = true;
    int err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_lang);
    if (err != 0) { printk("cuttlefish usb: lang descriptor failed: %d\n", err); return; }
    err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_mfr);
    if (err != 0) { printk("cuttlefish usb: manufacturer descriptor failed: %d\n", err); return; }
    err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_product);
    if (err != 0) { printk("cuttlefish usb: product descriptor failed: %d\n", err); return; }
    err = usbd_add_configuration(&__tc_usbd, USBD_SPEED_FS, &__tc_usbd_cfg);
    if (err != 0) { printk("cuttlefish usb: add configuration failed: %d\n", err); return; }
    err = usbd_register_all_classes(&__tc_usbd, USBD_SPEED_FS, 1, NULL);
    if (err != 0) { printk("cuttlefish usb: register classes failed: %d\n", err); return; }
    err = usbd_init(&__tc_usbd);
    if (err != 0) { printk("cuttlefish usb: init failed: %d\n", err); return; }
    err = usbd_enable(&__tc_usbd);
    if (err != 0) { printk("cuttlefish usb: enable failed: %d\n", err); return; }
    printk("cuttlefish usb: device enabled\n");
}
// CUTTLEFISH_USBD_END
static int __tc_console_usb_boot(void) {
    __tc_usbd_start();
    const struct device* __tc_console_cdc = DEVICE_DT_GET(DT_NODELABEL(cdc_acm_uart0));
    for (int32_t __i = 0; __i < 500; __i++) {
        uint32_t __dtr = 0;
        if (uart_line_ctrl_get(__tc_console_cdc, UART_LINE_CTRL_DTR, &__dtr) == 0 && __dtr != 0) { break; }
        k_msleep(10);
    }
    return 0;
}
SYS_INIT(__tc_console_usb_boot, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
// CUTTLEFISH_PWM_BEGIN
static const struct pwm_dt_spec __tc_pwm_tc_pwm22 = PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm22));
// CUTTLEFISH_PWM_END
// CUTTLEFISH_WDT_BEGIN
static const struct device* __tc_wdt_dev = DEVICE_DT_GET(DT_NODELABEL(iwdg));
static int __tc_wdt_channel = -1;
static bool __tc_wdt_setup_done = false;
// CUTTLEFISH_WDT_END
// CUTTLEFISH_ADC_BEGIN
static const struct device* __tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc1));
static bool __tc_adc1_ready = false;
static void __tc_adc1_setup(void) {
    if (__tc_adc1_ready) return;
    const struct adc_channel_cfg cfg = {
        .gain = ADC_GAIN_1,
        .reference = ADC_REF_INTERNAL,
        .acquisition_time = ADC_ACQ_TIME_DEFAULT,
        .channel_id = 1,
        .differential = 0,
    };
    adc_channel_setup(__tc_adc_dev, &cfg);
    __tc_adc1_ready = true;
}
#define __TC_ADC_VREF_MV 3300
#define __TC_ADC_RESOLUTION 12
// CUTTLEFISH_ADC_END
// CUTTLEFISH_STM32_DBGMCU_BEGIN
#include <zephyr/init.h>
static int __tc_stm32_dbgmcu_keep_swd_alive(void) {
    volatile uint32_t* const rcc_apb1enr = reinterpret_cast<volatile uint32_t*>(0x40023840);
    *rcc_apb1enr = *rcc_apb1enr | (1UL << 18);
    volatile uint32_t* const dbgmcu_cr = reinterpret_cast<volatile uint32_t*>(0xE0042004);
    *dbgmcu_cr = *dbgmcu_cr | 0x7u;
    return 0;
}
SYS_INIT(__tc_stm32_dbgmcu_keep_swd_alive, PRE_KERNEL_1, 0);
// CUTTLEFISH_STM32_DBGMCU_END
#endif // CUTTLEFISH_SHIM_DEFINED
#ifndef __TC_DT_LED0_SPEC
#define __TC_DT_LED0_SPEC
static const struct gpio_dt_spec __tc_dt_led0 = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
#endif // __TC_DT_LED0_SPEC
#ifndef __TC_DT_SW0_SPEC
#define __TC_DT_SW0_SPEC
static const struct gpio_dt_spec __tc_dt_sw0 = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);
#endif // __TC_DT_SW0_SPEC

#include "src.h"

void main_isr_0() {
# 13 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill"
  k_msleep(100);
}

// Auto-generated main() for top-level statements
# 2 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
int main()
{
  __tc_println("[TC:SUITE_START]");
# 13 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_thrd0_fn = (main_isr_0); (void)k_thread_create(&__tc_thrd0_thread, __tc_thrd0_stack, K_THREAD_STACK_SIZEOF(__tc_thrd0_stack), __tc_thrd0_tramp, NULL, NULL, NULL, 5, 0, K_NO_WAIT);
# 14 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  if (!__tc_wdt_setup_done) {     const struct wdt_timeout_cfg __cfg = { .window = { .min = 0, .max = 8000 }, .callback = NULL, .flags = WDT_FLAG_RESET_CPU_CORE };     __tc_wdt_channel = wdt_install_timeout(__tc_wdt_dev, &__cfg);     wdt_setup(__tc_wdt_dev, WDT_OPT_PAUSE_HALTED_BY_DBG);     __tc_wdt_setup_done = true; }
# 15 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  {
    { static bool __tc_gpio_cfg_led0_done = false; if (!__tc_gpio_cfg_led0_done) { gpio_pin_configure_dt(&__tc_dt_led0, GPIO_OUTPUT); __tc_gpio_cfg_led0_done = true; } }
    gpio_pin_set_dt(&__tc_dt_led0, 1);
  }
# 16 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  { static bool __tc_pwm_p22_prd = false; if (!__tc_pwm_p22_prd) { (void)pwm_set_dt(&__tc_pwm_tc_pwm22, 20000000, 0); __tc_pwm_p22_prd = true; } (void)pwm_set_pulse_dt(&__tc_pwm_tc_pwm22, static_cast<uint32_t>(static_cast<double>(0.5f) * static_cast<double>(20000000))); }
# 17 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  { uint8_t __txt[] = { 159 }; const struct spi_buf __tbt = { .buf = __txt, .len = sizeof(__txt) }; const struct spi_buf_set __txst = { .buffers = &__tbt, .count = 1 }; struct spi_buf __rb = { .buf = const_cast<void*>(static_cast<const void*>(id)), .len = sizeof(id) }; const struct spi_buf_set __rbs = { .buffers = &__rb, .count = 1 }; (void)spi_transceive_dt(&__tc_spit_spi0_cs4_spec, &__txst, &__rbs); }
# 18 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("[TC:DESCRIBE:thin HAL on blackpill]");
# 19 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("[TC:IT:Time.now reads monotonic milliseconds since boot]");
# 20 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  const auto __tc_v1 = static_cast<double>(k_uptime_get());
# 21 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_print("[TC:EXPECT:toBeGreaterThan:0:");
# 22 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_print(__tc_v1);
# 23 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("]");
# 24 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("[TC:IT:button (PA0, sw0 is GPIO_ACTIVE_LOW) reads logically NOT pressed]");
# 25 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  const auto __tc_v2 = ({ static bool __tc_gpio_cfg_sw0_done = false; if (!__tc_gpio_cfg_sw0_done) { gpio_pin_configure_dt(&__tc_dt_sw0, GPIO_INPUT | GPIO_PULL_UP); __tc_gpio_cfg_sw0_done = true; } gpio_pin_get_dt(&__tc_dt_sw0); });
# 26 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_print("[TC:EXPECT:toBeFalsy::");
# 27 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_print(__tc_v2);
# 28 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("]");
# 29 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("[TC:IT:ADC (PA1) reads raw counts within the 12-bit range]");
# 30 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  const auto __tc_v3 = ({ static bool __tc_adct1_done = false; if (!__tc_adct1_done) { const struct adc_channel_cfg __tc_adct1_cfg = { .gain = ADC_GAIN_1, .reference = ADC_REF_INTERNAL, .acquisition_time = ADC_ACQ_TIME_DEFAULT, .channel_id = 1, .differential = 0 }; adc_channel_setup(__tc_adc_dev, &__tc_adct1_cfg); __tc_adct1_done = true; } int16_t __b = 0; struct adc_sequence __s = { .channels = BIT(1), .buffer = &__b, .buffer_size = sizeof(__b), .resolution = 12 }; adc_read(__tc_adc_dev, &__s); __b; });
# 31 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_print("[TC:EXPECT:toBeWithinRange:0,4095:");
# 32 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_print(__tc_v3);
# 33 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("]");
# 34 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("[TC:IT:I2C register read on an empty bus fails safe to 0]");
# 35 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  const auto __tc_v4 = ({  uint8_t __v = 0; (void)i2c_reg_read_byte(__tc_i2c0_dev, static_cast<uint16_t>(68), static_cast<uint8_t>(50), &__v); __v; });
# 36 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_print("[TC:EXPECT:toBeWithinRange:0,255:");
# 37 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_print(__tc_v4);
# 38 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("]");
# 39 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  if (__tc_wdt_channel >= 0) { wdt_feed(__tc_wdt_dev, __tc_wdt_channel); }
# 40 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  (void)k_thread_join(&__tc_thrd0_thread, K_FOREVER);
# 41 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  __tc_println("[TC:SUITE_END]");
# 42 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  while (true)
  {
    k_msleep(1000);
  }
# 2 "C:/typecad/typecode/packages/framework-zephyr/hal/blackpill/hal.test.ts"
  return 0;
}
