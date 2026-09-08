#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <cstdint>
#include <cstdio>
#include <zephyr/drivers/i2c.h>
#include <zephyr/drivers/adc.h>
#include <zephyr/drivers/pwm.h>
#include <zephyr/drivers/watchdog.h>

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
static const struct device* __tc_i2c0_dev = DEVICE_DT_GET(DT_NODELABEL(i2c0));
// CUTTLEFISH_I2C_END
// CUTTLEFISH_THREAD_BEGIN
K_THREAD_STACK_DEFINE(__tc_thrd0_stack, 4096);
static struct k_thread __tc_thrd0_thread;
static void (*__tc_thrd0_fn)(void) = NULL;
static void __tc_thrd0_tramp(void* a, void* b, void* c) { (void)a; (void)b; (void)c; if (__tc_thrd0_fn) { __tc_thrd0_fn(); } }
// CUTTLEFISH_THREAD_END
// CUTTLEFISH_PWM_BEGIN
static const struct pwm_dt_spec __tc_pwm_tc_pwm17 = PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm17));
// CUTTLEFISH_PWM_END
// CUTTLEFISH_WDT_BEGIN
static const struct device* __tc_wdt_dev = DEVICE_DT_GET(DT_NODELABEL(wdt0));
static int __tc_wdt_channel = -1;
static bool __tc_wdt_setup_done = false;
// CUTTLEFISH_WDT_END
// CUTTLEFISH_ADC_BEGIN
static const struct device* __tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc0));
static bool __tc_adc0_ready = false;
static void __tc_adc0_setup(void) {
    if (__tc_adc0_ready) return;
    const struct adc_channel_cfg cfg = {
        .gain = ADC_GAIN_1_4,
        .reference = ADC_REF_INTERNAL,
        .acquisition_time = ADC_ACQ_TIME_DEFAULT,
        .channel_id = 0,
        .differential = 0,
    };
    adc_channel_setup(__tc_adc_dev, &cfg);
    __tc_adc0_ready = true;
}
#define __TC_ADC_VREF_MV 1100
#define __TC_ADC_RESOLUTION 12
// CUTTLEFISH_ADC_END
#endif // CUTTLEFISH_SHIM_DEFINED
#ifndef __TC_DT_SW0_SPEC
#define __TC_DT_SW0_SPEC
static const struct gpio_dt_spec __tc_dt_sw0 = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);
#endif // __TC_DT_SW0_SPEC

#include "src.h"

void main_isr_0() {
# 12 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3"
  k_msleep(100);
}

// Auto-generated main() for top-level statements
# 2 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
int main()
{
  __tc_println("[TC:SUITE_START]");
# 12 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_thrd0_fn = (main_isr_0); (void)k_thread_create(&__tc_thrd0_thread, __tc_thrd0_stack, K_THREAD_STACK_SIZEOF(__tc_thrd0_stack), __tc_thrd0_tramp, NULL, NULL, NULL, 5, 0, K_NO_WAIT);
# 13 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  if (!__tc_wdt_setup_done) {     const struct wdt_timeout_cfg __cfg = { .window = { .min = 0, .max = 8000 }, .callback = NULL, .flags = WDT_FLAG_RESET_CPU_CORE };     __tc_wdt_channel = wdt_install_timeout(__tc_wdt_dev, &__cfg);     wdt_setup(__tc_wdt_dev, WDT_OPT_PAUSE_HALTED_BY_DBG);     __tc_wdt_setup_done = true; }
# 14 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  {
    { static bool __tc_gpio_cfg_raw21_done = false; if (!__tc_gpio_cfg_raw21_done) { gpio_pin_configure(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 21, GPIO_OUTPUT); __tc_gpio_cfg_raw21_done = true; } }
    gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 21, 1);
  }
# 15 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  { static bool __tc_pwm_p17_prd = false; if (!__tc_pwm_p17_prd) { (void)pwm_set_dt(&__tc_pwm_tc_pwm17, 20000000, 0); __tc_pwm_p17_prd = true; } (void)pwm_set_pulse_dt(&__tc_pwm_tc_pwm17, static_cast<uint32_t>(static_cast<double>(0.5f) * static_cast<double>(20000000))); }
# 16 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("[TC:DESCRIBE:thin HAL on esp32s3]");
# 17 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("[TC:IT:Time.now reads monotonic milliseconds since boot]");
# 18 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  const auto __tc_v1 = static_cast<double>(k_uptime_get());
# 19 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_print("[TC:EXPECT:toBeGreaterThan:0:");
# 20 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_print(__tc_v1);
# 21 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("]");
# 22 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("[TC:IT:BOOT button (sw0, active-low) reads logically NOT pressed]");
# 23 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  const auto __tc_v2 = ({ static bool __tc_gpio_cfg_sw0_done = false; if (!__tc_gpio_cfg_sw0_done) { gpio_pin_configure_dt(&__tc_dt_sw0, GPIO_INPUT | GPIO_PULL_UP); __tc_gpio_cfg_sw0_done = true; } gpio_pin_get_dt(&__tc_dt_sw0); });
# 24 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_print("[TC:EXPECT:toBeFalsy::");
# 25 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_print(__tc_v2);
# 26 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("]");
# 27 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("[TC:IT:ADC (A0, gain 1x internal ref) reads raw counts within 12 bits]");
# 28 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  const auto __tc_v3 = ({ static bool __tc_adct1_done = false; if (!__tc_adct1_done) { const struct adc_channel_cfg __tc_adct1_cfg = { .gain = ADC_GAIN_1, .reference = ADC_REF_INTERNAL, .acquisition_time = ADC_ACQ_TIME_DEFAULT, .channel_id = 0, .differential = 0 }; adc_channel_setup(__tc_adc_dev, &__tc_adct1_cfg); __tc_adct1_done = true; } int16_t __b = 0; struct adc_sequence __s = { .channels = BIT(0), .buffer = &__b, .buffer_size = sizeof(__b), .resolution = 12 }; adc_read(__tc_adc_dev, &__s); __b; });
# 29 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_print("[TC:EXPECT:toBeWithinRange:0,4095:");
# 30 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_print(__tc_v3);
# 31 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("]");
# 32 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("[TC:IT:I2C register read on an empty bus fails safe to 0]");
# 33 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  const auto __tc_v4 = ({  uint8_t __v = 0; (void)i2c_reg_read_byte(__tc_i2c0_dev, static_cast<uint16_t>(68), static_cast<uint8_t>(50), &__v); __v; });
# 34 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_print("[TC:EXPECT:toBeWithinRange:0,255:");
# 35 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_print(__tc_v4);
# 36 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("]");
# 37 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  if (__tc_wdt_channel >= 0) { wdt_feed(__tc_wdt_dev, __tc_wdt_channel); }
# 38 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  (void)k_thread_join(&__tc_thrd0_thread, K_FOREVER);
# 39 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  __tc_println("[TC:SUITE_END]");
# 40 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  while (true)
  {
    k_msleep(1000);
  }
# 2 "C:/typecad/typecode/packages/framework-zephyr/hal/esp32s3/hal.test.ts"
  return 0;
}
