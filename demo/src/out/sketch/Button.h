#pragma once

#include <Arduino.h>

void Button_isr_0();

class Button;
Button* btn;

// ── Button class ──────────────────────────────────────────────────────────
class Button {
public:
  friend void Button_isr_0();

  Button(int pin, int debounceMs) {
    this->pin = pin;
    this->debounceMs = debounceMs;
  }

  static Button* start(int pin, int debounceMs = 50) {
    const int input = pin;
    pinMode(pin, INPUT_PULLUP);
    btn = new Button(input, debounceMs);
    attachInterrupt(digitalPinToInterrupt(pin), Button_isr_0, FALLING);
    return btn;
  }

  Button* onPress(void (*handler)()) {
    this->handler = handler;
    return this;
  }

  bool getIsHeld() const {
    return digitalRead(this->pin) == false;
  }

private:
  int pin;
  int debounceMs;
  int lastPress = 0;
  void (*handler)() = nullptr;

};

void Button_isr_0();

void Button_isr_0() {
  const int now = millis();
  if ((now - btn->lastPress) >= btn->debounceMs)
  {
    btn->lastPress = now;
    if (btn->handler != nullptr)
    {
      btn->handler();
    }
  }
}
