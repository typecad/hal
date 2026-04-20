#include <Arduino.h>

// Array methods using StaticArray
// Note: arr.push(x) → arr.push_back(x)
// Note: arr.pop() → arr.pop_back()
// Note: arr.length → arr.size()

// Polyfill: StaticArray for platforms without std::vector
template<typename T, size_t MaxSize = 32>
struct StaticArray {
    T data[MaxSize];
    size_t length = 0;
    
    void push_back(const T& value) {
        if (length < MaxSize) {
            data[length++] = value;
        }
    }
    
    T pop_back() {
        if (length > 0) {
            return data[--length];
        }
        return T();
    }
    
    T& operator[](size_t index) {
        return data[index];
    }
    
    const T& operator[](size_t index) const {
        return data[index];
    }
    
    size_t size() const { return length; }
    bool empty() const { return length == 0; }
    bool full() const { return length >= MaxSize; }
    
    T* begin() { return data; }
    T* end() { return data + length; }
    const T* begin() const { return data; }
    const T* end() const { return data + length; }
    
    void clear() { length = 0; }

    size_t indexOf(const T& value) const {
        for (size_t i = 0; i < length; i++) {
            if (data[i] == value) return i;
        }
        return (size_t)-1;
    }
};

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

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();
int __tc_fn4();
int __tc_fn5();
int __tc_fn6();
int __tc_fn7();
int __tc_fn8();
int __tc_fn9();
int __tc_fn10();
int __tc_fn11();
int __tc_fn12();
int __tc_fn13();
int __tc_fn14();
int __tc_fn15();
int __tc_fn16();
int __tc_fn17();
int __tc_fn18();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Array basics]");
  Serial.println("[TC:IT:array literal and element access]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:30:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:array length property]");
  Serial.print("[TC:EXPECT:toBe:4:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:array mutation via index]");
  Serial.print("[TC:EXPECT:toBe:99:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Array push and pop]");
  Serial.println("[TC:IT:push adds element and returns new length]");
  Serial.print("[TC:EXPECT:toBe:4:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:4:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:IT:pop removes and returns last element]");
  Serial.print("[TC:EXPECT:toBe:30:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Array indexOf and includes]");
  Serial.println("[TC:IT:indexOf finds element]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn9());
  Serial.println("]");
  Serial.println("[TC:IT:indexOf returns -1 when not found]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(__tc_fn10());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Array spread]");
  Serial.println("[TC:IT:spread into new array]");
  Serial.print("[TC:EXPECT:toBe:4:");
  Serial.print(__tc_fn11());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn12());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:ReadonlyArray]");
  Serial.println("[TC:IT:readonly array iteration]");
  Serial.print("[TC:EXPECT:toBe:30:");
  Serial.print(__tc_fn13());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Array map]");
  Serial.println("[TC:IT:map transforms elements]");
  Serial.print("[TC:EXPECT:toBe:4:");
  Serial.print(__tc_fn14());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn15());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Array filter]");
  Serial.println("[TC:IT:filter selects elements]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print(__tc_fn16());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print(__tc_fn17());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Array reduce]");
  Serial.println("[TC:IT:reduce sums elements]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn18());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  int arr[] = { 10, 20, 30 };
  return arr[0];
}

int __tc_fn2()
{
  int arr[] = { 10, 20, 30 };
  return arr[2];
}

int __tc_fn3()
{
  int arr[] = { 10, 20, 30, 40 };
  return (sizeof(arr) / sizeof(arr[0]));
}

int __tc_fn4()
{
  int arr[] = { 10, 20, 30 };
  arr[1] = 99;
  return arr[1];
}

int __tc_fn5()
{
  StaticArray<int> arr;
  arr.push_back(1);
  arr.push_back(2);
  arr.push_back(3);
  arr.push_back(4);
  const int newLength = arr.size();
  return newLength;
}

int __tc_fn6()
{
  StaticArray<int> arr;
  arr.push_back(1);
  arr.push_back(2);
  arr.push_back(3);
  arr.push_back(4);
  return arr[3];
}

int __tc_fn7()
{
  StaticArray<int> arr;
  arr.push_back(10);
  arr.push_back(20);
  arr.push_back(30);
  const int last = arr.pop_back();
  return last;
}

int __tc_fn8()
{
  StaticArray<int> arr;
  arr.push_back(10);
  arr.push_back(20);
  arr.push_back(30);
  arr.pop_back();
  return arr.size();
}

int __tc_fn9()
{
  StaticArray<int> arr;
  arr.push_back(10);
  arr.push_back(20);
  arr.push_back(30);
  return arr.indexOf(20);
}

int __tc_fn10()
{
  StaticArray<int> arr;
  arr.push_back(10);
  arr.push_back(20);
  arr.push_back(30);
  return arr.indexOf(99);
}

int __tc_fn11()
{
  int a[] = { 1, 2 };
  int b[] = { a[0], a[1], 3, 4 };
  return (sizeof(b) / sizeof(b[0]));
}

int __tc_fn12()
{
  int a[] = { 1, 2 };
  int b[] = { a[0], a[1], 3, 4 };
  return b[2];
}

int __tc_fn13()
{
  int data[] = { 5, 10, 15 };
  int sum = 0;
  for (const int v : data)
  {
    sum += v;
  }
  return sum;
}

int __tc_fn14()
{
  int arr[] = { 1, 2, 3 };
  int doubled[] = { 0, 0, 0 };
  for (int __tc_i = 0; __tc_i < 3; __tc_i++)
  {
    const int x = arr[__tc_i];
    doubled[__tc_i] = x * 2;
  }
  return doubled[1];
}

int __tc_fn15()
{
  int arr[] = { 1, 2, 3 };
  int doubled[] = { 0, 0, 0 };
  for (int __tc_i = 0; __tc_i < 3; __tc_i++)
  {
    const int x = arr[__tc_i];
    doubled[__tc_i] = x * 2;
  }
  return (sizeof(doubled) / sizeof(doubled[0]));
}

int __tc_fn16()
{
  int arr[] = { 1, 2, 3, 4, 5 };
  int evens[] = { 0, 0, 0, 0, 0 };
  int evens__len = 0;
  for (int __tc_i = 0; __tc_i < 5; __tc_i++)
  {
    const int x = arr[__tc_i];
    if (x % 2 == 0)
    {
      evens[evens__len] = arr[__tc_i];
      evens__len++;
    }
  }
  return evens__len;
}

int __tc_fn17()
{
  int arr[] = { 1, 2, 3, 4, 5 };
  int evens[] = { 0, 0, 0, 0, 0 };
  int evens__len = 0;
  for (int __tc_i = 0; __tc_i < 5; __tc_i++)
  {
    const int x = arr[__tc_i];
    if (x % 2 == 0)
    {
      evens[evens__len] = arr[__tc_i];
      evens__len++;
    }
  }
  return evens[0];
}

int __tc_fn18()
{
  int arr[] = { 1, 2, 3, 4 };
  int sum = 0;
  for (int __tc_i = 0; __tc_i < 4; __tc_i++)
  {
    const int val = arr[__tc_i];
    const int acc = sum;
    sum = acc + val;
  }
  return sum;
}

void loop()
{
}
