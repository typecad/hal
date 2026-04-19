#include <Arduino.h>

class RollingCounter {
public:
  RollingCounter(int seed) {
    this->value = seed;
  }

  int value;

  int add(int step) {
    this->value += step;
    return this->value;
  }

};

int clampToWindow(int value, int window);

int clampToWindow(int value, int window)
{
  if (value < window.low)
  {
    return window.low;
  }
  if (value > window.high)
  {
    return window.high;
  }
  return value;
}
