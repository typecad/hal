#include <Arduino.h>
#include <functional>
#include <vector>
#include <utility>
#include <string>

struct TsAsyncTask { bool done = true; };

#ifndef typehal_halt
#define typehal_halt(msg) do { Serial.println(F(msg)); for (;;) {} } while (0)
#endif

// Polyfill: cooperative microtask queue + minimal Promise runtime
namespace typehal_async {
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
}

inline void typehal_pump_microtasks() {
  typehal_async::pumpMicrotasks();
}

// Async state machine for blink
class BlinkTask {
public:
  enum State { STATE_0, STATE_1 };
  BlinkTask() : _state(STATE_0), _waitUntil(0) {}
  void run() {
    switch (_state) {
      case STATE_0:
        digitalWrite(2, !digitalRead(2));
        _waitUntil = millis() + 1000;
        _state = STATE_1;
        break;
      case STATE_1:
        if (millis() >= _waitUntil) {
          _state = STATE_0;
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

BlinkTask blinkTask;

void blink();

// Auto-generated setup() for top-level statements
void setup()
{
  // Recommended pattern: alias-based GPIO usage.
  pinMode(2, OUTPUT); digitalWrite(2, HIGH);
}

void blink()
{
  // driven as cooperative task in loop()
}

// Auto-generated loop() for async microtask pumping
void loop()
{
  typehal_pump_microtasks();
    blinkTask.run();
    typehal_pump_microtasks();
}
