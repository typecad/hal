#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <cstdint>
#include <cstdio>
#include <zephyr/drivers/i2c.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/usb/usbd.h>
#include <zephyr/init.h>
#include <cmsis_core.h>
#include <zephyr/drivers/adc.h>

// typecad-hal runtime shim. Wrapped in a single include guard so the
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
static const struct device* __tc_i2c0_dev = DEVICE_DT_GET(DT_NODELABEL(sercom4));
// CUTTLEFISH_I2C_END
// CUTTLEFISH_SPI_BEGIN
static const struct device* __tc_spi0_dev = DEVICE_DT_GET(DT_NODELABEL(sercom1));
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
// CUTTLEFISH_UART_BEGIN
static const struct device* __tc_uart0_dev = DEVICE_DT_GET(DT_NODELABEL(sercom5));
static void __tc_uart0_init(uint32_t baud) {
    const struct uart_config cfg = { .baudrate = (baud ? baud : 115200), .parity = UART_CFG_PARITY_NONE, .stop_bits = UART_CFG_STOP_BITS_1, .data_bits = UART_CFG_DATA_BITS_8, .flow_ctrl = UART_CFG_FLOW_CTRL_NONE };
    uart_configure(__tc_uart0_dev, &cfg);
}
// CUTTLEFISH_UART_END
// CUTTLEFISH_UARTRX_BEGIN
static uint8_t __tc_uartrx0_buf[64];
static volatile uint32_t __tc_uartrx0_head = 0;
static volatile uint32_t __tc_uartrx0_tail = 0;
static void __tc_uartrx0_isr(const struct device* dev, void* user_data) {
    (void)user_data;
    uart_irq_update(dev);
    while (uart_irq_rx_ready(dev)) {
        uint8_t __c = 0;
        (void)uart_fifo_read(dev, &__c, 1);
        if ((__tc_uartrx0_head - __tc_uartrx0_tail) < 64) {
            __tc_uartrx0_buf[__tc_uartrx0_head % 64] = __c;
            __tc_uartrx0_head++;
        }
    }
}
(void)__tc_uart0_dev;
// CUTTLEFISH_UARTRX_END
// CUTTLEFISH_SPIT_BEGIN
static const struct spi_dt_spec __tc_spit_spi0_cs16_spec = SPI_DT_SPEC_GET(DT_NODELABEL(tc_spit_spi0_cs16), SPI_OP_MODE_MASTER | SPI_WORD_SET(8), 0);
// tc-spit-cfg: tc_spit_spi0_cs16 hz=4000000 mode=0
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
    0x2FE3, 0x0003);
USBD_DESC_LANG_DEFINE(__tc_usbd_lang);
USBD_DESC_MANUFACTURER_DEFINE(__tc_usbd_mfr, "typecad");
USBD_DESC_PRODUCT_DEFINE(__tc_usbd_product, "typecad-hal app");
USBD_DESC_CONFIG_DEFINE(__tc_usbd_cfg_desc, "typecad-hal");
USBD_CONFIGURATION_DEFINE(__tc_usbd_cfg, 0, 250, &__tc_usbd_cfg_desc);
static bool __tc_usbd_started = false;
// 1200-baud touch-to-reset: reboot into the bootloader (flag 0x7738135 @ 0x20007ffc).
static void __tc_usbd_msg_cb(struct usbd_context* ctx, const struct usbd_msg* msg) {
    (void)ctx;
    if (msg->type != USBD_MSG_CDC_ACM_LINE_CODING) { return; }
    struct uart_config __tc_cfg;
    if (uart_config_get(msg->dev, &__tc_cfg) == 0 && __tc_cfg.baudrate == 1200) {
        // Delay the reboot so the host touch (which applies 1200 as part
        // of opening the port) can close its handle first — resetting under
        // an open host handle can wedge the Windows usbser driver and block
        // re-enumeration until a physical replug.
        k_msleep(250);
        *(volatile uint32_t*)0x20007ffc = 0x7738135;
        NVIC_SystemReset();
    }
}
static void __tc_usbd_start(void) {
    if (__tc_usbd_started) { return; }
    __tc_usbd_started = true;
    int err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_lang);
    if (err != 0) { printk("typecad-hal usb: lang descriptor failed: %d\n", err); return; }
    err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_mfr);
    if (err != 0) { printk("typecad-hal usb: manufacturer descriptor failed: %d\n", err); return; }
    err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_product);
    if (err != 0) { printk("typecad-hal usb: product descriptor failed: %d\n", err); return; }
    err = usbd_add_configuration(&__tc_usbd, USBD_SPEED_FS, &__tc_usbd_cfg);
    if (err != 0) { printk("typecad-hal usb: add configuration failed: %d\n", err); return; }
    err = usbd_register_all_classes(&__tc_usbd, USBD_SPEED_FS, 1, NULL);
    if (err != 0) { printk("typecad-hal usb: register classes failed: %d\n", err); return; }
    usbd_msg_register_cb(&__tc_usbd, __tc_usbd_msg_cb);
    err = usbd_init(&__tc_usbd);
    if (err != 0) { printk("typecad-hal usb: init failed: %d\n", err); return; }
    err = usbd_enable(&__tc_usbd);
    if (err != 0) { printk("typecad-hal usb: enable failed: %d\n", err); return; }
    printk("typecad-hal usb: device enabled\n");
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
// CUTTLEFISH_ADC_BEGIN
static const struct device* __tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc));
static bool __tc_adc0_ready = false;
static void __tc_adc0_setup(void) {
    if (__tc_adc0_ready) return;
    const struct adc_channel_cfg cfg = {
        .gain = ADC_GAIN_1,
        .reference = ADC_REF_VDD_1_2,
        .acquisition_time = ADC_ACQ_TIME_DEFAULT,
        .channel_id = 0,
        .differential = 0,
    };
    adc_channel_setup(__tc_adc_dev, &cfg);
    __tc_adc0_ready = true;
}
#define __TC_ADC_VREF_MV 1650
#define __TC_ADC_RESOLUTION 12
// CUTTLEFISH_ADC_END
#endif // CUTTLEFISH_SHIM_DEFINED
#ifndef __TC_DT_LED0_SPEC
#define __TC_DT_LED0_SPEC
static const struct gpio_dt_spec __tc_dt_led0 = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
#endif // __TC_DT_LED0_SPEC
#ifndef __TC_BP_DISABLED_DEFINED
#define __TC_BP_DISABLED_DEFINED
static bool __tc_bp_disabled[256] = {0};
static inline bool __tc_bp_is_disabled(int id) { return id >= 0 && id < 256 && __tc_bp_disabled[id]; }
static inline char __tc_debug_wait_for_continue(int id) {
    const struct device* __con = DEVICE_DT_GET(DT_CHOSEN(zephyr_console));
    unsigned char __c = 0;
    while (uart_poll_in(__con, &__c) != 0) {
        k_msleep(10);
    }
    // Drain the rest of the typed line so the next breakpoint waits fresh.
    unsigned char __peek = 0;
    while (uart_poll_in(__con, &__peek) == 0 && __peek != '\n') { (void)0; }
    if ((__c == 's') || (__c == 'S')) { if (id >= 0 && id < 256) __tc_bp_disabled[id] = true; }
    return static_cast<char>(__c);
}
#endif // __TC_BP_DISABLED_DEFINED


#include "src.h"

void main_isr_0() {
  k_msleep(100);
}

// Auto-generated main() for top-level statements
int main()
{
  __tc_println("[TC:SUITE_START]");
  __tc_thrd0_fn = (main_isr_0); (void)k_thread_create(&__tc_thrd0_thread, __tc_thrd0_stack, K_THREAD_STACK_SIZEOF(__tc_thrd0_stack), __tc_thrd0_tramp, NULL, NULL, NULL, 5, 0, K_NO_WAIT);
  {
    { static bool __tc_gpio_cfg_led0_done = false; if (!__tc_gpio_cfg_led0_done) { gpio_pin_configure_dt(&__tc_dt_led0, GPIO_OUTPUT); __tc_gpio_cfg_led0_done = true; } }
    gpio_pin_set_dt(&__tc_dt_led0, 1);
  }
  { uint8_t __txt[] = { 159 }; const struct spi_buf __tbt = { .buf = __txt, .len = sizeof(__txt) }; const struct spi_buf_set __txst = { .buffers = &__tbt, .count = 1 }; struct spi_buf __rb = { .buf = const_cast<void*>(static_cast<const void*>(id)), .len = sizeof(id) }; const struct spi_buf_set __rbs = { .buffers = &__rb, .count = 1 }; (void)spi_transceive_dt(&__tc_spit_spi0_cs16_spec, &__txst, &__rbs); }
  { static bool __tc_uart0_baud_done = false; if (!__tc_uart0_baud_done) { __tc_uart0_init(static_cast<uint32_t>(9600)); __tc_uart0_baud_done = true; } }  for (size_t __i = 0; __i < sizeof("AT\r\n") - 1; __i++) { uart_poll_out(__tc_uart0_dev, ("AT\r\n")[__i]); }
  __tc_println("[TC:DESCRIBE:thin HAL on nano33iot]");
  __tc_println("[TC:IT:Time.now reads monotonic milliseconds since boot]");
  const auto __tc_v1 = static_cast<double>(k_uptime_get());
  __tc_print("[TC:EXPECT:toBeGreaterThan:0:");
  __tc_print(__tc_v1);
  __tc_println("]");
  __tc_println("[TC:IT:pull-up input (A2/PA11, raw path) reads physically high]");
  const auto __tc_v2 = ({ static bool __tc_gpio_cfg_raw11_done = false; if (!__tc_gpio_cfg_raw11_done) { gpio_pin_configure(DEVICE_DT_GET(DT_NODELABEL(porta)), 11, GPIO_INPUT | GPIO_PULL_UP); __tc_gpio_cfg_raw11_done = true; } gpio_pin_get_raw(DEVICE_DT_GET(DT_NODELABEL(porta)), 11); });
  __tc_print("[TC:EXPECT:toBeTruthy::");
  __tc_print(__tc_v2);
  __tc_println("]");
  __tc_println("[TC:IT:ADC (A0) reads raw counts within the 12-bit range]");
  const auto __tc_v3 = ({ static bool __tc_adct2_done = false; if (!__tc_adct2_done) { const struct adc_channel_cfg __tc_adct2_cfg = { .gain = ADC_GAIN_1, .reference = ADC_REF_VDD_1_2, .acquisition_time = ADC_ACQ_TIME_DEFAULT, .channel_id = 0, .differential = 0 }; adc_channel_setup(__tc_adc_dev, &__tc_adct2_cfg); __tc_adct2_done = true; } int16_t __b = 0; struct adc_sequence __s = { .channels = BIT(0), .buffer = &__b, .buffer_size = sizeof(__b), .resolution = 12 }; adc_read(__tc_adc_dev, &__s); __b; });
  __tc_print("[TC:EXPECT:toBeWithinRange:0,4095:");
  __tc_print(__tc_v3);
  __tc_println("]");
  __tc_println("[TC:IT:I2C register read on an empty bus fails safe to 0]");
  const auto __tc_v4 = ({  uint8_t __v = 0; (void)i2c_reg_read_byte(__tc_i2c0_dev, static_cast<uint16_t>(68), static_cast<uint8_t>(50), &__v); __v; });
  __tc_print("[TC:EXPECT:toBeWithinRange:0,255:");
  __tc_print(__tc_v4);
  __tc_println("]");
  __tc_println("[TC:IT:UART poll read on an idle line returns -1 (Zephyr poll semantics)]");
  const auto __tc_v5 = ({ { static bool __tc_uartrx0_armed = false; if (!__tc_uartrx0_armed) { uart_irq_callback_user_data_set(__tc_uart0_dev, __tc_uartrx0_isr, NULL); uart_irq_rx_enable(__tc_uart0_dev); __tc_uartrx0_armed = true; } } (__tc_uartrx0_tail < __tc_uartrx0_head ? __tc_uartrx0_buf[(__tc_uartrx0_tail)++ % 64] : -1); });
  __tc_print("[TC:EXPECT:toBe:-1:");
  __tc_print(__tc_v5);
  __tc_println("]");
  (void)k_thread_join(&__tc_thrd0_thread, K_FOREVER);
  __tc_println("[TC:SUITE_END]");
  while (true)
  {
    k_msleep(1000);
  }
  return 0;
}
