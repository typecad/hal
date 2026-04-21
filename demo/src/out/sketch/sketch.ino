#include <Arduino.h>

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

void isr_0();
void isr_1();

// ── Button class ──────────────────────────────────────────────────────────
class Button {
public:
  friend void isr_0();
  friend void isr_1();

  Button(int pin, int debounceMs) {
    this->pin = pin;
    this->debounceMs = debounceMs;
  }

  static Button* start(int pin, int debounceMs = 50) {
    pinMode(pin, INPUT_PULLUP);
    const Button* btn = new Button(pin, debounceMs);
    attachInterrupt(digitalPinToInterrupt(pin), isr_1, FALLING);
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

Button* btn = nullptr;

void isr_0();
void isr_1();

void isr_0() {
  digitalWrite(13, !digitalRead(13));
}

void isr_1() {
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

// Auto-generated setup() for top-level statements
void setup()
{
  // ── Usage ─────────────────────────────────────────────────────────────────
  pinMode(13, OUTPUT); digitalWrite(13, false);
  btn = Button::start(2, 50)->onPress(isr_0);
}

void loop()
{
}
