import type { ProgramIR } from "../ir/model";
import type { PlatformContext } from "../types";
import type { RuntimePolyfillIR } from "@typehal/core/shared";
import { getStdLibSupport } from "@typehal/core/shared";

/**
 * Generate the cooperative microtask queue + minimal Promise runtime for C++.
 * Used by both generic and Arduino strategies when async functions are present
 * and the target has C++ stdlib support.
 */
export function generatePromiseRuntime(target: string): string {
  const queueCapacity = target === "arduino" ? 32 : 256;
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
}

inline void typehal_pump_microtasks() {
  typehal_async::pumpMicrotasks();
}
`;
}

/**
 * Build a RuntimePolyfillIR for the async Promise runtime, if the program
 * has async functions and the target architecture has stdlib support.
 */
export function buildAsyncRuntimePolyfill(
  program: ProgramIR,
  ctx: PlatformContext | undefined,
  target: string,
): RuntimePolyfillIR | null {
  const hasAsync = program.functions.some(fn => fn.isAsync);
  if (!hasAsync) return null;

  const architecture = ctx?.arduino?.fqbn?.split(":")?.[1]?.toLowerCase();
  const stdlib = getStdLibSupport(architecture);
  if (!stdlib.hasVector || !stdlib.hasString) return null;

  return {
    kind: "polyfill",
    id: "async_runtime",
    domain: "standard",
    requiredIncludes: ["<functional>", "<vector>", "<utility>", "<string>"],
    forwardDeclarations: [],
    helperStructs: [generatePromiseRuntime(target)],
    helperFunctions: [],
    shimMacros: [],
    dependencies: [],
    hasPromiseRuntime: true,
  } as RuntimePolyfillIR & { hasPromiseRuntime: boolean };
}
