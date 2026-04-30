#include <Arduino.h>

struct TsAsyncTask { bool done = true; };

namespace typehal_async {
  inline void waitForPinEdge(int pin, int mode) {
    int target = (mode == RISING) ? HIGH : LOW;
    int idle   = (mode == RISING) ? LOW  : HIGH;
    while (digitalRead(pin) != idle) { }
    while (digitalRead(pin) != target) { }
    delay(10);
  }
}

// Async state machine for monitor
class MonitorTask {
public:
  enum State { STATE_0, STATE_DONE };
  MonitorTask() : _state(STATE_0), _waitUntil(0) {}
  void run() {
    switch (_state) {
      case STATE_0:
        Serial.println(F("Waiting for trigger..."));
        typehal_async::waitForPinEdge(2, RISING);
        Serial.println(F("Trigger detected!"));
        _state = STATE_DONE;
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

MonitorTask monitorTask;

void monitor();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  pinMode(2, INPUT);
}

void monitor()
{
  // driven as cooperative task in loop()
}

// Auto-generated loop() for async microtask pumping
void loop()
{
    monitorTask.run();
}
