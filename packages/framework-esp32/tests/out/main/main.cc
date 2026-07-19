#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "driver/gpio.h"

// --- ESP32 IDF entrypoint: app_main + __tc_app_task ---
// The cuttlefish synthesizer emits setup() and loop() (it keys off
// entrypointFunctionName()="setup" and requiresLoopFunction()=true).
// This trampoline spawns a FreeRTOS task that runs them, matching
// Arduino's default task config (8192 stack, priority 1, tskNO_AFFINITY).
extern void setup(void);
extern void loop(void);

static void __tc_app_task(void *arg) {
    (void)arg;
    setup();
    for (;;) {
        loop();
        // Yield to the IDLE task so the task watchdog doesn't fire
        // when loop() is empty or runs without blocking. Costs ~1ms
        // per iteration.
        vTaskDelay(1);
    }
}

extern "C" void app_main(void) {
    xTaskCreate(__tc_app_task, "tc_app", 8192, NULL, 1, NULL);
}


static double __tc_fn1();
static double __tc_fn2();
static double __tc_fn3();
static double __tc_fn4();
static double __tc_fn5();
static double __tc_fn6();
static double __tc_fn7();
static double __tc_fn8();
static double __tc_fn9();
static double __tc_fn10();
static double __tc_fn11();
static double __tc_fn12();
static double __tc_fn13();
static double __tc_fn14();
static double __tc_fn15();
static double __tc_fn16();
static double __tc_fn17();
static double __tc_fn18();
static double __tc_fn19();
static double __tc_fn20();
static double __tc_fn21();
static double __tc_fn22();
static double __tc_fn23();
static double __tc_fn20__add(double a, double b);

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:GPIO (gpio_set_level / gpio_get_level)]");
  Serial.println("[TC:IT:output high/low on D2 compiles and runs without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:output write with a runtime value runs without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:toggle on D2 runs without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:input pullup reads HIGH on a floating pin (D4)]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:input (no pull) on D4 reads without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:IT:output→input loopback: write HIGH then read back HIGH]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Timing (esp_timer_get_time + vTaskDelay)]");
  Serial.println("[TC:IT:Timing.millis() returns a non-negative value]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.println("[TC:IT:Timing.micros() returns a non-negative value]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.println("[TC:IT:Timing.millis() advances over time]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn9());
  Serial.println("]");
  Serial.println("[TC:IT:Timing.micros() advances over time]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn10());
  Serial.println("]");
  Serial.println("[TC:IT:Timing.delay() is callable without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn11());
  Serial.println("]");
  Serial.println("[TC:IT:Timing.delayMicroseconds() is callable without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn12());
  Serial.println("]");
  Serial.println("[TC:IT:Timing.freeHeap() returns a positive value]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn13());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:ADC (adc1_get_raw + esp_adc_cal)]");
  Serial.println("[TC:IT:readAnalog on D5 returns a value within the 12-bit range [0, 4095]]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn14());
  Serial.println("]");
  Serial.println("[TC:IT:readVoltage returns a non-negative value]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn15());
  Serial.println("]");
  Serial.println("[TC:IT:readVoltage returns a value within the valid range [0, ~3300] mV]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn16());
  Serial.println("]");
  Serial.println("[TC:IT:two consecutive reads on the same pin are within a sane delta]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn17());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Console (printf via UART)]");
  Serial.println("[TC:IT:console.log is callable without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn18());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Language basics]");
  Serial.println("[TC:IT:arithmetic]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn19());
  Serial.println("]");
  Serial.println("[TC:IT:functions]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn20());
  Serial.println("]");
  Serial.println("[TC:IT:objects]");
  Serial.print("[TC:EXPECT:toBe:150:");
  Serial.print(__tc_fn21());
  Serial.println("]");
  Serial.println("[TC:IT:destructuring with default]");
  Serial.print("[TC:EXPECT:toBe:500:");
  Serial.print(__tc_fn22());
  Serial.println("]");
  Serial.println("[TC:IT:Uint8Array]");
  Serial.print("[TC:EXPECT:toBe:0x10:");
  Serial.print(__tc_fn23());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

static double __tc_fn1()
{
  gpio_reset_pin((gpio_num_t)2); gpio_set_direction((gpio_num_t)2, GPIO_MODE_OUTPUT);
  gpio_set_level((gpio_num_t)2, 1);
  vTaskDelay(pdMS_TO_TICKS(1));
  gpio_set_level((gpio_num_t)2, 0);
  return 1;
}

static double __tc_fn2()
{
  gpio_reset_pin((gpio_num_t)2); gpio_set_direction((gpio_num_t)2, GPIO_MODE_OUTPUT);
  int v = 0;
  gpio_set_level((gpio_num_t)2, ((v) ? 1 : 0));
  v = 1;
  gpio_set_level((gpio_num_t)2, ((v) ? 1 : 0));
  return 1;
}

static double __tc_fn3()
{
  gpio_reset_pin((gpio_num_t)2); gpio_set_direction((gpio_num_t)2, GPIO_MODE_OUTPUT);
  gpio_set_level((gpio_num_t)2, !gpio_get_level((gpio_num_t)2));
  vTaskDelay(pdMS_TO_TICKS(1));
  gpio_set_level((gpio_num_t)2, !gpio_get_level((gpio_num_t)2));
  return 1;
}

static double __tc_fn4()
{
  gpio_reset_pin((gpio_num_t)4); gpio_set_direction((gpio_num_t)4, GPIO_MODE_INPUT); gpio_pullup_en((gpio_num_t)4);
  vTaskDelay(pdMS_TO_TICKS(1));
  return (gpio_get_level((gpio_num_t)4) ? 1 : 0);
}

static double __tc_fn5()
{
  gpio_reset_pin((gpio_num_t)4); gpio_set_direction((gpio_num_t)4, GPIO_MODE_INPUT);
  vTaskDelay(pdMS_TO_TICKS(1));
  gpio_get_level((gpio_num_t)4);
  return 1;
}

static double __tc_fn6()
{
  gpio_reset_pin((gpio_num_t)2); gpio_set_direction((gpio_num_t)2, GPIO_MODE_OUTPUT);
  gpio_set_level((gpio_num_t)2, 1);
  vTaskDelay(pdMS_TO_TICKS(1));
  gpio_reset_pin((gpio_num_t)2); gpio_set_direction((gpio_num_t)2, GPIO_MODE_INPUT);
  vTaskDelay(pdMS_TO_TICKS(1));
  return (gpio_get_level((gpio_num_t)2) ? 1 : 0);
}

static double __tc_fn7()
{
  const auto t = (esp_timer_get_time() / 1000);
  return (t >= 0 ? 1 : 0);
}

static double __tc_fn8()
{
  const auto t = esp_timer_get_time();
  return (t >= 0 ? 1 : 0);
}

static double __tc_fn9()
{
  const auto t0 = (esp_timer_get_time() / 1000);
  vTaskDelay(pdMS_TO_TICKS(10));
  const auto t1 = (esp_timer_get_time() / 1000);
  return (t1 > t0 ? 1 : 0);
}

static double __tc_fn10()
{
  const auto t0 = esp_timer_get_time();
  esp_rom_delay_us(100);
  const auto t1 = esp_timer_get_time();
  return (t1 > t0 ? 1 : 0);
}

static double __tc_fn11()
{
  vTaskDelay(pdMS_TO_TICKS(1));
  return 1;
}

static double __tc_fn12()
{
  esp_rom_delay_us(50);
  return 1;
}

static double __tc_fn13()
{
  const auto h = esp_get_free_heap_size();
  return (h > 0 ? 1 : 0);
}

static double __tc_fn14()
{
  gpio_reset_pin((gpio_num_t)5); gpio_set_direction((gpio_num_t)5, GPIO_MODE_INPUT);
  const auto v = adc1_get_raw(ADC1_CHANNEL_4);
  return ((v >= 0 && v <= 4095) ? 1 : 0);
}

static double __tc_fn15()
{
  gpio_reset_pin((gpio_num_t)5); gpio_set_direction((gpio_num_t)5, GPIO_MODE_INPUT);
  const auto v = esp_adc_cal_raw_to_voltage(adc1_get_raw(ADC1_CHANNEL_4), &__tc_adc_chars);
  return (v >= 0 ? 1 : 0);
}

static double __tc_fn16()
{
  gpio_reset_pin((gpio_num_t)5); gpio_set_direction((gpio_num_t)5, GPIO_MODE_INPUT);
  const auto v = esp_adc_cal_raw_to_voltage(adc1_get_raw(ADC1_CHANNEL_4), &__tc_adc_chars);
  return ((v >= 0 && v <= 3300) ? 1 : 0);
}

static double __tc_fn17()
{
  gpio_reset_pin((gpio_num_t)5); gpio_set_direction((gpio_num_t)5, GPIO_MODE_INPUT);
  const auto v0 = adc1_get_raw(ADC1_CHANNEL_4);
  const auto v1 = adc1_get_raw(ADC1_CHANNEL_4);
  const auto delta = (v0 > v1 ? v0 - v1 : v1 - v0);
  // Floating input is noisy; allow up to 1000 counts delta.
  return (delta < 1000 ? 1 : 0);
}

static double __tc_fn18()
{
  printf(, "hw-test-ok");
  return 1;
}

static double __tc_fn19()
{
  const int a = 1;
  const int b = 2;
  return 5 + b;
}

static double __tc_fn20()
{
  return __tc_fn20__add(1, 2);
}

static double __tc_fn21()
{
  struct _config_t { int low; int high; } config = { 150, 700 };
  return config.low;
}

static double __tc_fn22()
{
  struct _config_t { int low; int high; int timeout; } config = { 150, 700, CUTTLEFISH_UNDEFINED };
  const auto timeout = cuttlefish_nullish(config.timeout, 500);
  return timeout;
}

static double __tc_fn23()
{
  uint8_t arr[] = { 170, 16, 32 };
  return arr[1];
}

static double __tc_fn20__add(double a, double b)
{
  return 5 + b;
}

void loop()
{
}
