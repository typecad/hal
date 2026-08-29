// ---------------------------------------------------------------------------
// Shared Promise runtime C++ code generator
//
// Generates a cooperative microtask queue + minimal Promise<T> runtime
// for embedded C++ targets. Used by both the generic transpiler strategy
// and the Arduino framework strategy.
//
// Functions named __typecad_async_* and __cuttlefish_wait_pin_edge are the
// runtime implementations that the HAL Async module's emit() calls resolve to.
// They are defined inside the typecad_async namespace (to see Promise<T> and
// enqueueMicrotask), and also have unscoped global aliases so the emitted
// C++ code can call them directly.
// ---------------------------------------------------------------------------

/**
 * Generate the cooperative microtask queue + minimal Promise runtime for C++.
 *
 * @param queueCapacity Maximum number of pending microtasks in the queue.
 *   Use a smaller value (e.g. 32) for memory-constrained targets like AVR,
 *   and a larger value (e.g. 256) for targets with more RAM.
 * @param includeWaitForPinEdge Whether to include the `waitForPinEdge` stub
 *   (used by Arduino targets).
 */
export function generatePromiseRuntime(
  queueCapacity: number,
  includeWaitForPinEdge: boolean = false,
  strategy?: import("./platform-strategy.js").PlatformStrategy,
): string {
  // The current-time expression (__tc_now_ms() — the runtime clock contract
  // every strategy provides). Falling back to the contract symbol keeps the
  // behavior when no strategy is supplied.
  const now = strategy?.currentTimeMillis?.() ?? "__tc_now_ms()";
  const waitForPinEdge = includeWaitForPinEdge ? `
  // HAL-level wait for pin edge — polling-based implementation.
  // Detects an actual transition (idle→target), not just the current level.
  // Uses a two-phase approach: phase 1 waits for the idle level, phase 2 waits
  // for the target level (the edge). Each phase re-enqueues on the microtask
  // queue so other tasks can run between polls.
  inline Promise<void> __cuttlefish_wait_pin_edge(int pin, int mode, long timeout) {
    return Promise<void>([pin, mode, timeout](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      int targetState = (mode == RISING) ? HIGH : LOW;
      int idleState = (mode == RISING) ? LOW : HIGH;
      unsigned long start = ${now};
      // Phase 2 poller: waits for the pin to reach the target state (the edge).
      auto pollTarget = [pin, targetState, timeout, start, resolve]() {
        if (${strategy?.readDigitalPin?.("pin") ?? "digitalRead(pin)"} == targetState) {
          resolve(nullptr);
        } else if (timeout >= 0 && (${now} - start >= static_cast<unsigned long>(timeout))) {
          resolve(nullptr);
        } else {
          enqueueMicrotask([pin, targetState, timeout, start, resolve]() {
            if (${strategy?.readDigitalPin?.("pin") ?? "digitalRead(pin)"} == targetState) {
              resolve(nullptr);
            } else if (timeout >= 0 && (${now} - start >= static_cast<unsigned long>(timeout))) {
              resolve(nullptr);
            } else {
              enqueueMicrotask([pin, targetState, timeout, start, resolve]() {});
            }
          });
        }
      };
      // Phase 1: wait for idle state before watching for the edge.
      enqueueMicrotask([pin, idleState, timeout, start, resolve, pollTarget]() {
        if (${strategy?.readDigitalPin?.("pin") ?? "digitalRead(pin)"} == idleState) {
          pollTarget();
        } else if (timeout >= 0 && (${now} - start >= static_cast<unsigned long>(timeout))) {
          resolve(nullptr);
        } else {
          enqueueMicrotask([pin, idleState, timeout, start, resolve, pollTarget]() {});
        }
      });
    });
  }
` : "";

  return `
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
      if (_queue.size() >= ${queueCapacity}) {
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
      unsigned long start = ${now};
      if (${now} - start >= ms) {
        resolve(nullptr);
      } else {
        enqueueMicrotask([ms, start, resolve]() {
          if (${now} - start >= ms) {
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
      unsigned long start = ${now};
      enqueueMicrotask([pollIntervalMs, start, resolve]() {
        if (${now} - start >= pollIntervalMs) {
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

${waitForPinEdge}
} // namespace typecad_async

// ── Global-scope aliases so HAL emit() calls resolve ──
using typecad_async::__cuttlefish_async_sleep;
using typecad_async::__cuttlefish_async_yield;
using typecad_async::__cuttlefish_async_sleep_until;
using typecad_async::__cuttlefish_async_current_task;
${includeWaitForPinEdge ? `using typecad_async::__cuttlefish_wait_pin_edge;` : ``}

inline void cuttlefish_pump_microtasks() {
  typecad_async::pumpMicrotasks();
}
`;
}