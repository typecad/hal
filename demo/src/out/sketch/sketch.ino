#include <Arduino.h>
#include <functional>
#include <vector>
#include <utility>
#include <string>

struct TsAsyncTask { bool done = true; };

// Polyfill: cooperative microtask queue + minimal Promise runtime
namespace typecode_async {
  using Microtask = std::function<void()>;

  class MicrotaskQueue {
  public:
    static MicrotaskQueue& instance() {
      static MicrotaskQueue queue;
      return queue;
    }

    bool enqueue(Microtask task) {
      if (_queue.size() >= 32) {
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
      if (_state != State::Pending) {
        return;
      }
      _state = State::Fulfilled;
      _value = value;
      auto callbacks = _onFulfilled;
      enqueueMicrotask([callbacks, value]() mutable {
        for (auto& callback : callbacks) {
          callback(value);
        }
      });
    }

    void reject(const std::string& error) {
      if (_state != State::Pending) {
        return;
      }
      _state = State::Rejected;
      _error = error;
      auto callbacks = _onRejected;
      enqueueMicrotask([callbacks, error]() mutable {
        for (auto& callback : callbacks) {
          callback(error);
        }
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

inline void typecode_pump_microtasks() {
  typecode_async::pumpMicrotasks();
}

// Arduino string method polyfills
const char* __tc_toUpperCase(const char* s) { static char buf[64]; strncpy(buf, s, 63); buf[63] = '\0'; for (char* p = buf; *p; p++) *p = toupper(*p); return buf; }
const char* __tc_toLowerCase(const char* s) { static char buf[64]; strncpy(buf, s, 63); buf[63] = '\0'; for (char* p = buf; *p; p++) *p = tolower(*p); return buf; }
const char* __tc_trim(const char* s) { while (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r') s++; int len = strlen(s); while (len > 0 && (s[len-1] == ' ' || s[len-1] == '\t' || s[len-1] == '\n' || s[len-1] == '\r')) len--; static char buf[64]; strncpy(buf, s, len); buf[len] = '\0'; return buf; }
const char* __tc_substring2(const char* s, int start, int end) { int slen = strlen(s); if (start < 0) start = 0; if (end > slen) end = slen; if (end < start) end = start; static char buf[64]; int len = end - start; strncpy(buf, s + start, len); buf[len] = '\0'; return buf; }
const char* __tc_substring1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_slice2(const char* s, int start, int end) { return __tc_substring2(s, start, end); }
const char* __tc_slice1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_replace(const char* s, const char* old, const char* repl) { static char buf[64]; const char* pos = strstr(s, old); if (!pos) { strncpy(buf, s, 63); buf[63] = '\0'; return buf; } int beforeLen = (int)(pos - s); int oldLen = (int)strlen(old); int replLen = (int)strlen(repl); if (beforeLen + replLen + (int)strlen(pos + oldLen) >= 64) { strncpy(buf, s, 63); buf[63] = '\0'; return buf; } memcpy(buf, s, beforeLen); memcpy(buf + beforeLen, repl, replLen); strcpy(buf + beforeLen + replLen, pos + oldLen); return buf; }
const char* __tc_charAt(const char* s, int idx) { static char buf[2]; buf[0] = s[idx]; buf[1] = '\0'; return buf; }
int __tc_charCodeAt(const char* s, int idx) { return (int)(unsigned char)s[idx]; }

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
  typecode_pump_microtasks();
    blinkTask.run();
    typecode_pump_microtasks();
}
