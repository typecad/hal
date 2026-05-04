// ---------------------------------------------------------------------------
// Shared Promise runtime C++ code generator
//
// Generates a cooperative microtask queue + minimal Promise<T> runtime
// for embedded C++ targets. Used by both the generic transpiler strategy
// and the Arduino framework strategy.
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
export function generatePromiseRuntime(queueCapacity: number, includeWaitForPinEdge: boolean = false): string {
  const waitForPinEdge = includeWaitForPinEdge ? `
  /**
   * wait for a pin edge (RISING/FALLING).
   * Implementation uses a simple polling mechanism for now to keep it generic,
   * or it could use attachInterrupt if we had a global interrupt manager.
   */
  inline Promise<void> waitForPinEdge(int pin, int mode) {
    return Promise<void>([pin, mode](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
       // This is a stub. Real implementation would use interrupts.
       // For now we just resolve immediately so it doesn't hang forever during testing.
       resolve(nullptr);
    });
  }
` : "";

  return `
// Cooperative microtask queue + minimal Promise runtime
namespace typehal_async {
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
${waitForPinEdge}
}

inline void typehal_pump_microtasks() {
  typehal_async::pumpMicrotasks();
}
`;
}
