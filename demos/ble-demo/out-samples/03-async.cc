#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_nimble_hci.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include <iostream>
#include "driver/gpio.h"
#include <functional>
#include <vector>
#include <utility>
#include <string>

// Arduino-compat symbols for shared polyfills (ESP-IDF).
// Suppress multichar warnings: the runtime header's touch-keyboard code
// uses multi-character constants like 'OK' and 'ABC' as int-sized key
// labels (GCC extension). -Werror=multichar would flag these.
#pragma GCC diagnostic ignored "-Wmultichar"
// Suppress missing-field-initializers: the runtime header's static tables
// (UITransition, UINode, etc.) use designated initializers that don't name
// every field. C++ (unlike C) warns on this under -Werror.
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#ifndef HIGH
#define HIGH 1
#endif
#ifndef LOW
#define LOW 0
#endif
#ifndef RISING
#define RISING 0x01
#endif
#ifndef FALLING
#define FALLING 0x02
#endif
static inline unsigned long millis() {
    return (unsigned long)(esp_timer_get_time() / 1000);
}
static inline int digitalRead(int pin) {
    return (int)gpio_get_level((gpio_num_t)pin);
}
// Arduino core math helpers — referenced by runtime header code (touch
// keyboard's range-clamping in touch-keyboard-fwd.ts). On Arduino these are
// macros in Arduino.h; ESP-IDF has no equivalent so we define them as macros
// here (matching Arduino's exact shape, so type deduction matches call sites
// like constrain(int16_t, int, int)).
#ifndef constrain
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#endif
#ifndef map
#define map(x, in_min, in_max, out_min, out_max) ((x) - (in_min)) * ((out_max) - (out_min)) / ((in_max) - (in_min)) + (out_min)
#endif
// PROGMEM + pgm_read_* — AVR flash-memory macros. On ESP32 all memory is
// uniform (no Harvard architecture), so PROGMEM is a no-op and pgm_read
// is a simple dereference. Font tables emitted by the runtime header use
// these (e.g. __ui_font_N_alpha[] PROGMEM).
#ifndef PROGMEM
#define PROGMEM
#endif
#ifndef pgm_read_byte
#define pgm_read_byte(addr) (*(const uint8_t*)(addr))
#endif
#ifndef pgm_read_word
#define pgm_read_word(addr) (*(const uint16_t*)(addr))
#endif

// Cooperative microtask queue + minimal Promise runtime
namespace typecad_async {
  using Microtask = std::function<void()>;

  class MicrotaskQueue {
  public:
    static MicrotaskQueue& instance() {
      static MicrotaskQueue queue;
      return queue;
    }

    bool enqueue(Microtask task) {
      if (_queue.size() >= 256) {
        return false;
      }
      _queue.push_back(std::move(task));
      return true;
    }

    void pump() {
      const size_t total = _queue.size();
      for (size_t i = 0; i < total; ++i) {
        Microtask task = std::move(_queue[i]);
        task();
      }
      if (total > 0) {
        _queue.erase(_queue.begin(), _queue.begin() + static_cast<long long>(total));
      }
    }

  private:
    std::vector<Microtask> _queue;
  };

  inline void enqueueMicrotask(Microtask task) {
    MicrotaskQueue::instance().enqueue(std::move(task));
  }

  inline void pumpMicrotasks() {
    MicrotaskQueue::instance().pump();
  }

  template <typename T>
  class Promise {
  public:
    enum class State { Pending, Fulfilled, Rejected };

    Promise() : _state(State::Pending), _value{}, _error{} {}

    explicit Promise(std::function<void(std::function<void(const T&)>, std::function<void(const std::string&)>)> executor)
      : _state(State::Pending), _value{}, _error{} {
      executor(
        [this](const T& value) { this->resolve(value); },
        [this](const std::string& error) { this->reject(error); }
      );
    }

    static Promise<T> resolveValue(const T& value) {
      Promise<T> promise;
      promise.resolve(value);
      return promise;
    }

    static Promise<T> rejectValue(const std::string& error) {
      Promise<T> promise;
      promise.reject(error);
      return promise;
    }

    void resolve(const T& value) {
      if (_state != State::Pending) return;
      _state = State::Fulfilled;
      _value = value;
      auto callbacks = _onFulfilled;
      enqueueMicrotask([callbacks, value]() mutable {
        for (auto& callback : callbacks) { callback(value); }
      });
    }

    void reject(const std::string& error) {
      if (_state != State::Pending) return;
      _state = State::Rejected;
      _error = error;
      auto callbacks = _onRejected;
      enqueueMicrotask([callbacks, error]() mutable {
        for (auto& callback : callbacks) { callback(error); }
      });
    }

    Promise<T>& then(std::function<void(const T&)> onFulfilled) {
      if (_state == State::Fulfilled) {
        const T value = _value;
        enqueueMicrotask([onFulfilled, value]() mutable { onFulfilled(value); });
      } else if (_state == State::Pending) {
        _onFulfilled.push_back(std::move(onFulfilled));
      }
      return *this;
    }

    Promise<T>& catchError(std::function<void(const std::string&)> onRejected) {
      if (_state == State::Rejected) {
        const std::string error = _error;
        enqueueMicrotask([onRejected, error]() mutable { onRejected(error); });
      } else if (_state == State::Pending) {
        _onRejected.push_back(std::move(onRejected));
      }
      return *this;
    }

  private:
    State _state;
    T _value;
    std::string _error;
    std::vector<std::function<void(const T&)>> _onFulfilled;
    std::vector<std::function<void(const std::string&)>> _onRejected;
  };

  // Promise<void> — T=_value/const T& is illegal for void. Helpers below pass
  // resolve as std::function<void(const void*)> (pointer, not reference).
  template <>
  class Promise<void> {
  public:
    enum class State { Pending, Fulfilled, Rejected };

    using ResolveFn = std::function<void(const void*)>;
    using RejectFn = std::function<void(const std::string&)>;
    using Executor = std::function<void(ResolveFn, RejectFn)>;

    Promise() : _state(State::Pending), _error{} {}

    explicit Promise(Executor executor)
      : _state(State::Pending), _error{} {
      executor(
        [this](const void*) { this->resolve(nullptr); },
        [this](const std::string& error) { this->reject(error); }
      );
    }

    static Promise<void> resolveValue() {
      Promise<void> promise;
      promise.resolve(nullptr);
      return promise;
    }

    static Promise<void> rejectValue(const std::string& error) {
      Promise<void> promise;
      promise.reject(error);
      return promise;
    }

    void resolve(const void* = nullptr) {
      if (_state != State::Pending) return;
      _state = State::Fulfilled;
      auto callbacks = _onFulfilled;
      enqueueMicrotask([callbacks]() mutable {
        for (auto& callback : callbacks) { callback(nullptr); }
      });
    }

    void reject(const std::string& error) {
      if (_state != State::Pending) return;
      _state = State::Rejected;
      _error = error;
      auto callbacks = _onRejected;
      enqueueMicrotask([callbacks, error]() mutable {
        for (auto& callback : callbacks) { callback(error); }
      });
    }

    Promise<void>& then(std::function<void(const void*)> onFulfilled) {
      if (_state == State::Fulfilled) {
        enqueueMicrotask([onFulfilled]() mutable { onFulfilled(nullptr); });
      } else if (_state == State::Pending) {
        _onFulfilled.push_back(std::move(onFulfilled));
      }
      return *this;
    }

    Promise<void>& catchError(std::function<void(const std::string&)> onRejected) {
      if (_state == State::Rejected) {
        const std::string error = _error;
        enqueueMicrotask([onRejected, error]() mutable { onRejected(error); });
      } else if (_state == State::Pending) {
        _onRejected.push_back(std::move(onRejected));
      }
      return *this;
    }

  private:
    State _state;
    std::string _error;
    std::vector<std::function<void(const void*)>> _onFulfilled;
    std::vector<std::function<void(const std::string&)>> _onRejected;
  };

  // ── HAL-level implementations (inside namespace so they see Promise<T> and enqueueMicrotask) ──

  // Async.sleep() — cooperative delay using millis polling
  inline Promise<void> __cuttlefish_async_sleep(unsigned long ms) {
    return Promise<void>([ms](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      unsigned long start = millis();
      if (millis() - start >= ms) {
        resolve(nullptr);
      } else {
        enqueueMicrotask([ms, start, resolve]() {
          if (millis() - start >= ms) {
            resolve(nullptr);
          } else {
            enqueueMicrotask([ms, start, resolve]() { /* will be re-checked next cycle */ });
          }
        });
      }
    });
  }

  // Async.yield() — defer to next microtask pump cycle
  inline Promise<void> __cuttlefish_async_yield() {
    return Promise<void>([](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      enqueueMicrotask([resolve]() { resolve(nullptr); });
    });
  }

  // Async.sleepUntil() — poll condition every interval ms
  inline Promise<void> __cuttlefish_async_sleep_until(unsigned long pollIntervalMs) {
    return Promise<void>([pollIntervalMs](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      unsigned long start = millis();
      enqueueMicrotask([pollIntervalMs, start, resolve]() {
        if (millis() - start >= pollIntervalMs) {
          resolve(nullptr);  // caller re-checks condition
        } else {
          enqueueMicrotask([pollIntervalMs, start, resolve]() { /* re-check next cycle */ });
        }
      });
    });
  }

  // Async.currentTask() — return task description string
  inline const char* __cuttlefish_async_current_task() {
    return "main";
  }


  // HAL-level wait for pin edge — polling-based implementation.
  // Detects an actual transition (idle→target), not just the current level.
  // Uses a two-phase approach: phase 1 waits for the idle level, phase 2 waits
  // for the target level (the edge). Each phase re-enqueues on the microtask
  // queue so other tasks can run between polls.
  inline Promise<void> __cuttlefish_wait_pin_edge(int pin, int mode, long timeout) {
    return Promise<void>([pin, mode, timeout](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      int targetState = (mode == RISING) ? HIGH : LOW;
      int idleState = (mode == RISING) ? LOW : HIGH;
      unsigned long start = millis();
      // Phase 2 poller: waits for the pin to reach the target state (the edge).
      auto pollTarget = [pin, targetState, timeout, start, resolve]() {
        if (digitalRead(pin) == targetState) {
          resolve(nullptr);
        } else if (timeout >= 0 && (millis() - start >= (unsigned long)timeout)) {
          resolve(nullptr);
        } else {
          enqueueMicrotask([pin, targetState, timeout, start, resolve]() {
            if (digitalRead(pin) == targetState) {
              resolve(nullptr);
            } else if (timeout >= 0 && (millis() - start >= (unsigned long)timeout)) {
              resolve(nullptr);
            } else {
              enqueueMicrotask([pin, targetState, timeout, start, resolve]() {});
            }
          });
        }
      };
      // Phase 1: wait for idle state before watching for the edge.
      enqueueMicrotask([pin, idleState, timeout, start, resolve, pollTarget]() {
        if (digitalRead(pin) == idleState) {
          pollTarget();
        } else if (timeout >= 0 && (millis() - start >= (unsigned long)timeout)) {
          resolve(nullptr);
        } else {
          enqueueMicrotask([pin, idleState, timeout, start, resolve, pollTarget]() {});
        }
      });
    });
  }

} // namespace typecad_async

// ── Global-scope aliases so HAL emit() calls resolve ──
using typecad_async::__cuttlefish_async_sleep;
using typecad_async::__cuttlefish_async_yield;
using typecad_async::__cuttlefish_async_sleep_until;
using typecad_async::__cuttlefish_async_current_task;
using typecad_async::__cuttlefish_wait_pin_edge;

inline void cuttlefish_pump_microtasks() {
  typecad_async::pumpMicrotasks();
}


// ── Shared I2C bus handle store (one per controller) ────────────────────
// Created idempotently by whichever adapter (display, touch, user I2C)
// runs first. All consumers call i2c_master_bus_add_device against the
// shared handle returned by __esp32_i2c_bus_get().
#include "driver/i2c_master.h"
static i2c_master_bus_handle_t __esp32_i2c0_bus = NULL;
static i2c_master_bus_handle_t __esp32_i2c1_bus = NULL;
static inline i2c_master_bus_handle_t __esp32_i2c_bus_get(uint8_t controller) {
  if (controller == 0) {
    if (__esp32_i2c0_bus) return __esp32_i2c0_bus;
    i2c_master_bus_config_t bcfg = {};
    bcfg.i2c_port = I2C_NUM_0;
    bcfg.sda_io_num = (gpio_num_t)21;
    bcfg.scl_io_num = (gpio_num_t)22;
    bcfg.clk_source = I2C_CLK_SRC_DEFAULT;
    bcfg.glitch_ignore_cnt = 7;
    bcfg.flags.enable_internal_pullup = 1;
    if (i2c_new_master_bus(&bcfg, &__esp32_i2c0_bus) != ESP_OK) {
      __esp32_i2c0_bus = NULL;  // bus creation failed — callers will see NULL
    }
    return __esp32_i2c0_bus;
  }
  if (controller == 1) {
    if (__esp32_i2c1_bus) return __esp32_i2c1_bus;
    i2c_master_bus_config_t bcfg = {};
    bcfg.i2c_port = I2C_NUM_1;
    bcfg.sda_io_num = (gpio_num_t)18;
    bcfg.scl_io_num = (gpio_num_t)19;
    bcfg.clk_source = I2C_CLK_SRC_DEFAULT;
    bcfg.glitch_ignore_cnt = 7;
    bcfg.flags.enable_internal_pullup = 1;
    if (i2c_new_master_bus(&bcfg, &__esp32_i2c1_bus) != ESP_OK) {
      __esp32_i2c1_bus = NULL;  // bus creation failed — callers will see NULL
    }
    return __esp32_i2c1_bus;
  }
  return NULL;  // unknown controller index
}

static void (*__tc_coop_poll_hook)(void) = NULL;
static inline void __tc_delay(uint32_t ms) {
    if (__tc_coop_poll_hook == NULL) {
        vTaskDelay(pdMS_TO_TICKS(ms == 0 ? 1 : ms));
        return;
    }
    int64_t deadline = esp_timer_get_time() + (int64_t)ms * 1000;
    do {
        __tc_coop_poll_hook();
        vTaskDelay(1);
    } while (esp_timer_get_time() < deadline);
}

// CUTTLEFISH_BLE_BEGIN
#define __TC_BLE_MAX_CHARS 16
#define __TC_BLE_MAX_SVCS 8
typedef int16_t (*__tc_ble_read_cb_t)(void);
typedef void    (*__tc_ble_write_cb_t)(int16_t value);
typedef void    (*__tc_ble_subscribe_cb_t)(bool enabled);
typedef void    (*__tc_ble_connect_cb_t)(void);

// Deferred characteristic definition (populated before __tc_ble_server_begin).
typedef struct {
    const char* uuid;
    const char* type;
    int perms;            // bitmask: READ=1, WRITE=2, NOTIFY=4
    int svc_index;        // which service this char belongs to
} __tc_ble_char_def_t;

static struct {
    volatile int status;             // BleStatus enum
    volatile bool inited;
    volatile bool advertising;
    volatile int connected_clients;
    uint16_t svc_count;
    __tc_ble_read_cb_t      on_read[__TC_BLE_MAX_CHARS];
    __tc_ble_write_cb_t     on_write[__TC_BLE_MAX_CHARS];
    __tc_ble_subscribe_cb_t on_subscribe[__TC_BLE_MAX_CHARS];
    __tc_ble_connect_cb_t   on_connect;
    __tc_ble_connect_cb_t   on_disconnect;
    char name[32];
} __tc_ble = { 0, false, false, 0, 0, {0}, {0}, {0}, NULL, NULL, {0} };

static __tc_ble_char_def_t __tc_ble_char_defs[__TC_BLE_MAX_CHARS];
static int __tc_ble_char_count = 0;
static const char* __tc_ble_svc_uuids[__TC_BLE_MAX_SVCS];
// Static pool for the synthesized NimBLE service table.
static struct ble_gatt_svc_def __tc_ble_svcs[__TC_BLE_MAX_SVCS + 1];
static struct ble_gatt_chr_def __tc_ble_chr_pool[__TC_BLE_MAX_CHARS + __TC_BLE_MAX_SVCS];

// ── GAP event handler — drives connected_clients + connect/disconnect callbacks ──
static int __tc_ble_gap_event(struct ble_gap_event *event, void *arg) {
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            __tc_ble.connected_clients++;
            __tc_ble.status = 3; // Connected
            if (__tc_ble.on_connect) __tc_ble.on_connect();
        }
        break;
    case BLE_GAP_EVENT_DISCONNECT:
        __tc_ble.connected_clients--;
        if (__tc_ble.connected_clients <= 0) {
            __tc_ble.connected_clients = 0;
            __tc_ble.status = 2; // Advertising
        }
        if (__tc_ble.on_disconnect) __tc_ble.on_disconnect();
        break;
    case BLE_GAP_EVENT_SUBSCRIBE:
        // Per-characteristic subscribe callback dispatch happens in the access cb.
        break;
    default: break;
    }
    return 0;
}

// ── NimBLE host task — must run on its own FreeRTOS task (host requirement) ──
static void __tc_ble_host_task(void *param) {
    (void)param;
    nimble_host_task(param);  // does not return
}

// sync callback: infer address + transition out of Initializing.
static void __tc_ble_on_sync(void) {
    ble_hs_id_infer_auto(0, NULL);
    if (__tc_ble.status == 1) {
        __tc_ble.status = 2; // Advertising
    }
}

static void __tc_ble_ensure_init(void) {
    if (__tc_ble.inited) return;
    ESP_ERROR_CHECK(esp_nimble_hci_and_controller_init());
    nimble_port_init();
    ble_hs_cfg.sync_cb = __tc_ble_on_sync;
    __tc_ble.status = 1; // Initializing
    nimble_port_freertos_init(__tc_ble_host_task);
    __tc_ble.inited = true;
}

static inline bool __tc_ble_is_connected(void) {
    return __tc_ble.status == 3 && __tc_ble.connected_clients > 0;
}

static inline int __tc_ble_client_count(void) {
    return __tc_ble.connected_clients;
}

static inline void __tc_ble_set_name(const char* name) {
    strlcpy(__tc_ble.name, name, sizeof(__tc_ble.name));
    ble_svc_gap_device_name_set(name);
}

static inline void __tc_ble_set_tx_power(int dbm) {
    esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_DEFAULT, dbm);
}

// ── Deferred service graph ──
static inline void __tc_ble_add_service(const char* uuid) {
    if (__tc_ble.svc_count < __TC_BLE_MAX_SVCS) {
        __tc_ble_svc_uuids[__tc_ble.svc_count] = uuid;
        __tc_ble.svc_count++;
    }
}

static inline void __tc_ble_add_char(int idx, const char* uuid, const char* type, int perms, int svc_index) {
    (void)type;  // type drives the marshalling wrapper, not the service-table shape
    if (idx >= 0 && idx < __TC_BLE_MAX_CHARS) {
        __tc_ble_char_defs[idx].uuid = uuid;
        __tc_ble_char_defs[idx].type = type;
        __tc_ble_char_defs[idx].perms = perms;
        __tc_ble_char_defs[idx].svc_index = svc_index;
        __tc_ble_char_count = (idx + 1 > __tc_ble_char_count) ? idx + 1 : __tc_ble_char_count;
    }
}

// Build the NimBLE ble_gatt_svc_def[] tree from the deferred graph.
// Called by __tc_ble_server_begin after all add_service/add_char calls.
static void __tc_ble_build_svc_table(__tc_ble_char_def_t* defs, int n,
                                      const char** svc_uuids, int n_svc) {
    int chr_idx = 0;
    for (int s = 0; s < n_svc; s++) {
        __tc_ble_svcs[s].uuid = svc_uuids[s];
        __tc_ble_svcs[s].characteristics = &__tc_ble_chr_pool[chr_idx];
        for (int c = 0; c < n; c++) {
            if (defs[c].svc_index == s) {
                __tc_ble_chr_pool[chr_idx].uuid = defs[c].uuid;
                // perms → ble_gatt_chr_flags: READ=0x02, WRITE=0x08, NOTIFY=0x10
                int flags = 0;
                if (defs[c].perms & 1) flags |= 0x02;  // BLE_GATT_CHR_F_READ
                if (defs[c].perms & 2) flags |= 0x08;  // BLE_GATT_CHR_F_WRITE
                if (defs[c].perms & 4) flags |= 0x10;  // BLE_GATT_CHR_F_NOTIFY
                __tc_ble_chr_pool[chr_idx].flags = (ble_gatt_chr_flags)flags;
                chr_idx++;
            }
        }
        __tc_ble_chr_pool[chr_idx].uuid = NULL; // terminate this svc's char list
        chr_idx++;
    }
    __tc_ble_svcs[n_svc].uuid = NULL; // terminate svc list
}

static inline void __tc_ble_server_begin(const char* name) {
    __tc_ble_ensure_init();
    ble_svc_gap_init();
    ble_svc_gatt_init();
    ble_svc_gap_device_name_set(name);
    // Walk __tc_ble_char_defs, group by svc_index, build ble_gatt_svc_def[].
    __tc_ble_build_svc_table(__tc_ble_char_defs, __tc_ble_char_count,
                             __tc_ble_svc_uuids, __tc_ble.svc_count);
    ble_gatts_count_cfg(__tc_ble_svcs);
    ble_gatts_add_svcs(__tc_ble_svcs);
}

static inline void __tc_ble_advertise_start(void) {
    __tc_ble_ensure_init();
    // Advertising params + ble_gap_adv_start use __tc_ble.name + connectable mode.
    __tc_ble.advertising = true;
}

static inline void __tc_ble_advertise_stop(void) {
    ble_gap_adv_stop();
    __tc_ble.advertising = false;
}

static inline void __tc_ble_notify(int idx, int16_t value) {
    (void)idx; (void)value;
    // ble_gatts_notify to subscribed clients at characteristic idx.
}

static inline bool __tc_ble_until_connected(uint32_t timeout_ms) {
    __tc_ble_ensure_init();
    int64_t deadline = esp_timer_get_time() + (int64_t)timeout_ms * 1000;
    while (!__tc_ble_is_connected()) {
        if (timeout_ms > 0 && esp_timer_get_time() >= deadline) return false;
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    return true;
}

static inline void __tc_ble_until_connected_start(void) {
    __tc_ble_ensure_init();
}
// CUTTLEFISH_BLE_END

// --- ESP32 IDF entrypoint: app_main runs setup()/loop() directly ---
// The cuttlefish synthesizer emits setup() and loop() (it keys off
// entrypointFunctionName()="setup" and requiresLoopFunction()=true).
//
// Following the IDF-idiomatic pattern (see esp_http_client example:
// app_main blocks on example_connect() directly), app_main itself runs
// setup() and the loop() forever. setup() typically blocks on WiFi
// connect — exactly what main_task is designed for. Spawning a separate
// task to host setup/loop was non-idiomatic and caused watchdog resets
// under WiFi load: main_task sat idle while our prio-1 spawned task
// competed with the prio-23 WiFi task for CPU0.
//
// Stack: CONFIG_ESP_MAIN_TASK_STACK_SIZE=16384 (set in sdkconfig.defaults)
// — the IDF default of 3584 overflows on WiFi/HTTP paths (esp_wifi_connect,
// TLS handshake, printf with response bodies).
extern void setup(void);
extern void loop(void);

extern "C" void app_main(void) {
    setup();
    for (;;) {
        loop();
        // Yield to the IDLE task so the task watchdog does not fire when
        // loop() is empty or runs without blocking. Costs ~1 ms/iteration.
        vTaskDelay(1);
    }
}


// Async state machine for waitForClient
class WaitforclientTask {
public:
  enum State { STATE_0, STATE_1, STATE_DONE };
  WaitforclientTask() : _state(STATE_0), _waitUntil(0) {}
  void run() {
    switch (_state) {
      case STATE_0:
        {
        printf("waiting for central...\n");
        __tc_ble_until_connected_start();
        _waitUntil = (unsigned long)(esp_timer_get_time() / 1000) + 30000;
        _state = STATE_1;
        }
        break;
      case STATE_1:
        {
        if ((__tc_ble_is_connected()) || (unsigned long)(esp_timer_get_time() / 1000) >= _waitUntil) {
          printf("central connected!\n");
          _state = STATE_DONE;
        }
        }
        break;
      case STATE_DONE:
        break;
    }
  }
  bool isComplete() const { return _state == STATE_DONE; }
  void reset() { _state = STATE_0; _waitUntil = 0; }
private:
  State _state;
  unsigned long _waitUntil;
};

WaitforclientTask waitForClientTask;

// Async state machine for heartbeat
class HeartbeatTask {
public:
  enum State { STATE_0, STATE_1 };
  HeartbeatTask() : _state(STATE_0), _waitUntil(0) {}
  void run() {
    switch (_state) {
      case STATE_0:
        {
        printf("heartbeat\n");
        _waitUntil = (unsigned long)(esp_timer_get_time() / 1000) + 1000;
        _state = STATE_1;
        }
        break;
      case STATE_1:
        {
        if ((unsigned long)(esp_timer_get_time() / 1000) >= _waitUntil) {
          _state = STATE_0;
        }
        }
        break;
    }
  }
  bool isComplete() const { return false; }
  void reset() { _state = STATE_0; _waitUntil = 0; }
private:
  State _state;
  unsigned long _waitUntil;
};

HeartbeatTask heartbeatTask;

void main_isr_0();

void main_isr_0() {
  return 2180;
}

// Auto-generated setup() for top-level statements
void setup()
{
  {
    __tc_ble_set_name("AsyncSensor");
    __tc_ble_add_char(0, "2A6E", "int16", 1, 1);
    __tc_ble.on_read[0] = &main_isr_0;
  }
  {
    __tc_ble_set_name("AsyncSensor");
    __tc_ble_server_begin("AsyncSensor");
    __tc_ble_advertise_start();
  }
}

// Auto-generated loop() for async microtask pumping
void loop()
{
  cuttlefish_pump_microtasks();
    waitForClientTask.run();
    heartbeatTask.run();
    cuttlefish_pump_microtasks();
}
